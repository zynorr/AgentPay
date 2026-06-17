import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import { Mppx, Store } from "mppx/server";
import { stellar } from "@stellar/mpp/charge/server";
import { config, XLM_SAC_TESTNET, explorerUrl } from "./config.js";
import { effectiveAiMode, generateAiResponse, isOpenAiKeyConfigured } from "./ai.js";
import * as ledger from "./ledger.js";
import { recordOnChainPayment } from "./registry.js";

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: config.corsOrigin,
    // The browser must be able to send the MPP credential and read the
    // challenge + receipt headers.
    allowedHeaders: ["Content-Type", "Authorization", "Accept-Payment"],
    exposedHeaders: [
      "WWW-Authenticate",
      "Payment-Receipt",
      "Payment-Session",
      "Payment-Session-Snapshot",
    ],
  }),
);

// MPP charge method: one-time per-request payments in native XLM via its SAC
// (SEP-41) contract. No USDC trustline, no facilitator; payments settle
// directly on testnet.
const mppx = Mppx.create({
  secretKey: config.mppSecretKey,
  methods: [
    stellar.charge({
      recipient: config.recipient,
      currency: XLM_SAC_TESTNET,
      network: config.network,
      store: Store.memory(),
    }),
  ],
});

const priceBaseUnits = (BigInt(Math.round(Number(config.priceXlm) * 1e7))).toString();

// Convert the incoming Express request into the WHATWG Request mppx expects.
function toWebRequest(req, body) {
  const url = `http://${req.headers.host ?? "localhost"}${req.originalUrl}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
  }
  const init = { method: req.method, headers };
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new Request(url, init);
}

// Extract the payer's G... address from the MPP credential's DID source.
function payerFromAuthorization(authorization) {
  try {
    const m = /^Payment\s+(.+)$/i.exec(authorization ?? "");
    if (!m) return null;
    const json = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
    const source = json.source ?? "";
    const parts = source.split(":");
    return parts.length >= 5 ? parts[parts.length - 1] : null;
  } catch {
    return null;
  }
}

// Health and payment history endpoints.
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "agentpay-gateway",
    network: config.network,
    recipient: config.recipient,
    priceXlm: config.priceXlm,
    currencySac: XLM_SAC_TESTNET,
    registryContractId: config.registryContractId ?? null,
    aiProvider: config.aiProvider,
    aiMode: effectiveAiMode(),
    aiModel: config.openai.model,
    aiKeyConfigured: isOpenAiKeyConfigured(),
    payments: ledger.totalPayments(),
    volumeXlm: ledger.totalVolumeXlm(),
  });
});

app.get("/api/payments", (_req, res) => {
  res.json({ payments: ledger.listPayments(50) });
});

// Paywalled AI endpoint. First call returns 402 Payment Required with a
// WWW-Authenticate challenge. The payer signs a SAC transfer (Freighter / MPP
// client) and retries with an Authorization header. mppx verifies the transfer
// on-chain and settles it before any content is generated.
app.post("/api/ai/chat", async (req, res) => {
  const prompt = req.body?.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "prompt (string) is required" });
  }

  const requestId = `req_${crypto.randomBytes(8).toString("hex")}`;

  try {
    const webReq = toWebRequest(req, req.body);
    const handler = mppx.charge({
      amount: config.priceXlm,
      description: "AI agent chat completion (AgentPay)",
      externalId: requestId,
    });
    const result = await handler(webReq);

    if (result.status === 402) {
      const challenge = result.challenge;
      res.status(402);
      challenge.headers.forEach((value, key) => res.setHeader(key, value));
      console.log(`[gateway] ${requestId}: 402 challenge issued`);
      return res.json({
        status: 402,
        message: "Payment required - attach an MPP credential and retry.",
        requestId,
      });
    }

    console.log(`[gateway] ${requestId}: payment verified and settled by MPP`);

    // Payment verified and settled. Read the tx hash from the receipt header
    // that mppx attaches to the 200 response, then re-attach the same header
    // to the final payload below.
    const receiptHeader =
      result.withReceipt(Response.json({})).headers.get("Payment-Receipt") ?? "";
    let txHash = null;
    try {
      const receipt = JSON.parse(Buffer.from(receiptHeader, "base64url").toString("utf8"));
      txHash = receipt.reference ?? null;
    } catch {
      // header not parseable, non-fatal
    }

    const payer = payerFromAuthorization(req.headers.authorization);
    const amountXlm = config.priceXlm;

    // Generate the AI response now that the request is paid for.
    const aiResponse = await generateAiResponse(prompt);

    // Record in the local JSONL ledger + (best-effort) on the Soroban
    // PaymentRegistry contract deployed on testnet.
    ledger.recordPayment({
      requestId,
      payer: payer ?? "unknown",
      amountXlm,
      txHash: txHash ?? null,
      prompt: prompt.slice(0, 200),
      aiProvider: config.aiProvider,
      explorerUrl: txHash ? explorerUrl(txHash) : null,
    });
    if (txHash) {
      recordOnChainPayment({
        payer: payer ?? config.recipient,
        amountBaseUnits: BigInt(priceBaseUnits),
        requestId,
      });
    }

    const payload = {
      ok: true,
      response: aiResponse,
      payment: {
        requestId,
        amountXlm,
        currency: "XLM (native SAC)",
        payer: payer ?? null,
        txHash,
        explorerUrl: txHash ? explorerUrl(txHash) : null,
      },
    };

    res.status(200);
    if (receiptHeader) res.setHeader("Payment-Receipt", receiptHeader);
    console.log(
      `[gateway] ${requestId}: 200 OK, AI served (${config.aiProvider}), tx=${txHash ?? "n/a"}`,
    );
    return res.json(payload);
  } catch (err) {
    console.error(`[gateway] ${requestId}: error:`, err.message ?? err);
    return res.status(500).json({ error: err.message ?? "internal error" });
  }
});

app.listen(config.port, () => {
  console.log(`AgentPay gateway listening on http://localhost:${config.port}`);
  console.log(`   network:  ${config.network}`);
  console.log(`   payTo:    ${config.recipient}`);
  console.log(`   price:    ${config.priceXlm} XLM per request`);
  console.log(`   currency: XLM SAC ${XLM_SAC_TESTNET}`);
  console.log(`   contract: ${config.registryContractId ?? "not deployed"}`);
});
