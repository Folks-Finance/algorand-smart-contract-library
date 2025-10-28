import { algorandFixture } from "@algorandfoundation/algokit-utils/testing";
import type { TransactionSignerAccount } from "@algorandfoundation/algokit-utils/types/account";
import { type Account, type Address, OnApplicationComplete, getApplicationAddress } from "algosdk";

import { RateLimiterExposedClient, RateLimiterExposedFactory } from "../../specs/client/RateLimiterExposed.client.ts";
import { getBucketBoxKey } from "../utils/boxes.ts";
import { convertNumberToBytes, getEventBytes, getRandomBytes } from "../utils/bytes.ts";
import { SECONDS_IN_DAY, advancePrevBlockTimestamp, getPrevBlockTimestamp } from "../utils/time.ts";
import { MAX_INT64, MAX_UINT256, getRandomUInt } from "../utils/uint.ts";

describe("RateLimiter", () => {
  const localnet = algorandFixture();

  let factory: RateLimiterExposedFactory;
  let client: RateLimiterExposedClient;
  let appId: bigint;

  let creator: Address & Account & TransactionSignerAccount;

  const bucketId = getRandomBytes(32);
  let limit = BigInt(1000n * 10n ** 18n); // 1000 of token with 18 decimals
  let duration = SECONDS_IN_DAY;

  const zeroDurationBucketId = getRandomBytes(32);

  beforeAll(async () => {
    await localnet.newScope();
    const { algorand, generateAccount } = localnet.context;

    creator = await generateAccount({ initialFunds: (100).algo() });

    factory = algorand.client.getTypedAppFactory(RateLimiterExposedFactory, {
      defaultSender: creator,
      defaultSigner: creator.signer,
    });
  });

  test("deploys with correct state", async () => {
    const { appClient, result } = await factory.deploy();
    appId = result.appId;
    client = appClient;

    expect(appId).not.toEqual(0n);
  });

  describe("get current capacity", () => {
    test.each([{ length: 16 }, { length: 34 }])(`fails when bucket id is $length bytes`, async ({ length }) => {
      await expect(
        localnet.algorand.send.appCall({
          sender: creator,
          appId,
          onComplete: OnApplicationComplete.NoOpOC,
          args: [client.appClient.getABIMethod("get_current_capacity").getSelector(), getRandomBytes(length)],
        }),
      ).rejects.toThrow("invalid number of bytes for arc4.static_array<arc4.uint8, 32>");
    });

    test("fails if bucket unknown", async () => {
      await expect(client.send.getCurrentCapacity({ args: [bucketId] })).rejects.toThrow("Unknown bucket");
    });
  });

  test("get rate limit fails if bucket unknown", async () => {
    await expect(client.send.getRateLimit({ args: [bucketId] })).rejects.toThrow("Unknown bucket");
  });

  test("get rate duration fails if bucket unknown", async () => {
    await expect(client.send.getRateDuration({ args: [bucketId] })).rejects.toThrow("Unknown bucket");
  });

  describe("add bucket", () => {
    test("succeeds", async () => {
      const prevBlockTimestamp = await getPrevBlockTimestamp(localnet);

      const APP_MIN_BALANCE = (154_900).microAlgos();
      const fundingTxn = await localnet.algorand.createTransaction.payment({
        sender: creator,
        receiver: getApplicationAddress(appId),
        amount: APP_MIN_BALANCE,
      });
      const res = await client
        .newGroup()
        .addTransaction(fundingTxn)
        .addBucket({
          args: [bucketId, limit, duration],
          boxReferences: [getBucketBoxKey(bucketId)],
        })
        .send();

      expect(res.confirmations[1].logs).toBeDefined();
      expect(res.confirmations[1].logs![0]).toEqual(
        getEventBytes("BucketAdded(byte[32],uint256,uint64)", [bucketId, limit, duration]),
      );

      expect(await client.getCurrentCapacity({ args: [bucketId] })).toEqual(limit);
      const expectedBucket = { limit, currentCapacity: limit, duration, lastUpdated: prevBlockTimestamp };
      expect(await client.getBucket({ args: [bucketId] })).toEqual(expectedBucket);
      expect(await client.getCurrentCapacity({ args: [bucketId] })).toEqual(expectedBucket.currentCapacity);
      expect(await client.getRateLimit({ args: [bucketId] })).toEqual(expectedBucket.limit);
      expect(await client.getRateDuration({ args: [bucketId] })).toEqual(expectedBucket.duration);
      const rateLimitBucket = await client.state.box.rateLimitBuckets.value(bucketId);
      expect(rateLimitBucket).toBeDefined();
      expect(rateLimitBucket).toEqual(expectedBucket);
    });

    test("fails if already exists", async () => {
      await expect(
        client.send.addBucket({
          args: [bucketId, limit, duration],
          boxReferences: [getBucketBoxKey(bucketId)],
        }),
      ).rejects.toThrow("Bucket already exists");
    });
  });

  describe("update capacity", () => {
    beforeAll(async () => {
      // add zero duration bucket
      const APP_MIN_BALANCE = (154_900).microAlgos();
      const fundingTxn = await localnet.algorand.createTransaction.payment({
        sender: creator,
        receiver: getApplicationAddress(appId),
        amount: APP_MIN_BALANCE,
      });
      await client
        .newGroup()
        .addTransaction(fundingTxn)
        .addBucket({
          args: [zeroDurationBucketId, limit, 0n],
          boxReferences: [getBucketBoxKey(zeroDurationBucketId)],
        })
        .send();
    });

    afterAll(async () => {
      // reset current capacity to limit
      await client.send.setCurrentCapacity({ args: [bucketId, limit] });
    });

    test("fails if bucket unknown", async () => {
      const unknownBucketId = getRandomBytes(32);
      await expect(
        client.send.updateCapacity({
          args: [unknownBucketId],
          boxReferences: [getBucketBoxKey(unknownBucketId)],
        }),
      ).rejects.toThrow("Unknown bucket");
    });

    test("ignores if duration is zero", async () => {
      const res = await client.send.updateCapacity({
        args: [zeroDurationBucketId],
        boxReferences: [getBucketBoxKey(zeroDurationBucketId)],
      });
      expect(res.confirmations[0].logs).toBeUndefined();
    });

    test.each([
      {
        name: "remains same when time delta is zero",
        capacity: limit / 2n,
        timeDelta: 0n,
        expectedCapacity: limit / 2n,
      },
      {
        name: "increases capacity proportional to time passed",
        capacity: limit / 4n,
        timeDelta: duration / 4n,
        expectedCapacity: limit / 2n,
      },
      {
        name: "increases capacity without exceeding limit",
        capacity: limit / 4n,
        timeDelta: duration,
        expectedCapacity: limit,
      },
    ])("succeeds and $name", async ({ capacity, timeDelta, expectedCapacity }) => {
      // setup
      await advancePrevBlockTimestamp(localnet, SECONDS_IN_DAY);
      await client.send.setCurrentCapacity({ args: [bucketId, capacity] });
      await advancePrevBlockTimestamp(localnet, timeDelta);
      const prevBlockTimestamp = await getPrevBlockTimestamp(localnet);

      // pre-update
      expect(await client.getCurrentCapacity({ args: [bucketId] })).toEqual(expectedCapacity);

      // update
      await client.send.updateCapacity({
        args: [bucketId],
        boxReferences: [getBucketBoxKey(bucketId)],
      });

      // post-update
      expect(await client.getCurrentCapacity({ args: [bucketId] })).toEqual(expectedCapacity);
      const expectedBucket = { limit, currentCapacity: expectedCapacity, duration, lastUpdated: prevBlockTimestamp };
      expect(await client.getBucket({ args: [bucketId] })).toEqual(expectedBucket);
      const rateLimitBucket = await client.state.box.rateLimitBuckets.value(bucketId);
      expect(rateLimitBucket).toBeDefined();
      expect(rateLimitBucket).toEqual(expectedBucket);
    });
  });

  describe("update rate limit", () => {
    afterEach(async () => {
      // reset limit and current capacity
      await client.send.updateRateLimit({ args: [bucketId, limit] });
      await client.send.setCurrentCapacity({ args: [bucketId, limit] });
    });

    test("fails if bucket unknown", async () => {
      const unknownBucketId = getRandomBytes(32);
      await expect(
        client.send.updateRateLimit({
          args: [unknownBucketId, 0n],
          boxReferences: [getBucketBoxKey(unknownBucketId)],
        }),
      ).rejects.toThrow("Unknown bucket");
    });

    test("succeeds and reduces current capacity by delta when delta is less than current capacity", async () => {
      // setup
      await client.send.setCurrentCapacity({ args: [bucketId, limit / 2n] });
      await advancePrevBlockTimestamp(localnet, duration / 4n);
      const prevBlockTimestamp = await getPrevBlockTimestamp(localnet);
      const oldCapacity = await client.getCurrentCapacity({ args: [bucketId] });

      // reduce rate limit by 1/2
      const newLimit = limit / 2n;
      const res = await client.send.updateRateLimit({ args: [bucketId, newLimit] });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("BucketRateLimitUpdated(byte[32],uint256)", [bucketId, newLimit]),
      );

      // should consider updated current capacity
      const limitDelta = limit - newLimit;
      expect(await client.getCurrentCapacity({ args: [bucketId] })).toEqual(oldCapacity - limitDelta);
      expect(await client.getRateLimit({ args: [bucketId] })).toEqual(newLimit);
      const expectedBucket = {
        limit: newLimit,
        currentCapacity: oldCapacity - limitDelta,
        duration,
        lastUpdated: prevBlockTimestamp,
      };
      expect(await client.getBucket({ args: [bucketId] })).toEqual(expectedBucket);
      const rateLimitBucket = await client.state.box.rateLimitBuckets.value(bucketId);
      expect(rateLimitBucket).toBeDefined();
      expect(rateLimitBucket).toEqual(expectedBucket);
    });

    test("succeeds and reduces current capacity to zero when delta exceeds current capacity", async () => {
      // setup
      await client.send.setCurrentCapacity({ args: [bucketId, limit / 8n] });
      await advancePrevBlockTimestamp(localnet, duration / 4n);
      const prevBlockTimestamp = await getPrevBlockTimestamp(localnet);
      const oldCapacity = await client.getCurrentCapacity({ args: [bucketId] });

      // reduce rate limit by 1/2
      const newLimit = limit / 2n;
      const res = await client.send.updateRateLimit({ args: [bucketId, newLimit] });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("BucketRateLimitUpdated(byte[32],uint256)", [bucketId, newLimit]),
      );

      // should consider updated current capacity
      const limitDelta = limit - newLimit;
      expect(oldCapacity - limitDelta).toBeLessThan(0n);
      expect(await client.getCurrentCapacity({ args: [bucketId] })).toEqual(0n);
      expect(await client.getRateLimit({ args: [bucketId] })).toEqual(newLimit);
      const expectedBucket = { limit: newLimit, currentCapacity: 0n, duration, lastUpdated: prevBlockTimestamp };
      expect(await client.getBucket({ args: [bucketId] })).toEqual(expectedBucket);
      const rateLimitBucket = await client.state.box.rateLimitBuckets.value(bucketId);
      expect(rateLimitBucket).toBeDefined();
      expect(rateLimitBucket).toEqual(expectedBucket);
    });

    test("succeeds and increases current capacity by delta", async () => {
      // setup
      await client.send.setCurrentCapacity({ args: [bucketId, limit / 8n] });
      await advancePrevBlockTimestamp(localnet, duration / 2n);
      const prevBlockTimestamp = await getPrevBlockTimestamp(localnet);
      const oldCapacity = await client.getCurrentCapacity({ args: [bucketId] });

      // increase rate limit by 4x
      const newLimit = 4n * limit;
      const res = await client.send.updateRateLimit({ args: [bucketId, newLimit] });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("BucketRateLimitUpdated(byte[32],uint256)", [bucketId, newLimit]),
      );

      // should consider updated current capacity
      const limitDelta = newLimit - limit;
      expect(await client.getCurrentCapacity({ args: [bucketId] })).toEqual(oldCapacity + limitDelta);
      expect(await client.getRateLimit({ args: [bucketId] })).toEqual(newLimit);
      const expectedBucket = {
        limit: newLimit,
        currentCapacity: oldCapacity + limitDelta,
        duration,
        lastUpdated: prevBlockTimestamp,
      };
      expect(await client.getBucket({ args: [bucketId] })).toEqual(expectedBucket);
      const rateLimitBucket = await client.state.box.rateLimitBuckets.value(bucketId);
      expect(rateLimitBucket).toBeDefined();
      expect(rateLimitBucket).toEqual(expectedBucket);
    });
  });

  describe("update rate duration", () => {
    afterEach(async () => {
      // reset duration and current capacity
      await client.send.updateRateDuration({ args: [bucketId, duration] });
      await client.send.setCurrentCapacity({ args: [bucketId, limit] });
    });

    test("fails if bucket unknown", async () => {
      const unknownBucketId = getRandomBytes(32);
      await expect(
        client.send.updateRateDuration({
          args: [unknownBucketId, 0n],
          boxReferences: [getBucketBoxKey(unknownBucketId)],
        }),
      ).rejects.toThrow("Unknown bucket");
    });

    test("success", async () => {
      // setup
      await client.send.setCurrentCapacity({ args: [bucketId, limit / 8n] });
      await advancePrevBlockTimestamp(localnet, duration / 2n);
      const prevBlockTimestamp = await getPrevBlockTimestamp(localnet);
      const capacity = await client.getCurrentCapacity({ args: [bucketId] });

      // update duration
      const newDuration = getRandomUInt(SECONDS_IN_DAY);
      const res = await client.send.updateRateDuration({ args: [bucketId, newDuration] });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("BucketRateDurationUpdated(byte[32],uint64)", [bucketId, newDuration]),
      );

      // should consider updated current capacity
      expect(await client.getCurrentCapacity({ args: [bucketId] })).toEqual(capacity);
      expect(await client.getRateDuration({ args: [bucketId] })).toEqual(newDuration);
      const expectedBucket = {
        limit,
        currentCapacity: capacity,
        duration: newDuration,
        lastUpdated: prevBlockTimestamp,
      };
      expect(await client.getBucket({ args: [bucketId] })).toEqual(expectedBucket);
      const rateLimitBucket = await client.state.box.rateLimitBuckets.value(bucketId);
      expect(rateLimitBucket).toBeDefined();
      expect(rateLimitBucket).toEqual(expectedBucket);
    });

    test("resets capacity when updating from zero to non-zero duration", async () => {
      // set duration to zero
      await client.send.updateRateDuration({ args: [bucketId, 0n] });
      expect(await client.getRateDuration({ args: [bucketId] })).toEqual(0n);

      // setup
      await client.send.setCurrentCapacity({ args: [bucketId, limit / 2n] });
      const prevBlockTimestamp = await getPrevBlockTimestamp(localnet);

      // update duration
      const newDuration = getRandomUInt(SECONDS_IN_DAY);
      const res = await client.send.updateRateDuration({ args: [bucketId, newDuration] });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("BucketRateDurationUpdated(byte[32],uint64)", [bucketId, newDuration]),
      );

      // should consider updated current capacity
      expect(await client.getCurrentCapacity({ args: [bucketId] })).toEqual(limit);
      expect(await client.getRateDuration({ args: [bucketId] })).toEqual(newDuration);
      const expectedBucket = {
        limit,
        currentCapacity: limit,
        duration: newDuration,
        lastUpdated: prevBlockTimestamp,
      };
      expect(await client.getBucket({ args: [bucketId] })).toEqual(expectedBucket);
      const rateLimitBucket = await client.state.box.rateLimitBuckets.value(bucketId);
      expect(rateLimitBucket).toBeDefined();
      expect(rateLimitBucket).toEqual(expectedBucket);
    });
  });

  describe("has capacity", () => {
    afterEach(async () => {
      // reset current capacity
      await client.send.setCurrentCapacity({ args: [bucketId, limit] });
    });

    test.each([{ length: 16 }, { length: 34 }])(`fails when bucket id is $length bytes`, async ({ length }) => {
      await expect(
        localnet.algorand.send.appCall({
          sender: creator,
          appId,
          onComplete: OnApplicationComplete.NoOpOC,
          args: [
            client.appClient.getABIMethod("has_capacity").getSelector(),
            getRandomBytes(length),
            convertNumberToBytes(0, 32),
          ],
        }),
      ).rejects.toThrow("invalid number of bytes for arc4.static_array<arc4.uint8, 32>");
    });

    test("fails if bucket unknown", async () => {
      const unknownBucketId = getRandomBytes(32);
      await expect(
        client.send.hasCapacity({
          args: [unknownBucketId, 1n],
          boxReferences: [getBucketBoxKey(unknownBucketId)],
        }),
      ).rejects.toThrow("Unknown bucket");
    });

    test("always returns true when duration is zero", async () => {
      // set duration to zero
      await client.send.updateRateDuration({ args: [bucketId, 0n] });

      // capacity non-zero
      const capacity = getRandomUInt(limit);
      await client.send.setCurrentCapacity({ args: [bucketId, capacity] });
      expect(await client.hasCapacity({ args: [bucketId, 0n] })).toBeTruthy();
      expect(await client.hasCapacity({ args: [bucketId, capacity / 2n] })).toBeTruthy();
      expect(await client.hasCapacity({ args: [bucketId, capacity] })).toBeTruthy();

      // capacity zero
      await client.send.setCurrentCapacity({ args: [bucketId, 0n] });
      expect(await client.hasCapacity({ args: [bucketId, 0n] })).toBeTruthy();
      expect(await client.hasCapacity({ args: [bucketId, capacity] })).toBeTruthy();

      // reset duration
      await client.send.updateRateDuration({ args: [bucketId, duration] });
    });

    test("returns true when sufficient capacity", async () => {
      // setup
      await client.send.setCurrentCapacity({ args: [bucketId, limit / 8n] });
      await advancePrevBlockTimestamp(localnet, getRandomUInt(duration / 2n));
      const capacity = await client.getCurrentCapacity({ args: [bucketId] });

      // should consider updated current capacity
      expect(await client.hasCapacity({ args: [bucketId, 0n] })).toBeTruthy();
      expect(await client.hasCapacity({ args: [bucketId, capacity / 2n] })).toBeTruthy();
      expect(await client.hasCapacity({ args: [bucketId, capacity] })).toBeTruthy();
    });

    test("returns false when insufficient capacity", async () => {
      // setup
      await client.send.setCurrentCapacity({ args: [bucketId, limit / 8n] });
      await advancePrevBlockTimestamp(localnet, getRandomUInt(duration / 2n));
      const capacity = await client.getCurrentCapacity({ args: [bucketId] });

      // should consider updated current capacity
      expect(await client.hasCapacity({ args: [bucketId, capacity + 1n] })).toBeFalsy();
    });
  });

  describe("consume amount", () => {
    test("fails if bucket unknown", async () => {
      const unknownBucketId = getRandomBytes(32);
      await expect(
        client.send.consumeAmount({
          args: [unknownBucketId, 1n],
          boxReferences: [getBucketBoxKey(unknownBucketId)],
        }),
      ).rejects.toThrow("Unknown bucket");
    });

    test("ignores if duration is zero", async () => {
      // consuming more than limit is even allowed
      const amount = limit + 1n;
      const expectedBucket = await client.getBucket({ args: [bucketId] });

      // consume amount
      const res = await client.send.consumeAmount({
        args: [zeroDurationBucketId, amount],
        boxReferences: [getBucketBoxKey(zeroDurationBucketId)],
      });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("BucketConsumed(byte[32],uint256)", [zeroDurationBucketId, amount]),
      );

      // should have no state changes
      expect(await client.getBucket({ args: [bucketId] })).toEqual(expectedBucket);
    });

    test("fails when insufficient capacity", async () => {
      // setup
      await client.send.setCurrentCapacity({ args: [bucketId, limit / 8n] });
      await advancePrevBlockTimestamp(localnet, getRandomUInt(duration / 2n));
      const capacity = await client.getCurrentCapacity({ args: [bucketId] });

      // should consider updated current capacity
      await expect(client.send.consumeAmount({ args: [bucketId, capacity + 1n] })).rejects.toThrow(
        "Insufficient capacity to consume",
      );
    });

    test("succeeds when sufficient capacity", async () => {
      // setup
      await client.send.setCurrentCapacity({ args: [bucketId, limit / 8n] });
      await advancePrevBlockTimestamp(localnet, getRandomUInt(duration / 2n));
      const prevBlockTimestamp = await getPrevBlockTimestamp(localnet);
      const capacity = await client.getCurrentCapacity({ args: [bucketId] });

      // consume amount
      const amount = getRandomUInt(capacity);
      const res = await client.send.consumeAmount({ args: [bucketId, amount] });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("BucketConsumed(byte[32],uint256)", [bucketId, amount]),
      );

      // should consider updated current capacity
      expect(await client.getCurrentCapacity({ args: [bucketId] })).toEqual(capacity - amount);
      const expectedBucket = { limit, currentCapacity: capacity - amount, duration, lastUpdated: prevBlockTimestamp };
      expect(await client.getBucket({ args: [bucketId] })).toEqual(expectedBucket);
      const rateLimitBucket = await client.state.box.rateLimitBuckets.value(bucketId);
      expect(rateLimitBucket).toBeDefined();
      expect(rateLimitBucket).toEqual(expectedBucket);
    });
  });

  describe("fill amount", () => {
    afterEach(async () => {
      // reset current capacity
      await client.send.setCurrentCapacity({ args: [bucketId, limit] });
    });

    test("fails if bucket unknown", async () => {
      const unknownBucketId = getRandomBytes(32);
      await expect(
        client.send.fillAmount({
          args: [unknownBucketId, 1n],
          boxReferences: [getBucketBoxKey(unknownBucketId)],
        }),
      ).rejects.toThrow("Unknown bucket");
    });

    test("ignores if duration is zero", async () => {
      // setup
      const amount = 1n;
      const expectedBucket = await client.getBucket({ args: [bucketId] });

      // fill amount
      const res = await client.send.fillAmount({
        args: [zeroDurationBucketId, amount],
        boxReferences: [getBucketBoxKey(zeroDurationBucketId)],
      });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("BucketFilled(byte[32],uint256,uint256)", [zeroDurationBucketId, amount, 0n]),
      );

      // should have no state changes
      expect(await client.getBucket({ args: [bucketId] })).toEqual(expectedBucket);
    });

    test("succeeds when amount is less than consumption", async () => {
      // setup
      await client.send.setCurrentCapacity({ args: [bucketId, limit / 8n] });
      await advancePrevBlockTimestamp(localnet, getRandomUInt(duration / 2n));
      const prevBlockTimestamp = await getPrevBlockTimestamp(localnet);
      const capacity = await client.getCurrentCapacity({ args: [bucketId] });

      // fill amount
      const amount = getRandomUInt(limit - capacity - 1n);
      const res = await client.send.fillAmount({ args: [bucketId, amount] });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("BucketFilled(byte[32],uint256,uint256)", [bucketId, amount, amount]),
      );

      // should consider updated current capacity
      expect(await client.getCurrentCapacity({ args: [bucketId] })).toEqual(capacity + amount);
      const expectedBucket = { limit, currentCapacity: capacity + amount, duration, lastUpdated: prevBlockTimestamp };
      expect(await client.getBucket({ args: [bucketId] })).toEqual(expectedBucket);
      const rateLimitBucket = await client.state.box.rateLimitBuckets.value(bucketId);
      expect(rateLimitBucket).toBeDefined();
      expect(rateLimitBucket).toEqual(expectedBucket);
    });

    test("succeeds and doesn't exceed limit when amount is greater than consumption", async () => {
      // setup
      await client.send.setCurrentCapacity({ args: [bucketId, limit / 8n] });
      await advancePrevBlockTimestamp(localnet, getRandomUInt(duration / 2n));
      const prevBlockTimestamp = await getPrevBlockTimestamp(localnet);
      const capacity = await client.getCurrentCapacity({ args: [bucketId] });

      // fill amount
      const extra = 1n;
      const amount = limit - capacity + extra;
      const res = await client.send.fillAmount({ args: [bucketId, amount] });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("BucketFilled(byte[32],uint256,uint256)", [bucketId, amount, amount - extra]),
      );

      // should consider updated current capacity
      expect(capacity + amount).toBeGreaterThan(limit);
      expect(await client.getCurrentCapacity({ args: [bucketId] })).toEqual(limit);
      const expectedBucket = { limit, currentCapacity: limit, duration, lastUpdated: prevBlockTimestamp };
      expect(await client.getBucket({ args: [bucketId] })).toEqual(expectedBucket);
      const rateLimitBucket = await client.state.box.rateLimitBuckets.value(bucketId);
      expect(rateLimitBucket).toBeDefined();
      expect(rateLimitBucket).toEqual(expectedBucket);
    });

    test("succeeds and doesn't overflow", async () => {
      // setup
      await client.send.updateRateLimit({ args: [bucketId, MAX_UINT256] });
      await client.send.updateRateDuration({ args: [bucketId, 1n] });
      await advancePrevBlockTimestamp(localnet, MAX_INT64);
      const prevBlockTimestamp = await getPrevBlockTimestamp(localnet);
      expect(await client.getCurrentCapacity({ args: [bucketId] })).toEqual(MAX_UINT256);

      // should consider updated current capacity
      const res = await client.send.fillAmount({
        args: [bucketId, MAX_UINT256],
        boxReferences: [getBucketBoxKey(bucketId)],
      });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("BucketFilled(byte[32],uint256,uint256)", [bucketId, MAX_UINT256, 0n]),
      );

      // should consider updated current capacity
      expect(await client.getCurrentCapacity({ args: [bucketId] })).toEqual(MAX_UINT256);
      const expectedBucket = {
        limit: MAX_UINT256,
        currentCapacity: MAX_UINT256,
        duration: 1n,
        lastUpdated: prevBlockTimestamp,
      };
      expect(await client.getBucket({ args: [bucketId] })).toEqual(expectedBucket);
      const rateLimitBucket = await client.state.box.rateLimitBuckets.value(bucketId);
      expect(rateLimitBucket).toBeDefined();
      expect(rateLimitBucket).toEqual(expectedBucket);

      // reset limit and duration
      await client.send.updateRateLimit({ args: [bucketId, limit] });
      await client.send.updateRateDuration({ args: [bucketId, duration] });
    });
  });

  describe("remove bucket", () => {
    test("fails if bucket unknown", async () => {
      const unknownBucketId = getRandomBytes(32);
      await expect(
        client.send.removeBucket({
          args: [unknownBucketId],
          boxReferences: [getBucketBoxKey(unknownBucketId)],
        }),
      ).rejects.toThrow("Unknown bucket");
    });

    test("succeeds", async () => {
      const res = await client.send.removeBucket({
        args: [bucketId],
        boxReferences: [getBucketBoxKey(bucketId)],
      });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(getEventBytes("BucketRemoved(byte[32])", [bucketId]));
      await expect(client.state.box.rateLimitBuckets.value(bucketId)).rejects.toThrow("box not found");
    });
  });
});
