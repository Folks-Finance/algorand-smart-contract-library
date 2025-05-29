import { algorandFixture } from "@algorandfoundation/algokit-utils/testing";
import type { TransactionSignerAccount } from "@algorandfoundation/algokit-utils/types/account";
import { getApplicationAddress } from "algosdk";
import type { Account, Address } from "algosdk";

import { LargeContractToUpgradeToFactory } from "../../specs/client/LargeContractToUpgradeTo.client.ts";
import { MockUpgradeableClient, MockUpgradeableFactory } from "../../specs/client/MockUpgradeable.client.ts";
import { getAddressRolesBoxKey, getRoleBoxKey } from "../utils/boxes.ts";
import { getEventBytes, getRandomBytes, getRoleBytes } from "../utils/bytes.ts";
import { PAGE_SIZE, calculateProgramSha256 } from "../utils/contract.ts";
import { SECONDS_IN_DAY, SECONDS_IN_HOUR, advancePrevBlockTimestamp, getPrevBlockTimestamp } from "../utils/time.ts";
import { getRandomUInt } from "../utils/uint.ts";

describe("Upgradeable", () => {
  const localnet = algorandFixture();

  const DEFAULT_ADMIN_ROLE = new Uint8Array(16);
  const UPGRADEABLE_ADMIN_ROLE = getRoleBytes("UPGRADEABLE_ADMIN");

  const MIN_UPGRADE_DELAY = SECONDS_IN_DAY;

  let factory: MockUpgradeableFactory;
  let client: MockUpgradeableClient;
  let appId: bigint;

  let updatedContractFactory: LargeContractToUpgradeToFactory;
  let approvalProgramToUpdateTo: Uint8Array;
  let clearStateProgramToUpdateTo: Uint8Array;

  let creator: Address & Account & TransactionSignerAccount;
  let admin: Address & Account & TransactionSignerAccount;
  let user: Address & Account & TransactionSignerAccount;

  beforeAll(async () => {
    await localnet.newScope();
    const { algorand, generateAccount } = localnet.context;

    creator = await generateAccount({ initialFunds: (100).algo() });
    admin = await generateAccount({ initialFunds: (100).algo() });
    user = await generateAccount({ initialFunds: (100).algo() });

    factory = algorand.client.getTypedAppFactory(MockUpgradeableFactory, {
      defaultSender: creator,
      defaultSigner: creator.signer,
    });

    // prepare contract to upgrade to
    {
      updatedContractFactory = localnet.algorand.client.getTypedAppFactory(LargeContractToUpgradeToFactory, {
        defaultSender: creator,
        defaultSigner: creator.signer,
      });
      const { result } = await updatedContractFactory.deploy();
      expect(result.appId).not.toEqual(0n);

      // ensure large contrat
      const app = await localnet.algorand.app.getById(result.appId);
      approvalProgramToUpdateTo = app.approvalProgram;
      clearStateProgramToUpdateTo = app.clearStateProgram;
      expect(approvalProgramToUpdateTo.length + clearStateProgramToUpdateTo.length).toBeGreaterThan(PAGE_SIZE);
    }
  });

  test("deploys with correct state", async () => {
    const { appClient, result } = await factory.deploy({
      createParams: {
        sender: creator,
        method: "create",
        args: [MIN_UPGRADE_DELAY],
        extraProgramPages: 3,
      },
    });
    appId = result.appId;
    client = appClient;

    expect(appId).not.toEqual(0n);
    expect(await client.state.global.isInitialised()).toBeFalsy();
    expect(await client.state.global.minUpgradeDelay()).toEqual({
      delay_0: 0n,
      delay_1: MIN_UPGRADE_DELAY,
      timestamp: 0n,
    });
    expect(await client.state.global.scheduledContractUpgrade()).toBeUndefined();
    expect(await client.state.global.version()).toEqual(1n);
    expect(await client.getActiveMinUpgradeDelay()).toEqual(MIN_UPGRADE_DELAY);
    expect(Uint8Array.from(await client.defaultAdminRole())).toEqual(DEFAULT_ADMIN_ROLE);
    expect(Uint8Array.from(await client.getRoleAdmin({ args: [DEFAULT_ADMIN_ROLE] }))).toEqual(DEFAULT_ADMIN_ROLE);
    expect(Uint8Array.from(await client.upgradableAdminRole())).toEqual(UPGRADEABLE_ADMIN_ROLE);
    expect(Uint8Array.from(await client.getRoleAdmin({ args: [UPGRADEABLE_ADMIN_ROLE] }))).toEqual(DEFAULT_ADMIN_ROLE);
  });

  describe("when uninitialised", () => {
    test("fails to schedule contract upgrade", async () => {
      await expect(
        client.send.scheduleContractUpgrade({ sender: admin, args: [getRandomBytes(32), 0] }),
      ).rejects.toThrow("Uninitialised contract");
    });

    test("fails to cancel contract upgrade", async () => {
      await expect(client.send.cancelContractUpgrade({ sender: admin, args: [] })).rejects.toThrow(
        "Uninitialised contract",
      );
    });

    test("fails to complete contract upgrade", async () => {
      await expect(client.send.update.completeContractUpgrade({ sender: admin, args: [] })).rejects.toThrow(
        "Uninitialised contract",
      );
    });

    test("fails to upgrade min delay", async () => {
      await expect(client.send.updateMinUpgradeDelay({ sender: admin, args: [SECONDS_IN_DAY, 0] })).rejects.toThrow(
        "Uninitialised contract",
      );
    });

    test("fails to initialise if caller is not creator", async () => {
      await expect(client.send.initialise({ sender: admin, args: [admin.toString()] })).rejects.toThrow(
        "Caller must be the contract creator",
      );
    });

    test("succeeds to initialise and sets correct state", async () => {
      const APP_MIN_BALANCE = (190_000).microAlgos();
      const fundingTxn = await localnet.algorand.createTransaction.payment({
        sender: creator,
        receiver: getApplicationAddress(appId),
        amount: APP_MIN_BALANCE,
      });
      await client
        .newGroup()
        .addTransaction(fundingTxn)
        .initialise({
          args: [admin.toString()],
          boxReferences: [
            getRoleBoxKey(DEFAULT_ADMIN_ROLE),
            getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, admin.publicKey),
            getRoleBoxKey(UPGRADEABLE_ADMIN_ROLE),
            getAddressRolesBoxKey(UPGRADEABLE_ADMIN_ROLE, admin.publicKey),
          ],
        })
        .send();
      expect(await client.state.global.isInitialised()).toBeTruthy();
      expect(await client.hasRole({ args: [DEFAULT_ADMIN_ROLE, admin.toString()] })).toBeTruthy();
      expect(await client.hasRole({ args: [UPGRADEABLE_ADMIN_ROLE, admin.toString()] })).toBeTruthy();
    });
  });

  describe("update min upgrade delay", () => {
    test("fails when caller is not upgradeable admin", async () => {
      await expect(
        client.send.updateMinUpgradeDelay({
          sender: user,
          args: [SECONDS_IN_DAY, 0],
          boxReferences: [
            getRoleBoxKey(UPGRADEABLE_ADMIN_ROLE),
            getAddressRolesBoxKey(UPGRADEABLE_ADMIN_ROLE, user.publicKey),
          ],
        }),
      ).rejects.toThrow("Access control unauthorised account");
    });

    test("fails when timestamp is not sufficiently in future", async () => {
      const prevTimestamp = await getPrevBlockTimestamp(localnet);
      const timestamp = prevTimestamp + MIN_UPGRADE_DELAY - 1n;
      await expect(
        client.send.updateMinUpgradeDelay({
          sender: admin,
          args: [MIN_UPGRADE_DELAY, timestamp],
          boxReferences: [
            getRoleBoxKey(UPGRADEABLE_ADMIN_ROLE),
            getAddressRolesBoxKey(UPGRADEABLE_ADMIN_ROLE, admin.publicKey),
          ],
        }),
      ).rejects.toThrow("Must schedule at least min upgrade delay time in future");
    });

    test("succeeds and has pending delay change", async () => {
      let prevTimestamp = await getPrevBlockTimestamp(localnet);
      const timestamp = prevTimestamp + MIN_UPGRADE_DELAY;

      // temporary change which becomes active
      const tempMinUpgradeDelay = getRandomUInt(SECONDS_IN_HOUR);
      const res = await client.send.updateMinUpgradeDelay({
        sender: admin,
        args: [tempMinUpgradeDelay, timestamp],
        boxReferences: [
          getRoleBoxKey(UPGRADEABLE_ADMIN_ROLE),
          getAddressRolesBoxKey(UPGRADEABLE_ADMIN_ROLE, admin.publicKey),
        ],
      });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("MinimumUpgradeDelayChange(uint64,uint64)", [tempMinUpgradeDelay, timestamp]),
      );
      expect(await client.state.global.minUpgradeDelay()).toEqual({
        delay_0: MIN_UPGRADE_DELAY,
        delay_1: tempMinUpgradeDelay,
        timestamp: timestamp,
      });

      // not active and then active
      expect(await client.getActiveMinUpgradeDelay()).toEqual(MIN_UPGRADE_DELAY);
      prevTimestamp = await getPrevBlockTimestamp(localnet);
      await advancePrevBlockTimestamp(localnet, timestamp - prevTimestamp - 1n);
      expect(await client.getActiveMinUpgradeDelay()).toEqual(MIN_UPGRADE_DELAY);
      await advancePrevBlockTimestamp(localnet, 1n);
      expect(await client.getActiveMinUpgradeDelay()).toEqual(tempMinUpgradeDelay);
    });

    test("succeeds and overrides pending delay change", async () => {
      let prevTimestamp = await getPrevBlockTimestamp(localnet);
      const prevTempMinUpgradeDelay = await client.getActiveMinUpgradeDelay();
      const timestamp = prevTimestamp + prevTempMinUpgradeDelay;

      // temporary change which never becomes active
      const tempMinUpgradeDelay = getRandomUInt(SECONDS_IN_HOUR);
      await client.send.updateMinUpgradeDelay({
        sender: admin,
        args: [tempMinUpgradeDelay, timestamp],
        boxReferences: [
          getRoleBoxKey(UPGRADEABLE_ADMIN_ROLE),
          getAddressRolesBoxKey(UPGRADEABLE_ADMIN_ROLE, admin.publicKey),
        ],
      });
      expect(await client.state.global.minUpgradeDelay()).toEqual({
        delay_0: prevTempMinUpgradeDelay,
        delay_1: tempMinUpgradeDelay,
        timestamp: timestamp,
      });

      // override temporary change which becomes active
      const res = await client.send.updateMinUpgradeDelay({
        sender: admin,
        args: [MIN_UPGRADE_DELAY, timestamp],
        boxReferences: [
          getRoleBoxKey(UPGRADEABLE_ADMIN_ROLE),
          getAddressRolesBoxKey(UPGRADEABLE_ADMIN_ROLE, admin.publicKey),
        ],
      });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("MinimumUpgradeDelayChange(uint64,uint64)", [MIN_UPGRADE_DELAY, timestamp]),
      );
      expect(await client.state.global.minUpgradeDelay()).toEqual({
        delay_0: prevTempMinUpgradeDelay,
        delay_1: MIN_UPGRADE_DELAY,
        timestamp: timestamp,
      });

      // not active and then active
      expect(await client.getActiveMinUpgradeDelay()).toEqual(prevTempMinUpgradeDelay);
      prevTimestamp = await getPrevBlockTimestamp(localnet);
      await advancePrevBlockTimestamp(localnet, timestamp - prevTimestamp);
      expect(await client.getActiveMinUpgradeDelay()).toEqual(MIN_UPGRADE_DELAY);
    });
  });

  describe("schedule contract upgrade", () => {
    test("fails when caller is not upgradeable admin", async () => {
      await expect(
        client.send.scheduleContractUpgrade({
          sender: user,
          args: [getRandomBytes(32), 0],
          boxReferences: [
            getRoleBoxKey(UPGRADEABLE_ADMIN_ROLE),
            getAddressRolesBoxKey(UPGRADEABLE_ADMIN_ROLE, user.publicKey),
          ],
        }),
      ).rejects.toThrow("Access control unauthorised account");
    });

    test("fails when timestamp is not sufficiently in future", async () => {
      const prevTimestamp = await getPrevBlockTimestamp(localnet);
      const timestamp = prevTimestamp + MIN_UPGRADE_DELAY - 1n;
      await expect(
        client.send.scheduleContractUpgrade({
          sender: admin,
          args: [getRandomBytes(32), timestamp],
          boxReferences: [
            getRoleBoxKey(UPGRADEABLE_ADMIN_ROLE),
            getAddressRolesBoxKey(UPGRADEABLE_ADMIN_ROLE, admin.publicKey),
          ],
        }),
      ).rejects.toThrow("Must schedule at least min upgrade delay time in future");
    });

    test("succeeds and sets scheduled upgrade", async () => {
      const programSha256 = getRandomBytes(32);
      const prevTimestamp = await getPrevBlockTimestamp(localnet);
      const timestamp = prevTimestamp + MIN_UPGRADE_DELAY;

      const res = await client.send.scheduleContractUpgrade({
        sender: admin,
        args: [programSha256, timestamp],
        boxReferences: [
          getRoleBoxKey(UPGRADEABLE_ADMIN_ROLE),
          getAddressRolesBoxKey(UPGRADEABLE_ADMIN_ROLE, admin.publicKey),
        ],
      });

      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("UpgradeScheduled(byte[32],uint64)", [programSha256, timestamp]),
      );
      expect(await client.state.global.scheduledContractUpgrade()).toEqual({
        programSha256: [...programSha256],
        timestamp,
      });
    });

    test("succeeds and overrides existing scheduled upgrade", async () => {
      expect(await client.state.global.scheduledContractUpgrade()).toBeDefined();

      const programSha256 = getRandomBytes(32);
      const prevTimestamp = await getPrevBlockTimestamp(localnet);
      const timestamp = prevTimestamp + MIN_UPGRADE_DELAY;

      const res = await client.send.scheduleContractUpgrade({
        sender: admin,
        args: [programSha256, timestamp],
        boxReferences: [
          getRoleBoxKey(UPGRADEABLE_ADMIN_ROLE),
          getAddressRolesBoxKey(UPGRADEABLE_ADMIN_ROLE, admin.publicKey),
        ],
      });

      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("UpgradeScheduled(byte[32],uint64)", [programSha256, timestamp]),
      );
      expect(await client.state.global.scheduledContractUpgrade()).toEqual({
        programSha256: [...programSha256],
        timestamp,
      });
    });
  });

  describe("cancel contract upgrade", () => {
    test("fails when caller is not upgradeable admin", async () => {
      await expect(
        client.send.cancelContractUpgrade({
          sender: user,
          args: [],
          boxReferences: [
            getRoleBoxKey(UPGRADEABLE_ADMIN_ROLE),
            getAddressRolesBoxKey(UPGRADEABLE_ADMIN_ROLE, user.publicKey),
          ],
        }),
      ).rejects.toThrow("Access control unauthorised account");
    });

    test("succeeds and removes scheduled upgrade", async () => {
      expect(await client.state.global.scheduledContractUpgrade()).toBeDefined();

      const timestamp = await getPrevBlockTimestamp(localnet);
      const res = await client.send.cancelContractUpgrade({
        sender: admin,
        args: [],
        boxReferences: [
          getRoleBoxKey(UPGRADEABLE_ADMIN_ROLE),
          getAddressRolesBoxKey(UPGRADEABLE_ADMIN_ROLE, admin.publicKey),
        ],
      });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(getEventBytes("UpgradeCancelled(uint64)", [timestamp]));
      expect(await client.state.global.scheduledContractUpgrade()).toBeUndefined();
    });

    test("fails when no upgrade scheduled", async () => {
      expect(await client.state.global.scheduledContractUpgrade()).toBeUndefined();
      await expect(
        client.send.cancelContractUpgrade({
          sender: admin,
          args: [],
          boxReferences: [
            getRoleBoxKey(UPGRADEABLE_ADMIN_ROLE),
            getAddressRolesBoxKey(UPGRADEABLE_ADMIN_ROLE, admin.publicKey),
          ],
        }),
      ).rejects.toThrow("Upgrade not scheduled");
    });
  });

  describe("complete contract upgrade", () => {
    describe("when no upgrade scheduled", () => {
      test("fails", async () => {
        expect(await client.state.global.scheduledContractUpgrade()).toBeUndefined();
        await expect(client.send.update.completeContractUpgrade({ sender: user, args: [] })).rejects.toThrow(
          "Upgrade not scheduled",
        );
      });
    });

    describe("when upgrade scheduled", () => {
      beforeAll(async () => {
        // schedule upgrade
        const programSha256 = calculateProgramSha256(approvalProgramToUpdateTo, clearStateProgramToUpdateTo);
        const prevTimestamp = await getPrevBlockTimestamp(localnet);
        const timestamp = prevTimestamp + MIN_UPGRADE_DELAY;
        await client.send.scheduleContractUpgrade({
          sender: admin,
          args: [programSha256, timestamp],
          boxReferences: [
            getRoleBoxKey(UPGRADEABLE_ADMIN_ROLE),
            getAddressRolesBoxKey(UPGRADEABLE_ADMIN_ROLE, admin.publicKey),
          ],
        });
        expect(await client.state.global.scheduledContractUpgrade()).toEqual({
          programSha256: [...programSha256],
          timestamp,
        });
      });

      test("fails when timestamp not been reached", async () => {
        const prevTimestamp = await getPrevBlockTimestamp(localnet);
        const { timestamp: scheduledTimestamp } = (await client.state.global.scheduledContractUpgrade())!;
        await advancePrevBlockTimestamp(localnet, scheduledTimestamp - prevTimestamp - 1n);
        await expect(client.send.update.completeContractUpgrade({ sender: user, args: [] })).rejects.toThrow(
          "Schedule complete ts not met",
        );
      });

      test("fails when program sha256 is different", async () => {
        const prevTimestamp = await getPrevBlockTimestamp(localnet);
        const { timestamp: scheduledTimestamp } = (await client.state.global.scheduledContractUpgrade())!;
        await advancePrevBlockTimestamp(localnet, scheduledTimestamp - prevTimestamp);
        await expect(client.send.update.completeContractUpgrade({ sender: user, args: [] })).rejects.toThrow(
          "Invalid program SHA256",
        );
      });

      test("succeeds and completes scheduled upgrade", async () => {
        const { timestamp: scheduledTimestamp } = (await client.state.global.scheduledContractUpgrade())!;
        expect(await getPrevBlockTimestamp(localnet)).toBeGreaterThanOrEqual(scheduledTimestamp);

        const oldVersion = (await client.state.global.version()) || 0n;
        const programSha256 = calculateProgramSha256(approvalProgramToUpdateTo, clearStateProgramToUpdateTo);

        const res = await localnet.algorand.send.appUpdateMethodCall({
          sender: user,
          appId,
          method: client.appClient.getABIMethod("complete_contract_upgrade"),
          approvalProgram: approvalProgramToUpdateTo,
          clearStateProgram: clearStateProgramToUpdateTo,
        });

        const updatedApp = await localnet.algorand.app.getById(appId);
        expect(updatedApp.approvalProgram).toEqual(approvalProgramToUpdateTo);
        expect(updatedApp.clearStateProgram).toEqual(clearStateProgramToUpdateTo);
        expect(res.confirmations[0].logs).toBeDefined();
        expect(res.confirmations[0].logs![0]).toEqual(
          getEventBytes("UpgradeCompleted(byte[32],uint64)", [programSha256, oldVersion + 1n]),
        );
        expect(await client.state.global.scheduledContractUpgrade()).toBeUndefined();
        expect(await client.state.global.version()).toEqual(oldVersion + 1n);
        expect(await client.state.global.isInitialised()).toBeFalsy();
      });
    });
  });
});
