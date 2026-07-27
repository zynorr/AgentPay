import * as StellarSdk from "@stellar/stellar-sdk";
import {
  isConnected,
  requestAccess,
  getAddress,
  getNetwork,
  signTransaction,
} from "@stellar/freighter-api";

export const NETWORK = "testnet";
export const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
export const RPC_URL =
  import.meta.env.VITE_STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
export const HORIZON_URL =
  import.meta.env.VITE_STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";

// SEP-41 Stellar Asset Contract for the native XLM asset on testnet.
export const XLM_SAC =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

export const rpc = new StellarSdk.rpc.Server(RPC_URL);
export const horizon = new StellarSdk.Horizon.Server(HORIZON_URL);

export const explorerUrl = (txHash) =>
  `https://stellar.expert/explorer/testnet/tx/${txHash}`;

export const shortAddr = (addr) =>
  addr ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : "";

// Freighter helpers.

export async function freighterAvailable() {
  const { isConnected: installed } = await isConnected();
  return installed;
}

export async function connectWallet() {
  const { address, error } = await requestAccess();
  if (error) throw new Error(error.message);
  const { network, error: netErr } = await getNetwork();
  if (netErr) throw new Error(netErr.message);
  if (network !== NETWORK) {
    throw new Error(
      `Freighter is on "${network}" - switch it to TESTNET before continuing.`,
    );
  }
  return address;
}

export async function getWalletAddress() {
  const { address } = await getAddress();
  return address || null;
}

export async function getBalance(address) {
  try {
    const account = await horizon.loadAccount(address);
    const native = account.balances.find((b) => b.asset_type === "native");
    return native ? Number(native.balance).toFixed(4) : "0.0000";
  } catch {
    return "0.0000";
  }
}

export async function fundFromFriendbot(address) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${address}`);
  if (!res.ok) throw new Error(`Friendbot failed: ${res.status}`);
  return res.json();
}

/** Signs a Soroban transaction XDR with Freighter. */
export async function signXdr(xdr) {
  const { signedTxXdr, error } = await signTransaction(xdr, {
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  if (error) throw new Error(error.message);
  return signedTxXdr;
}
