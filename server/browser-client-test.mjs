#!/usr/bin/env node
/**
 * Reproduces the browser client (web/src/lib/paywall.js) verbatim in Node,
 * signing with a keypair instead of Freighter. If this works, the protocol
 * code is fine and the issue is Freighter/rendering in the browser.
 *
 * Usage: node scripts/browser-client-test.mjs "your prompt"
 */
import "dotenv/config";
import * as StellarSdk from "@stellar/stellar-sdk";

const prompt = process.argv.slice(2).join(" ") || "Why build on Stellar?";
const URL = process.env.SERVER_URL || "http://localhost:4000/api/ai/chat";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const RPC_URL = "https://soroban-testnet.stellar.org";
const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const rpc = new StellarSdk.rpc.Server(RPC_URL);

const keypair = StellarSdk.Keypair.fromSecret(process.env.AGENT_SECRET_KEY);
const sourceAddress = keypair.publicKey();
console.log("Paying from:", sourceAddress);

// ── copy of web/src/lib/paywall.js ───────────────────────────────────────
function b64urlEncode(str) {
  return Buffer.from(str, "utf8").toString("base64url");
}
function b64urlDecode(str) {
  return Buffer.from(str, "base64url").toString("utf8");
}

function parseChallenge(wwwAuthenticate) {
  const m = /^Payment\s+(.+)$/is.exec(wwwAuthenticate);
  if (!m) throw new Error("No Payment scheme in challenge");
  const raw = m[1];
  const params = {};
  const pairRe = /([A-Za-z0-9_-]+)="((?:\\.|[^"\\])*)"|\s/g;
  let match;
  while ((match = pairRe.exec(raw))) {
    if (match[1]) params[match[1]] = match[2].replace(/\\(["\\])/g, "$1");
  }
  if (!params.id || !params.realm || !params.method || !params.request) {
    throw new Error("Incomplete Payment challenge: " + JSON.stringify(params));
  }
  const request = JSON.parse(b64urlDecode(params.request));
  return {
    id: params.id,
    realm: params.realm,
    method: params.method,
    intent: params.intent,
    request,
    expires: params.expires,
    description: params.description,
    rawRequest: params.request,
  };
}

async function buildAndSignPayment(challenge) {
  const { amount, currency, recipient } = challenge.request;
  if (currency !== XLM_SAC) throw new Error(`Unsupported currency ${currency}`);
  const account = await rpc.getAccount(sourceAddress);
  const contract = new StellarSdk.Contract(currency);
  const builder = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  }).addOperation(
    contract.call(
      "transfer",
      new StellarSdk.Address(sourceAddress).toScVal(),
      new StellarSdk.Address(recipient).toScVal(),
      StellarSdk.nativeToScVal(BigInt(amount), { type: "i128" }),
    ),
  );
  if (challenge.expires) {
    const expiresUnix = Math.floor(new Date(challenge.expires).getTime() / 1000);
    builder.setTimebounds(0, expiresUnix);
  } else {
    builder.setTimeout(180);
  }
  const tx = builder.build();
  const prepared = await rpc.prepareTransaction(tx);
  prepared.sign(keypair); // Freighter equivalent
  return prepared.toXDR();
}

function serializeCredential(challenge, signedXdr) {
  const wire = {
    challenge: {
      id: challenge.id,
      realm: challenge.realm,
      method: challenge.method,
      intent: challenge.intent,
      request: challenge.rawRequest,
      ...(challenge.expires ? { expires: challenge.expires } : {}),
      ...(challenge.description ? { description: challenge.description } : {}),
    },
    payload: { type: "transaction", transaction: signedXdr },
    source: `did:pkh:stellar:testnet:${sourceAddress}`,
  };
  return `Payment ${b64urlEncode(JSON.stringify(wire))}`;
}

// ── run the flow ─────────────────────────────────────────────────────────
let res = await fetch(URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt }),
});
console.log("1st response status:", res.status);
if (res.status !== 402) {
  console.log(await res.text());
  process.exit(1);
}

const challenge = parseChallenge(res.headers.get("WWW-Authenticate"));
console.log("Challenge parsed OK id:", challenge.id.slice(0, 12), "| amount:", challenge.request.amount, "| expires:", challenge.expires);

const signedXdr = await buildAndSignPayment(challenge);
console.log("Tx built and signed OK bytes:", signedXdr.length);

const credential = serializeCredential(challenge, signedXdr);
console.log("Credential header length:", credential.length);

res = await fetch(URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: credential },
  body: JSON.stringify({ prompt }),
});
console.log("2nd response status:", res.status);
const body = await res.json();
if (res.ok) {
  console.log("OK: AI response received:");
  console.log("  ", (body.response || "(none)").slice(0, 200).replace(/\n/g, " "));
  console.log("  tx:", body.payment?.txHash);
} else {
  console.log("ERROR:", body.error || JSON.stringify(body).slice(0, 300));
  console.log("  WWW-Authenticate present:", !!res.headers.get("WWW-Authenticate"));
}
