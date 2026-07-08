#!/usr/bin/env node
/**
 * AgentPay CLI agent.
 *
 * Calls the paywalled gateway using the official Stellar MPP client stack
 * (@stellar/mpp + mppx). The flow:
 *
 *   1. POST the prompt           -> 402 + WWW-Authenticate challenge
 *   2. MPP client signs the SAC XLM transfer (pull mode)
 *   3. Retry with Authorization  -> gateway verifies and settles on-chain
 *   4. 200 OK + AI response + Payment-Receipt (tx hash)
 *
 * Usage (from server/):
 *   node src/cli-agent.js "Ask me anything"
 */
import "dotenv/config";
import { Keypair } from "@stellar/stellar-sdk";
import { Mppx } from "mppx/client";
import { stellar } from "@stellar/mpp/charge/client";

const prompt = process.argv.slice(2).join(" ") || "Why build on Stellar?";
const secret = process.env.AGENT_SECRET_KEY;
const serverUrl = process.env.SERVER_URL || "http://localhost:4000/api/ai/chat";

if (!secret) {
  console.error("Set AGENT_SECRET_KEY in server/.env (run `npm run setup` first).");
  process.exit(1);
}

const keypair = Keypair.fromSecret(secret);
console.log(`Agent paying from: ${keypair.publicKey()}\n`);

Mppx.create({
  methods: [
    stellar.charge({
      keypair,
      mode: "pull",
      onProgress(event) {
        const ts = new Date().toISOString().slice(11, 23);
        switch (event.type) {
          case "challenge":
            console.log(
              `[${ts}] 402 challenge - pay ${event.amount} XLM to ${event.recipient}`,
            );
            break;
          case "signing":
            console.log(`[${ts}] signing SAC transfer`);
            break;
          case "signed":
            console.log(`[${ts}] signed (${event.transaction.length} bytes XDR)`);
            break;
          case "paying":
            console.log(`[${ts}] gateway settling payment on-chain`);
            break;
          case "paid":
            console.log(`[${ts}] payment confirmed: ${event.hash}`);
            break;
        }
      },
    }),
  ],
});

const res = await fetch(serverUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt }),
});

console.log(`\nResponse (${res.status})`);
console.log(JSON.stringify(await res.json(), null, 2));
