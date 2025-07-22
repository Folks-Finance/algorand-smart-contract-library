import { algorandFixture } from "@algorandfoundation/algokit-utils/testing";
import type { TransactionSignerAccount } from "@algorandfoundation/algokit-utils/types/account";
import { getApplicationAddress } from "algosdk";
import type { Account, Address } from "algosdk";

import { MockAccessControlClient, MockAccessControlFactory } from "../../specs/client/MockAccessControl.client.ts";
import { getAddressRolesBoxKey, getRoleBoxKey } from "../utils/boxes.ts";
import { getEventBytes, getRandomBytes } from "../utils/bytes.ts";

describe("AccessControl", () => {
  const localnet = algorandFixture();

  const DEFAULT_ADMIN_ROLE = new Uint8Array(16);
  const ROLE = getRandomBytes(16);
  const OTHER_ROLE = getRandomBytes(16);

  let factory: MockAccessControlFactory;
  let client: MockAccessControlClient;
  let appId: bigint;

  let creator: Address & Account & TransactionSignerAccount;
  let defaultAdmin: Address & Account & TransactionSignerAccount;
  let otherAdmin: Address & Account & TransactionSignerAccount;
  let user: Address & Account & TransactionSignerAccount;
  let otherUser: Address & Account & TransactionSignerAccount;

  beforeAll(async () => {
    await localnet.newScope();
    const { algorand, generateAccount } = localnet.context;

    creator = await generateAccount({ initialFunds: (100).algo() });
    defaultAdmin = await generateAccount({ initialFunds: (100).algo() });
    otherAdmin = await generateAccount({ initialFunds: (100).algo() });
    user = await generateAccount({ initialFunds: (100).algo() });
    otherUser = await generateAccount({ initialFunds: (100).algo() });

    factory = algorand.client.getTypedAppFactory(MockAccessControlFactory, {
      defaultSender: creator,
      defaultSigner: creator.signer,
    });
  });

  test("deploys with correct state", async () => {
    const { appClient, result } = await factory.deploy();
    appId = result.appId;
    client = appClient;

    expect(appId).not.toEqual(0n);
    expect(await client.state.global.isInitialised()).toBeFalsy();
    expect(Uint8Array.from(await client.defaultAdminRole())).toEqual(DEFAULT_ADMIN_ROLE);
  });

  describe("initialise", () => {
    afterAll(async () => {
      // fund for enough balance for three roles with one non default role admin
      const APP_MIN_BALANCE = (145_400).microAlgos();
      await localnet.algorand.send.payment({
        sender: creator,
        receiver: getApplicationAddress(appId),
        amount: APP_MIN_BALANCE,
      });
    });

    test("succeeds and sets initialised state", async () => {
      const APP_MIN_BALANCE = (127_700).microAlgos();
      const fundingTxn = await localnet.algorand.createTransaction.payment({
        sender: creator,
        receiver: getApplicationAddress(appId),
        amount: APP_MIN_BALANCE,
      });
      await client
        .newGroup()
        .addTransaction(fundingTxn)
        .initialise({
          args: [defaultAdmin.toString()],
          boxReferences: [
            getRoleBoxKey(DEFAULT_ADMIN_ROLE),
            getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, defaultAdmin.publicKey),
          ],
        })
        .send();

      expect(await client.state.global.isInitialised()).toBeTruthy();
      expect(await client.hasRole({ args: [DEFAULT_ADMIN_ROLE, defaultAdmin.toString()] })).toBeTruthy();
      expect(Uint8Array.from(await client.getRoleAdmin({ args: [DEFAULT_ADMIN_ROLE] }))).toEqual(DEFAULT_ADMIN_ROLE);

      await expect(client.state.box.roles.value(DEFAULT_ADMIN_ROLE)).rejects.toThrow("box not found");
      const addressRole = await client.state.box.addressesRoles.value({
        role: DEFAULT_ADMIN_ROLE,
        address: defaultAdmin.toString(),
      });
      expect(addressRole).toBeTruthy();
    });
  });

  test("unknown role's admin is default admin role", async () => {
    const { return: roleAdmin } = await client.send.getRoleAdmin({
      sender: user,
      args: [ROLE],
      boxReferences: [getRoleBoxKey(ROLE)],
    });
    expect(roleAdmin).toBeDefined();
    expect(Uint8Array.from(roleAdmin!)).toEqual(DEFAULT_ADMIN_ROLE);
  });

  describe("check sender role", () => {
    test("fails when caller doesn't have role", async () => {
      await expect(
        client.send.checkSenderRole({
          sender: user,
          args: [DEFAULT_ADMIN_ROLE],
          boxReferences: [getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, user.publicKey)],
        }),
      ).rejects.toThrow("Access control unauthorised account");
    });

    test("succeeds when caller has role", async () => {
      await expect(
        client.send.checkSenderRole({
          sender: defaultAdmin,
          args: [DEFAULT_ADMIN_ROLE],
          boxReferences: [getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, defaultAdmin.publicKey)],
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("check role", () => {
    test("fails and ignores caller when account passed doesn't have role", async () => {
      await expect(
        client.send.checkRole({
          sender: defaultAdmin,
          args: [DEFAULT_ADMIN_ROLE, user.toString()],
          boxReferences: [getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, user.publicKey)],
        }),
      ).rejects.toThrow("Access control unauthorised account");
    });

    test("succeeds and ignores caller when account passed has have role", async () => {
      await expect(
        client.send.checkRole({
          sender: user,
          args: [DEFAULT_ADMIN_ROLE, defaultAdmin.toString()],
          boxReferences: [getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, defaultAdmin.publicKey)],
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("grant role", () => {
    test("fails for new role when caller is not default admin", async () => {
      await expect(
        client.send.grantRole({
          sender: user,
          args: [ROLE, user.toString()],
          boxReferences: [getRoleBoxKey(ROLE), getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, user.publicKey)],
        }),
      ).rejects.toThrow("Access control unauthorised account");
    });

    test("succeeds on first time", async () => {
      const res = await client.send.grantRole({
        sender: defaultAdmin,
        args: [ROLE, user.toString()],
        boxReferences: [
          getRoleBoxKey(ROLE),
          getAddressRolesBoxKey(ROLE, user.publicKey),
          getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, defaultAdmin.publicKey),
        ],
      });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("RoleGranted(byte[16],address,address)", [ROLE, user.publicKey, defaultAdmin.publicKey]),
      );
      expect(await client.hasRole({ args: [ROLE, user.toString()] })).toBeTruthy();
      expect(Uint8Array.from(await client.getRoleAdmin({ args: [ROLE] }))).toEqual(DEFAULT_ADMIN_ROLE);
      expect(await client.hasRole({ args: [ROLE, defaultAdmin.toString()] })).toBeFalsy();

      await expect(client.state.box.roles.value(ROLE)).rejects.toThrow("box not found");
      const addressRole = await client.state.box.addressesRoles.value({
        role: ROLE,
        address: user.toString(),
      });
      expect(addressRole).toBeTruthy();
    });

    test("succeeds on second time without emitting event", async () => {
      const res = await client.send.grantRole({
        sender: defaultAdmin,
        args: [ROLE, user.toString()],
        boxReferences: [
          getRoleBoxKey(ROLE),
          getAddressRolesBoxKey(ROLE, user.publicKey),
          getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, defaultAdmin.publicKey),
        ],
      });
      expect(res.confirmations[0].logs).toBeUndefined();
      expect(await client.hasRole({ args: [ROLE, user.toString()] })).toBeTruthy();
      expect(Uint8Array.from(await client.getRoleAdmin({ args: [ROLE] }))).toEqual(DEFAULT_ADMIN_ROLE);
      expect(await client.hasRole({ args: [ROLE, defaultAdmin.toString()] })).toBeFalsy();
    });
  });

  describe("revoke role", () => {
    describe("when role not had", () => {
      test("succeeds without emitting event", async () => {
        expect(await client.hasRole({ args: [OTHER_ROLE, user.toString()] })).toBeFalsy();

        const res = await client.send.revokeRole({
          sender: defaultAdmin,
          args: [OTHER_ROLE, user.toString()],
          boxReferences: [
            getRoleBoxKey(OTHER_ROLE),
            getAddressRolesBoxKey(OTHER_ROLE, user.publicKey),
            getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, defaultAdmin.publicKey),
          ],
        });
        expect(res.confirmations[0].logs).toBeUndefined();
      });
    });

    describe("when role had", () => {
      test("fails when caller is not default admin", async () => {
        await expect(
          client.send.revokeRole({
            sender: user,
            args: [ROLE, user.toString()],
            boxReferences: [getRoleBoxKey(ROLE), getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, user.publicKey)],
          }),
        ).rejects.toThrow("Access control unauthorised account");
      });

      test("succeeds", async () => {
        const res = await client.send.revokeRole({
          sender: defaultAdmin,
          args: [ROLE, user.toString()],
          boxReferences: [
            getRoleBoxKey(ROLE),
            getAddressRolesBoxKey(ROLE, user.publicKey),
            getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, defaultAdmin.publicKey),
          ],
        });
        expect(res.confirmations[0].logs).toBeDefined();
        expect(res.confirmations[0].logs![0]).toEqual(
          getEventBytes("RoleRevoked(byte[16],address,address)", [ROLE, user.publicKey, defaultAdmin.publicKey]),
        );
        expect(await client.hasRole({ args: [ROLE, user.toString()] })).toBeFalsy();

        await expect(client.state.box.addressesRoles.value({ role: ROLE, address: user.toString() })).rejects.toThrow(
          "box not found",
        );
      });

      test("succeeds on second time without emitting event", async () => {
        const res = await client.send.revokeRole({
          sender: defaultAdmin,
          args: [ROLE, user.toString()],
          boxReferences: [
            getRoleBoxKey(ROLE),
            getAddressRolesBoxKey(ROLE, user.publicKey),
            getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, defaultAdmin.publicKey),
          ],
        });
        expect(res.confirmations[0].logs).toBeUndefined();
        expect(await client.hasRole({ args: [ROLE, user.toString()] })).toBeFalsy();
      });
    });
  });

  describe("renounce role", () => {
    describe("when role not had", () => {
      test("succeeds without emitting event", async () => {
        expect(await client.hasRole({ args: [OTHER_ROLE, user.toString()] })).toBeFalsy();

        const res = await client.send.renounceRole({
          sender: user,
          args: [OTHER_ROLE],
          boxReferences: [getRoleBoxKey(OTHER_ROLE), getAddressRolesBoxKey(OTHER_ROLE, user.publicKey)],
        });
        expect(res.confirmations[0].logs).toBeUndefined();
      });
    });

    describe("when role had", () => {
      beforeAll(async () => {
        await client.send.grantRole({
          sender: defaultAdmin,
          args: [ROLE, user.toString()],
          boxReferences: [
            getRoleBoxKey(ROLE),
            getAddressRolesBoxKey(ROLE, user.publicKey),
            getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, defaultAdmin.publicKey),
          ],
        });
      });

      test("succeeds", async () => {
        const res = await client.send.renounceRole({
          sender: user,
          args: [ROLE],
          boxReferences: [getRoleBoxKey(ROLE), getAddressRolesBoxKey(ROLE, user.publicKey)],
        });
        expect(res.confirmations[0].logs).toBeDefined();
        expect(res.confirmations[0].logs![0]).toEqual(
          getEventBytes("RoleRevoked(byte[16],address,address)", [ROLE, user.publicKey, user.publicKey]),
        );
        expect(await client.hasRole({ args: [ROLE, user.toString()] })).toBeFalsy();

        await expect(client.state.box.addressesRoles.value({ role: ROLE, address: user.toString() })).rejects.toThrow(
          "box not found",
        );
      });

      test("succeeds on second time without emitting event", async () => {
        const res = await client.send.renounceRole({
          sender: user,
          args: [ROLE],
          boxReferences: [getRoleBoxKey(ROLE), getAddressRolesBoxKey(ROLE, user.publicKey)],
        });
        expect(res.confirmations[0].logs).toBeUndefined();
        expect(await client.hasRole({ args: [ROLE, user.toString()] })).toBeFalsy();
      });
    });
  });

  describe("set role admin", () => {
    beforeAll(async () => {
      await client.send.grantRole({
        sender: defaultAdmin,
        args: [ROLE, user.toString()],
        boxReferences: [
          getRoleBoxKey(ROLE),
          getAddressRolesBoxKey(ROLE, user.publicKey),
          getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, defaultAdmin.publicKey),
        ],
      });
      await client.send.grantRole({
        sender: defaultAdmin,
        args: [OTHER_ROLE, otherAdmin.toString()],
        boxReferences: [
          getRoleBoxKey(OTHER_ROLE),
          getAddressRolesBoxKey(OTHER_ROLE, otherAdmin.publicKey),
          getAddressRolesBoxKey(DEFAULT_ADMIN_ROLE, defaultAdmin.publicKey),
        ],
      });
    });

    test("succeeds", async () => {
      const res = await client.send.setRoleAdmin({
        sender: user,
        args: [ROLE, OTHER_ROLE],
        boxReferences: [getRoleBoxKey(ROLE)],
      });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("RoleAdminChanged(byte[16],byte[16],byte[16])", [ROLE, DEFAULT_ADMIN_ROLE, OTHER_ROLE]),
      );
      expect(await client.hasRole({ args: [ROLE, user.toString()] })).toBeTruthy();
      expect(Uint8Array.from(await client.getRoleAdmin({ args: [ROLE] }))).toEqual(OTHER_ROLE);

      const roleAdmin = await client.state.box.roles.value(ROLE);
      expect(roleAdmin).toBeDefined();
      expect(Uint8Array.from(roleAdmin!)).toEqual(OTHER_ROLE);
    });

    test("persists when new role and being granted for first time", async () => {
      const newRole = getRandomBytes(16);
      await client.send.setRoleAdmin({
        sender: user,
        args: [newRole, ROLE],
        boxReferences: [getRoleBoxKey(newRole)],
      });
      expect(Uint8Array.from(await client.getRoleAdmin({ args: [ROLE] }))).toEqual(OTHER_ROLE);
      expect(await client.hasRole({ args: [newRole, user.toString()] })).toBeFalsy();
      expect(await client.hasRole({ args: [newRole, otherUser.toString()] })).toBeFalsy();
      expect(await client.hasRole({ args: [DEFAULT_ADMIN_ROLE, user.toString()] })).toBeFalsy();

      await client.send.grantRole({
        sender: user,
        args: [newRole, otherUser.toString()],
        boxReferences: [
          getRoleBoxKey(newRole),
          getAddressRolesBoxKey(newRole, otherUser.publicKey),
          getAddressRolesBoxKey(ROLE, user.publicKey),
        ],
      });
      expect(Uint8Array.from(await client.getRoleAdmin({ args: [ROLE] }))).toEqual(OTHER_ROLE);
      expect(await client.hasRole({ args: [newRole, user.toString()] })).toBeFalsy();
      expect(await client.hasRole({ args: [newRole, otherUser.toString()] })).toBeTruthy();
      expect(await client.hasRole({ args: [DEFAULT_ADMIN_ROLE, user.toString()] })).toBeFalsy();
    });

    test("the new admin can grant roles", async () => {
      const res = await client.send.grantRole({
        sender: otherAdmin,
        args: [ROLE, otherUser.toString()],
        boxReferences: [
          getRoleBoxKey(ROLE),
          getAddressRolesBoxKey(ROLE, otherUser.publicKey),
          getAddressRolesBoxKey(OTHER_ROLE, otherAdmin.publicKey),
        ],
      });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("RoleGranted(byte[16],address,address)", [ROLE, otherUser.publicKey, otherAdmin.publicKey]),
      );
      expect(await client.hasRole({ args: [ROLE, user.toString()] })).toBeTruthy();
      expect(await client.hasRole({ args: [ROLE, otherUser.toString()] })).toBeTruthy();
      expect(Uint8Array.from(await client.getRoleAdmin({ args: [ROLE] }))).toEqual(OTHER_ROLE);
    });

    test("the new admin can revoke roles", async () => {
      const res = await client.send.revokeRole({
        sender: otherAdmin,
        args: [ROLE, otherUser.toString()],
        boxReferences: [
          getRoleBoxKey(ROLE),
          getAddressRolesBoxKey(ROLE, otherUser.publicKey),
          getAddressRolesBoxKey(OTHER_ROLE, otherAdmin.publicKey),
        ],
      });
      expect(res.confirmations[0].logs).toBeDefined();
      expect(res.confirmations[0].logs![0]).toEqual(
        getEventBytes("RoleRevoked(byte[16],address,address)", [ROLE, otherUser.publicKey, otherAdmin.publicKey]),
      );
      expect(await client.hasRole({ args: [ROLE, user.toString()] })).toBeTruthy();
      expect(await client.hasRole({ args: [ROLE, otherUser.toString()] })).toBeFalsy();
    });

    test("the old admin cannot grant roles", async () => {
      await expect(
        client.send.grantRole({
          sender: defaultAdmin,
          args: [ROLE, otherUser.toString()],
          boxReferences: [getRoleBoxKey(ROLE), getAddressRolesBoxKey(OTHER_ROLE, defaultAdmin.publicKey)],
        }),
      ).rejects.toThrow("Access control unauthorised account");
    });

    test("the old admin cannot revoke roles", async () => {
      await expect(
        client.send.revokeRole({
          sender: defaultAdmin,
          args: [ROLE, user.toString()],
          boxReferences: [getRoleBoxKey(ROLE), getAddressRolesBoxKey(OTHER_ROLE, defaultAdmin.publicKey)],
        }),
      ).rejects.toThrow("Access control unauthorised account");
    });
  });
});
