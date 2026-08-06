#!/usr/bin/env node
/**
 * AgentPay - Stellar testnet bootstrap.
 *
 * 1. Generates (and friendbot-funds) two identities via the stellar CLI:
 *      - agentpay-gateway: receives payments and records them on-chain
 *      - agentpay-agent:   the demo "AI agent" that pays
 * 2. Deploys the PaymentRegistry Soroban contract (admin = gateway).
 * 3. Writes server/.env with every secret the stack needs.
 *
 * Run from server/:   npm run setup
 * (The CLI ships as stellar-cli.exe in the repo root.)
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CLI = join(ROOT, "stellar-cli.exe");
const WASM = join(
  ROOT,
  "contract",
  "target",
  "wasm32v1-none",
  "release",
  "payment_registry.wasm",
);
const ENV_PATH = join(ROOT, "server", ".env");

const GATEWAY = "agentpay-gateway";
const AGENT = "agentpay-agent";
const ALIAS = "payment-registry";

const log = (msg) => console.log(`\n> ${msg}`);

function run(args, { quiet = false } = {}) {
  const out = execFileSync(CLI, args, { encoding: "utf8" });
  return quiet ? "" : out.trim();
}

// Preflight
if (!existsSync(CLI)) {
  console.error(`stellar CLI not found at ${CLI}`);
  process.exit(1);
}
if (!existsSync(WASM)) {
  console.error(
    `Contract wasm not found at ${WASM}\nBuild it first: cd contract && ../stellar-cli.exe contract build`,
  );
  process.exit(1);
}

// Identities
let existing = [];
try {
  existing = run(["keys", "ls"]).split("\n").map((l) => l.trim()).filter(Boolean);
} catch {
  /* fresh config dir */
}

for (const name of [GATEWAY, AGENT]) {
  if (existing.some((l) => l.split(/\s+/)[0] === name)) {
    log(`${name} already exists; funding anyway (friendbot is idempotent).`);
    run(["keys", "fund", name], { quiet: true });
  } else {
    log(`Generating and funding identity "${name}"...`);
    run(["keys", "generate", name, "--fund"], { quiet: true });
  }
}

const gatewayPub = run(["keys", "address", GATEWAY]);
const agentPub = run(["keys", "address", AGENT]);
const gatewaySecret = run(["keys", "secret", GATEWAY]);
const agentSecret = run(["keys", "secret", AGENT]);

console.log(`   gateway  ${gatewayPub}`);
console.log(`   agent    ${agentPub}`);

// Deploy the contract
log(`Deploying PaymentRegistry (admin = ${gatewayPub.slice(0, 8)}...)`);
const deployOut = run([
  "contract",
  "deploy",
  "--wasm",
  WASM,
  "--source-account",
  GATEWAY,
  "--alias",
  ALIAS,
  "--",
  "--admin",
  gatewayPub,
]);
const idMatch = deployOut.match(/C[A-Z0-9]{55}/);
const contractId = idMatch ? idMatch[0] : null;
if (!contractId) {
  console.error("Could not read contract ID from deploy output:\n" + deployOut);
  process.exit(1);
}
console.log(`   contract ${contractId}`);

// Write server/.env (merge - never clobber existing values)
const mppSecret = crypto.randomBytes(24).toString("hex");
const updates = {
  STELLAR_RECIPIENT: gatewayPub,
  STELLAR_SECRET_KEY: gatewaySecret,
  AGENT_SECRET_KEY: agentSecret,
  CONTRACT_ID: contractId,
  MPP_SECRET_KEY: mppSecret,
  AI_PROVIDER: "mock",
};

let envText = "";
if (existsSync(ENV_PATH)) {
  envText = readFileSync(ENV_PATH, "utf8");
}
const lines = envText ? envText.split("\n") : [];
for (const [key, value] of Object.entries(updates)) {
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) {
    lines[idx] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
}
writeFileSync(ENV_PATH, lines.filter((l) => l.trim()).join("\n") + "\n", "utf8");

// Summary
log("Done.");
console.log(`
  Gateway (receives XLM)   ${gatewayPub}
  Demo agent (pays)        ${agentPub}
  PaymentRegistry contract ${contractId}

  server/.env written. Start everything with:

    cd server && npm start          # gateway on :4000
    cd web && npm run dev           # demo UI on :5173

  Pay via the CLI agent:

    cd server && npm run agent -- "Why build on Stellar?"

  Explorer links:
    Contract  https://stellar.expert/explorer/testnet/contract/${contractId}
`);
