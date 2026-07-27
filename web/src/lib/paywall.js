/**
 * Browser MPP (Machine Payments Protocol) client.
 *
 * Implements the client half of the "charge" intent against the AgentPay
 * gateway, wire-compatible with mppx + @stellar/mpp:
 *
 *   1. POST, receive 402 + `WWW-Authenticate: Payment id=…, realm=…, method=stellar,
 *      intent=charge, request=<base64url JSON>, expires=…`
 *   2. Build a Soroban SEP-41 `transfer` on the XLM Stellar Asset Contract,
 *      simulate it (rpc.prepareTransaction) and sign the envelope with
 *      Freighter (pull mode - the gateway broadcasts).
 *   3. Retry with `Authorization: Payment <base64url {challenge, payload,
 *      source}>`. The gateway verifies the transfer on-chain and serves the
 *      AI response.
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { NETWORK_PASSPHRASE, RPC_URL, XLM_SAC, signXdr } from "./stellar.js";

const rpc = new StellarSdk.rpc.Server(RPC_URL);

// Small base64url helpers.

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Safe JSON parse: returns null instead of throwing. */
function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Returns the parsed JSON body of a response, or null if unreadable. */
export async function safeJson(res) {
  const text = await res.text();
  return tryJson(text);
}

// Challenge parsing.

/**
 * Parses the `WWW-Authenticate` challenge header.
 * Returns { id, realm, method, intent, request, expires, description, raw }.
 */
export function parseChallenge(wwwAuthenticate) {
  if (!wwwAuthenticate) throw new Error("Missing WWW-Authenticate header");
  const m = /^Payment\s+(.+)$/is.exec(wwwAuthenticate);
  if (!m) throw new Error("No Payment scheme in challenge");
  const raw = m[1];

  // key="value" (supports \" and \\ escapes)
  const params = {};
  const pairRe = /([A-Za-z0-9_-]+)="((?:\\.|[^"\\])*)"|\s/g;
  let match;
  while ((match = pairRe.exec(raw))) {
    if (match[1]) {
      params[match[1]] = match[2].replace(/\\(["\\])/g, "$1");
    }
  }

  if (!params.id || !params.realm || !params.method || !params.request) {
    throw new Error("Incomplete Payment challenge");
  }

  const request = JSON.parse(b64urlDecode(params.request));
  return {
    id: params.id,
    realm: params.realm,
    method: params.method,
    intent: params.intent,
    request, // { amount (base units), currency, recipient, methodDetails }
    expires: params.expires,
    description: params.description,
    rawRequest: params.request, // keep the exact base64url string to echo back
  };
}

// Payment transaction construction and signing.

/**
 * Builds and signs (via Freighter) the SAC XLM transfer that settles the
 * challenge. Returns the signed transaction XDR (pull mode).
 */
export async function buildAndSignPayment(challenge, fromAddress) {
  const { amount, currency, recipient } = challenge.request;
  if (currency !== XLM_SAC) {
    throw new Error(`Unsupported currency ${currency} - expected XLM SAC`);
  }

  const account = await rpc.getAccount(fromAddress);
  const contract = new StellarSdk.Contract(currency);
  const builder = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  }).addOperation(
    contract.call(
      "transfer",
      new StellarSdk.Address(fromAddress).toScVal(),
      new StellarSdk.Address(recipient).toScVal(),
      StellarSdk.nativeToScVal(BigInt(amount), { type: "i128" }),
    ),
  );

  // Bound the tx to the challenge lifetime (mppx enforces maxTime ≤ expires).
  if (challenge.expires) {
    const expiresUnix = Math.floor(new Date(challenge.expires).getTime() / 1000);
    builder.setTimebounds(0, expiresUnix);
  } else {
    builder.setTimeout(180);
  }

  const tx = builder.build();

  // Simulate to attach the Soroban footprint and authorization entries.
  const prepared = await rpc.prepareTransaction(tx);
  const signedXdr = await signXdr(prepared.toXDR());
  return signedXdr;
}

// Credential serialization.

export function serializeCredential(challenge, signedXdr, sourceAddress) {
  const wire = {
    challenge: {
      id: challenge.id,
      realm: challenge.realm,
      method: challenge.method,
      intent: challenge.intent,
      request: challenge.rawRequest, // exact base64url string from the server
      ...(challenge.expires ? { expires: challenge.expires } : {}),
      ...(challenge.description ? { description: challenge.description } : {}),
    },
    payload: { type: "transaction", transaction: signedXdr },
    // Network in the DID must match the gateway network (testnet only).
    source: `did:pkh:stellar:testnet:${sourceAddress}`,
  };
  return `Payment ${b64urlEncode(JSON.stringify(wire))}`;
}

// Full pay-then-get flow.

/**
 * Calls the paywalled endpoint. If the server responds 402, pays with the
 * connected Freighter wallet and retries. Throws descriptive errors at every
 * failure point so nothing can fail silently.
 *
 * @param {object} opts
 * @param {string} opts.url
 * @param {object} opts.body         JSON body to POST
 * @param {string} opts.sourceAddress Freighter public key
 * @param {(stage: string, info?: object) => void} opts.onStage
 * @returns {Promise<{status: number, data: object, ok: boolean}>}
 */
export async function payAndRetry({ url, body, sourceAddress, onStage }) {
  const headers = { "Content-Type": "application/json" };
  const post = (extra = {}) =>
    fetch(url, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });

  onStage?.("requesting");
  let res = await post();

  if (res.status !== 402) {
    // Unexpected (e.g. 500) - surface it with the body.
    const data = (await safeJson(res)) || { error: `HTTP ${res.status}` };
    return { status: res.status, ok: res.ok, data };
  }

  const challenge = parseChallenge(res.headers.get("WWW-Authenticate"));
  onStage?.("payment-required", { challenge });

  const signedXdr = await buildAndSignPayment(challenge, sourceAddress);
  onStage?.("signed");

  const credential = serializeCredential(challenge, signedXdr, sourceAddress);
  onStage?.("settling");

  res = await post({ Authorization: credential });

  if (res.status === 402) {
    // The gateway rejected the credential. Most common cause: hitting Send
    // twice quickly (the challenge was already redeemed), or the signed
    // transaction drifted from the challenge.
    const data = (await safeJson(res)) || {};
    throw new Error(
      data.error ||
        "The gateway did not accept the payment credential. This usually " +
          "means you pressed Send twice - the first payment already went " +
          "through. Check your balance and try once more.",
    );
  }

  const data = (await safeJson(res)) || { error: `Unreadable response (HTTP ${res.status})` };
  return { status: res.status, ok: res.ok, data };
}
