import * as StellarSdk from "@stellar/stellar-sdk";
import { config } from "./config.js";

const { Keypair, TransactionBuilder, BASE_FEE, Contract, Address, nativeToScVal } =
  StellarSdk;

let rpc;
let keypair;

/**
 * Records a verified payment on the PaymentRegistry Soroban contract.
 * Best-effort: a failure here never fails the API response - the on-chain
 * ledger is a bonus layer on top of the gateway's JSONL ledger.
 *
 * @param {object} opts {payer: G..., amountBaseUnits: bigint, requestId: string}
 * @returns {Promise<{hash: string} | null>}
 */
export async function recordOnChainPayment({ payer, amountBaseUnits, requestId }) {
  if (!config.registryContractId || !config.recipientSecret) return null;

  try {
    rpc ??= new StellarSdk.rpc.Server(config.rpcUrl);
    keypair ??= Keypair.fromSecret(config.recipientSecret);
    const adminPub = keypair.publicKey();

    const account = await rpc.getAccount(adminPub);
    const contract = new Contract(config.registryContractId);

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(
        contract.call(
          "record_payment",
          new Address(payer).toScVal(),
          nativeToScVal(amountBaseUnits, { type: "i128" }),
          nativeToScVal(requestId, { type: "string" }),
        ),
      )
      .setTimeout(120)
      .build();

    const prepared = await rpc.prepareTransaction(tx);
    prepared.sign(keypair);

    const send = await rpc.sendTransaction(prepared);
    if (send.status === "PENDING" || send.status === "DUPLICATE") {
      const result = await rpc.pollTransaction(send.hash);
      if (result.status === "SUCCESS") {
        return { hash: send.hash };
      }
    }
    console.warn("[registry] recording not confirmed:", send.status, send.errorResult ?? "");
    return null;
  } catch (err) {
    console.warn("[registry] on-chain recording skipped:", err.message);
    return null;
  }
}
