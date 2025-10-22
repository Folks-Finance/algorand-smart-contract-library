import { algorandFixture } from "@algorandfoundation/algokit-utils/testing";
import type { TransactionSignerAccount } from "@algorandfoundation/algokit-utils/types/account";
import type { Account, Address } from "algosdk";

import { MockInitialisableClient, MockInitialisableFactory } from "../../specs/client/MockInitialisable.client.ts";

describe("Initialisable", () => {
  const localnet = algorandFixture();

  let factory: MockInitialisableFactory;
  let client: MockInitialisableClient;
  let appId: bigint;

  let creator: Address & Account & TransactionSignerAccount;
  let user: Address & Account & TransactionSignerAccount;

  beforeAll(async () => {
    await localnet.newScope();
    const { algorand, generateAccount } = localnet.context;

    creator = await generateAccount({ initialFunds: (100).algo() });
    user = await generateAccount({ initialFunds: (100).algo() });

    factory = algorand.client.getTypedAppFactory(MockInitialisableFactory, {
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
    expect(await client.state.global.counter()).toEqual(0n);
  });

  test("test method cannot be called when uninitialised", async () => {
    await expect(client.send.canOnlyBeCalledWhenInitialised()).rejects.toThrow("Uninitialised contract");
  });

  describe("initialise", () => {
    test("succeeds and sets initialised state", async () => {
      const counter = 923n;
      await client.send.initialise({ args: [counter] });
      expect(await client.state.global.isInitialised()).toBeTruthy();
      expect(await client.state.global.counter()).toEqual(counter);
    });

    test("fails when already initialised", async () => {
      await expect(client.send.initialise({ args: [0] })).rejects.toThrow("Contract already initialised");
    });
  });

  test("test method can be called when initialised", async () => {
    await client.send.canOnlyBeCalledWhenInitialised();
  });
});
