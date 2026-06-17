import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const LEDGER_FILE = join(DATA_DIR, "ledger.jsonl");

const entries = [];

function ensureFile() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(LEDGER_FILE)) {
    for (const line of readFileSync(LEDGER_FILE, "utf8").split("\n")) {
      if (line.trim()) {
        try {
          entries.push(JSON.parse(line));
        } catch {
          // skip corrupt lines
        }
      }
    }
  }
}

ensureFile();

/**
 * Appends a payment record to the ledger.
 * @param {object} record {requestId, payer, amountXlm, txHash, prompt, model, aiProvider}
 */
export function recordPayment(record) {
  const entry = { ts: new Date().toISOString(), ...record };
  entries.push(entry);
  try {
    appendFileSync(LEDGER_FILE, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    console.error("[ledger] failed to persist:", err.message);
  }
  return entry;
}

export function listPayments(limit = 50) {
  return entries.slice(-limit).reverse();
}

export function totalPayments() {
  return entries.length;
}

export function totalVolumeXlm() {
  return entries
    .reduce((sum, e) => sum + (Number(e.amountXlm) || 0), 0)
    .toFixed(7);
}
