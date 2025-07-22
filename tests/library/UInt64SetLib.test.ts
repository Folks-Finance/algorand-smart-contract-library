import { Config } from "@algorandfoundation/algokit-utils";
import { algorandFixture } from "@algorandfoundation/algokit-utils/testing";
import type { TransactionSignerAccount } from "@algorandfoundation/algokit-utils/types/account";
import { nullLogger } from "@algorandfoundation/algokit-utils/types/logging";
import { type Account, type Address, getApplicationAddress } from "algosdk";

import {
  UInt64SetLibExposedClient,
  UInt64SetLibExposedFactory,
} from "../../specs/client/UInt64SetLibExposed.client.ts";
import { MAX_UINT64, getRandomUInt } from "../utils/uint.ts";

describe("UInt64SetLib", () => {
  const localnet = algorandFixture();

  let factory: UInt64SetLibExposedFactory;
  let client: UInt64SetLibExposedClient;
  let appId: bigint;

  let creator: Address & Account & TransactionSignerAccount;

  beforeAll(async () => {
    Config.configure({ logger: nullLogger });
    await localnet.newScope();
    const { algorand, generateAccount } = localnet.context;

    creator = await generateAccount({ initialFunds: (100).algo() });

    factory = algorand.client.getTypedAppFactory(UInt64SetLibExposedFactory, {
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

  describe("has item", () => {
    test("returns true when present", async () => {
      const items = [34n, 2n, 5n, 873099n];
      for (let i = 0; i < items.length; i++) {
        expect(await client.hasItem({ args: [items[0], items] })).toBeTruthy();
      }
    });

    test("returns false when not present", async () => {
      const items = [34n, 2n, 5n, 873099n];
      expect(await client.hasItem({ args: [0n, items] })).toBeFalsy();
      expect(await client.hasItem({ args: [2402174n, items] })).toBeFalsy();
    });
  });

  describe("add item", () => {
    test("appends to array when new", async () => {
      expect(await client.addItem({ args: [4n, []] })).toEqual([true, [4n]]);
      expect(await client.addItem({ args: [1n, [4n]] })).toEqual([true, [4n, 1n]]);
      expect(await client.addItem({ args: [2567325n, [4n, 1n]] })).toEqual([true, [4n, 1n, 2567325n]]);
    });

    test("doesn't append to array when already present", async () => {
      const items = [34n, 2n, 5n, 873099n];
      for (let i = 0; i < items.length; i++) {
        expect(await client.addItem({ args: [items[0], items] })).toEqual([false, items]);
      }
    });
  });

  describe("remove item", () => {
    test("removes from end of array", async () => {
      expect(await client.removeItem({ args: [873099n, [34n, 2n, 5n, 873099n]] })).toEqual([true, [34n, 2n, 5n]]);
      expect(await client.removeItem({ args: [34n, [34n]] })).toEqual([true, []]);
    });

    test("removes from not end of array", async () => {
      expect(await client.removeItem({ args: [34n, [34n, 2n, 5n, 873099n]] })).toEqual([true, [873099n, 2n, 5n]]);
      expect(await client.removeItem({ args: [2n, [34n, 2n, 5n, 873099n]] })).toEqual([true, [34n, 873099n, 5n]]);
      expect(await client.removeItem({ args: [5n, [34n, 2n, 5n, 873099n]] })).toEqual([true, [34n, 2n, 873099n]]);
    });

    test("doesn't remove from array when empty", async () => {
      expect(await client.removeItem({ args: [34n, []] })).toEqual([false, []]);
    });

    test("doesn't remove from array when not present", async () => {
      const items = [34n, 2n, 5n, 873099n];
      expect(await client.removeItem({ args: [0n, items] })).toEqual([false, items]);
      expect(await client.removeItem({ args: [2402174n, items] })).toEqual([false, items]);
    });
  });

  describe("dynamic tests", () => {
    beforeAll(async () => {
      // fund with large amount so not to worry about box size
      await localnet.algorand.send.payment({
        sender: creator,
        receiver: getApplicationAddress(appId),
        amount: (10).algo(),
      });
    });

    beforeEach(async () => {
      await client.send.dynamicReset({ args: [], boxReferences: ["uint64_set"] });
    });

    test("happy path", async () => {
      const expected = new Set<bigint>();

      // continually add and remove items
      const cycles = 5;
      const numItemsAddedPerCycle = 20;
      const numItemsRemovedPerCycle = 10;
      for (let i = 0; i < cycles; i++) {
        // add random items
        for (let j = 0; j < numItemsAddedPerCycle; j++) {
          const item = getRandomUInt(MAX_UINT64);
          const res = await client.send.dynamicAddItem({
            args: [item],
            boxReferences: ["uint64_set"],
            extraFee: (15_000).microAlgos(),
          });
          expect(res.return).toBeTruthy();
          expected.add(item);
        }

        // remove random items
        for (let j = 0; j < numItemsRemovedPerCycle; j++) {
          const items = await client.state.box.uint64Set();
          expect(items).toBeDefined();
          const item = items![Number(getRandomUInt(items!.length - 1))];
          const res = await client.send.dynamicRemoveItem({
            args: [item],
            boxReferences: ["uint64_set"],
            extraFee: (15_000).microAlgos(),
          });
          expect(res.return).toBeTruthy();
          expected.delete(item);
        }
      }

      // check result
      const items = await client.state.box.uint64Set();
      expect(items).toBeDefined();
      expect(items!.length).toEqual(expected.size);
      for (const item of expected) {
        expect(
          await client.dynamicHasItem({
            args: [item],
            boxReferences: ["uint64_set"],
            extraFee: (15_000).microAlgos(),
          }),
        ).toBeTruthy();
      }
    }, 60_000);

    test("supports up to 511 items", async () => {
      const maxItems = 511;

      // add items
      for (let i = 0; i < maxItems; i++) {
        const res = await client.send.dynamicAddItem({
          args: [i],
          boxReferences: ["uint64_set", "uint64_set", "uint64_set", "uint64_set"],
          extraFee: (15_000).microAlgos(),
        });
        expect(res.return).toBeTruthy();
      }

      // has items
      for (let i = 0; i < maxItems; i++) {
        expect(
          await client.dynamicHasItem({
            args: [i],
            boxReferences: ["uint64_set", "uint64_set", "uint64_set", "uint64_set"],
            extraFee: (15_000).microAlgos(),
          }),
        ).toBeTruthy();
      }

      // remove items
      for (let i = 0; i < maxItems; i++) {
        const res = await client.send.dynamicRemoveItem({
          args: [i],
          boxReferences: ["uint64_set", "uint64_set", "uint64_set", "uint64_set"],
          extraFee: (15_000).microAlgos(),
        });
        expect(res.return).toBeTruthy();
      }

      // should be empty
      const items = await client.state.box.uint64Set();
      expect(items).toBeDefined();
      expect(items!.length).toEqual(0);
    }, 60_000);
  });
});
