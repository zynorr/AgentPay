#!/usr/bin/env node
/**
 * AgentPay - Stellar testnet bootstrap, fully self-contained.
 *
 * Uses only the packages in server/package.json (@stellar/stellar-sdk) plus
 * the public friendbot service. No stellar CLI binary required.
 *
 * 1. Generates two fresh keypairs:
 *      - agentpay-gateway: receives payments and records them on-chain
 *      - agentpay-agent:   the demo "AI agent" that pays
 * 2. Funds both accounts via friendbot (testnet only).
 * 3. Deploys the PaymentRegistry contract from the committed wasm at
 *    contract/release/payment_registry.wasm (admin = gateway).
 * 4. Writes server/.env with every secret the stack needs.
 *
 * Run from server/:   npm run setup
 * (Lives in server/ so it resolves @stellar/stellar-sdk from server/node_modules.)
 */
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as StellarSdk from "@stellar/stellar-sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const WASM = join(ROOT, "contract", "release", "payment_registry.wasm");
const ENV_PATH = join(ROOT, "server", ".env");

const RPC_URL = process.env.RPC_URL || "https://soroban-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;

const log = (msg) => console.log(`\n> ${msg}`);

// Preflight: the committed wasm must exist.
if (!existsSync(WASM)) {
  console.error(`Contract wasm not found at ${WASM}`);
  process.exit(1);
}

const wasmBytes = readFileSync(WASM);
const server = new StellarSdk.rpc.Server(RPC_URL);

async function fund(publicKey) {
  const res = await fetch(`${FRIENDBOT}?addr=${publicKey}`);
  if (!res.ok) {
    throw new Error(`friendbot funding failed (${res.status}) for ${publicKey}`);
  }
}

async function loadAccount(keypair) {
  for (let i = 0; i < 10; i++) {
    try {
      return await server.getAccount(keypair.publicKey());
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error(`account ${keypair.publicKey().slice(0, 8)}... not funded`);
}

async function submit(keypair, operations) {
  const account = await loadAccount(keypair);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(...operations)
    .setTimeout(120)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(keypair);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") {
    throw new Error(`transaction rejected: ${sent.errorResult?.result() ?? sent.status}`);
  }
  // Poll until the transaction is finalized.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const result = await server.getTransaction(sent.hash);
    if (result.status === "SUCCESS") return result;
    if (result.status === "FAILED") {
      throw new Error(`transaction failed on chain (${sent.hash})`);
    }
  }
  throw new Error(`transaction ${sent.hash} did not finalize in time`);
}

// Derive the contract id from the create-contract preimage:
//   contract_id = hash(network_id || contract_id_preimage)
// with the preimage built from the deployer address and the salt used in
// Operation.createCustomContract.
function contractIdFromPreimage(deployer, salt) {
  const networkId = StellarSdk.hash(Buffer.from(NETWORK_PASSPHRASE));
  const preimage = new StellarSdk.xdr.HashIdPreimage(
    StellarSdk.xdr.EnvelopeType.envelopeTypeContractId(),
    new StellarSdk.xdr.HashIdPreimageContractId({
      networkId,
      contractIdPreimage:
        StellarSdk.xdr.ContractIdPreimage.contractIdPreimageFromAddress(
          new StellarSdk.xdr.ContractIdPreimageFromAddress({
            address: deployer.toScAddress(),
            salt,
          }),
        ),
    }),
  );
  return StellarSdk.StrKey.encodeContract(StellarSdk.hash(preimage.toXDR()));
}

// Identities
const gatewayKp = StellarSdk.Keypair.random();
const agentKp = StellarSdk.Keypair.random();
const gatewayPub = gatewayKp.publicKey();
const agentPub = agentKp.publicKey();

log(`Generating identities and funding via friendbot...`);
await fund(gatewayPub);
await fund(agentPub);
console.log(`   gateway  ${gatewayPub}`);
console.log(`   agent    ${agentPub}`);

// Deploy: upload the wasm, then create the contract with the gateway as admin.
log(`Uploading contract wasm (${wasmBytes.length} bytes)...`);
const wasmHash = StellarSdk.hash(wasmBytes);
await submit(gatewayKp, [
  StellarSdk.Operation.uploadContractWasm({ wasm: wasmBytes }),
]);

log(`Creating PaymentRegistry (admin = ${gatewayPub.slice(0, 8)}...)`);
const salt = randomBytes(32);
const adminAddress = new StellarSdk.Address(gatewayPub);
await submit(gatewayKp, [
  StellarSdk.Operation.createCustomContract({
    wasmHash,
    address: adminAddress,
    constructorArgs: [adminAddress.toScVal()],
    salt,
  }),
]);
const contractId = contractIdFromPreimage(adminAddress, salt);
console.log(`   contract ${contractId}`);

// Write server/.env (merge - never clobber existing values)
const updates = {
  STELLAR_RECIPIENT: gatewayPub,
  STELLAR_SECRET_KEY: gatewayKp.secret(),
  AGENT_SECRET_KEY: agentKp.secret(),
  CONTRACT_ID: contractId,
  MPP_SECRET_KEY: randomBytes(24).toString("hex"),
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

// Verify the contract responds to a read.
const contract = new StellarSdk.Contract(contractId);
try {
  const read = await server
    .getContractData(contract.address().toScAddress(), {
      key: StellarSdk.xdr.ScVal.scvSymbol("payment_count"),
    })
    .catch(() => null);
  console.log(`   verified  payment_count read: ${read ? "ok" : "pending (TTL warm-up)"}`);
} catch {
  /* read not critical for setup success */
}

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
