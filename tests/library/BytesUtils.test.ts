import { algorandFixture } from "@algorandfoundation/algokit-utils/testing";
import type { TransactionSignerAccount } from "@algorandfoundation/algokit-utils/types/account";
import { type Account, type Address } from "algosdk";

import { BytesUtilsExposedClient, BytesUtilsExposedFactory } from "../../specs/client/BytesUtilsExposed.client.ts";
import { convertNumberToBytes } from "../utils/bytes.ts";
import { MAX_UINT64, MAX_UINT256 } from "../utils/uint.ts";

describe("BytesUtils", () => {
  const localnet = algorandFixture();

  let factory: BytesUtilsExposedFactory;
  let client: BytesUtilsExposedClient;
  let appId: bigint;

  let creator: Address & Account & TransactionSignerAccount;

  beforeAll(async () => {
    await localnet.newScope();
    const { algorand, generateAccount } = localnet.context;

    creator = await generateAccount({ initialFunds: (100).algo() });

    factory = algorand.client.getTypedAppFactory(BytesUtilsExposedFactory, {
      defaultSender: creator,
      defaultSigner: creator.signer,
    });

    // deploy library
    {
      const { appClient, result } = await factory.deploy({
        createParams: { sender: creator },
      });
      appId = result.appId;
      client = appClient;

      expect(appId).not.toEqual(0n);
    }
  });

  describe("convert uint64 to bytes32", () => {
    test.each([{ a: 0n }, { a: 15n }, { a: 32953523n }, { a: MAX_UINT64 }])("of $a succeeds", async ({ a }) => {
      expect(await client.convertUint64ToBytes32({ args: [a] })).toEqual(convertNumberToBytes(a, 32));
    });
  });

  describe("safe convert bytes32 to uint64", () => {
    test.each([{ a: MAX_UINT64 + 1n }, { a: MAX_UINT256 }])("of $a fails", async ({ a }) => {
      await expect(client.send.safeConvertBytes32ToUint64({ args: [convertNumberToBytes(a, 32)] })).rejects.toThrow(
        "Unsafe conversion of bytes32 to uint64",
      );
    });

    test.each([{ a: 0n }, { a: 15n }, { a: 32953523n }, { a: MAX_UINT64 }])("of $a succeeds", async ({ a }) => {
      expect(await client.safeConvertBytes32ToUint64({ args: [convertNumberToBytes(a, 32)] })).toEqual(a);
    });
  });
});
