import { config } from "./config.js";

// Substrings that mark a key as a placeholder rather than a real secret.
const PLACEHOLDER_HINTS = ["replace", "your_key", "your key", "changeme", "example", "xxx"];

/**
 * True when a real OpenAI-compatible API key is configured (not blank and not
 * a placeholder). Provider-agnostic: accepts sk-... (OpenAI, DeepSeek), gsk_...
 * (Groq), sk-or-... (OpenRouter), etc.
 */
export function isOpenAiKeyConfigured() {
  const key = (config.openai.apiKey ?? "").trim();
  if (key.length < 20) return false;
  const lower = key.toLowerCase();
  return !PLACEHOLDER_HINTS.some((hint) => lower.includes(hint));
}

/**
 * What the gateway actually serves:
 *   - "mock": AI_PROVIDER is not openai
 *   - "openai": real model completions
 *   - "openai-mock-fallback": openai requested but no valid key configured
 */
export function effectiveAiMode() {
  if (config.aiProvider !== "openai") return "mock";
  return isOpenAiKeyConfigured() ? "openai" : "openai-mock-fallback";
}

/**
 * Offline stand-in used when AI_PROVIDER=mock or while a provider key is
 * missing. Deterministic and self-contained; requires no API credentials.
 */
function mockResponse(prompt) {
  const clean = String(prompt || "").trim().slice(0, 400);
  return [
    "Mock provider response (AI_PROVIDER=mock).",
    "",
    "The gateway verified your payment on-chain and would normally forward",
    "this prompt to the configured model. To serve real completions, set a",
    "provider key in server/.env:",
    "",
    "  OPENAI_API_KEY=...",
    "  OPENAI_BASE_URL=https://api.groq.com/openai/v1",
    "  OPENAI_MODEL=llama-3.3-70b-versatile",
    "",
    `Prompt received: ${clean || "(empty)"}`,
  ].join("\n");
}

/**
 * Calls any OpenAI-compatible /chat/completions endpoint. Throws descriptive
 * errors so provider failures are never silent.
 */
async function openaiResponse(prompt) {
  const { apiKey, baseUrl, model, maxTokens, temperature } = config.openai;
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a paid AI agent. The caller settled a micro-payment on Stellar via the Machine Payments Protocol (MPP / x402) before sending this message. Answer helpfully, concretely, and briefly (under ~200 words).",
          },
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error("AI provider timed out after 45s");
    }
    throw new Error(`AI provider request failed: ${err.message}`);
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch {
      // response body unavailable
    }
    const hints = {
      401: " - check OPENAI_API_KEY / GROQ_API_KEY",
      403: " - API key lacks access to this model",
      404: " - wrong OPENAI_BASE_URL or OPENAI_MODEL",
      429: " - rate limited or out of credits",
    }[res.status];
    throw new Error(`AI provider error ${res.status}${hints ?? ""}: ${detail || res.statusText}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("AI provider returned an empty completion");
  }
  return text.trim();
}

/** Entry point used by the gateway after a payment has been verified. */
export async function generateAiResponse(prompt) {
  if (config.aiProvider === "openai" && isOpenAiKeyConfigured()) {
    return openaiResponse(prompt);
  }
  if (config.aiProvider === "openai") {
    console.warn(
      "[ai] OPENAI_API_KEY is missing or a placeholder; serving mock fallback. " +
        "Add a real key to server/.env to serve real model completions.",
    );
  }
  return mockResponse(prompt);
}
