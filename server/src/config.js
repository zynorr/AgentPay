import dotenv from "dotenv";

// Load server/.env explicitly so a key stored there WINS over any stale value
// already exported in the machine's environment (dotenv never overrides
// existing process.env vars by default).
const envFile = dotenv.config().parsed ?? {};

// Prefer server/.env, fall back to the inherited environment.
const env = (name) => envFile[name] ?? process.env[name];

const requireEnv = (name) => {
  const value = env(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

export const config = {
  port: Number(process.env.PORT || 4000),
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",

  // Stellar network (CAIP-2). Only testnet is supported by this demo.
  network: "stellar:testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  rpcUrl: process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org",
  horizonUrl: process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org",

  // The gateway account that receives payments (G... classic address).
  recipient: requireEnv("STELLAR_RECIPIENT"),

  // Secret key of the recipient - used server-side ONLY to record payments
  // on the PaymentRegistry contract. Never exposed to the client.
  recipientSecret: process.env.STELLAR_SECRET_KEY,

  // Shared secret that HMAC-binds challenge IDs (mppx).
  mppSecretKey: process.env.MPP_SECRET_KEY || "agentpay-demo-dev-secret-change-me",

  // Per-request price in human-readable XLM units (7 decimal places).
  priceXlm: process.env.PRICE_XLM || "0.05",

  // Soroban PaymentRegistry contract (deployed on testnet).
  registryContractId: process.env.CONTRACT_ID,

  // AI provider: "mock" (offline, zero keys) or "openai" (OpenAI-compatible
  // /chat/completions endpoint - OpenAI, Groq, OpenRouter, DeepSeek, …).
  aiProvider: process.env.AI_PROVIDER || "mock",
  openai: {
    apiKey: env("OPENAI_API_KEY") || env("GROQ_API_KEY"),
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    maxTokens: Number(process.env.OPENAI_MAX_TOKENS || 300),
    temperature: Number(process.env.OPENAI_TEMPERATURE || 0.7),
  },
};

// SEP-41 SAC (Stellar Asset Contract) for the native XLM asset on testnet.
// Verified against @stellar/mpp's exported constant:
//   XLM_SAC_TESTNET = CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
export const XLM_SAC_TESTNET =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

// Stellar expert URL for human-friendly transaction explorer links.
export const explorerUrl = (txHash) =>
  `https://stellar.expert/explorer/testnet/tx/${txHash}`;
