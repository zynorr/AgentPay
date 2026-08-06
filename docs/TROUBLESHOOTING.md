# Troubleshooting

## The browser pays but no answer appears

The payment settling does not mean the answer failed. Check in order:

1. **Server log** — `server/` startup output or `tail -f /tmp/agentpay-server.log`
   shows per-request lines:
   ```
   [gateway] req_...: 402 challenge issued
   [gateway] req_...: payment verified and settled by MPP
   [gateway] req_...: 200 OK, AI served (openai), tx=<hash>
   ```
   If you see the 200 line, the answer was generated; refresh the page. If you
   see an error line, the provider call failed after settlement (see below).
2. **`GET /api/payments`** — a recorded entry means the full server-side flow
   (payment + AI) succeeded.
3. **Browser console** — a rejected credential is now surfaced as a
   descriptive error instead of a bare status code.

## "Gateway error (402)" after approving a payment

Most common cause: the Send button was pressed twice. The first request
redeemed the challenge; the second submits the same challenge id and is
rejected as a replay. Check your balance to confirm the first payment went
through, then send once.

## Groq returns 429

The free tier is rate limited (~30 RPM per organization, shared across keys).
Wait for the `retry-after` window, or switch models/providers via
`OPENAI_BASE_URL` and `OPENAI_MODEL` in `server/.env`.

## The gateway keeps serving the mock response

`GET /api/health` reports the effective mode:

- `aiMode: mock` — `AI_PROVIDER` is not `openai` in `server/.env`.
- `aiMode: openai-mock-fallback` — `AI_PROVIDER=openai` but the key is
  missing, shorter than 20 chars, or contains a placeholder hint
  (`replace`, `example`, ...).

A real key must be in `server/.env`; the gateway deliberately prefers it over
a key already exported in the shell.

## "AI provider error 401"

The configured key is wrong or revoked. This also happens when a stale key is
exported in the shell and shadows `server/.env` — the gateway re-reads `.env`
for the AI key, so check both locations. Groq keys start with `gsk_`.

## Freighter shows the wrong network

The app requires testnet. In Freighter, switch the network to Testnet and
retry. `getNetwork()` in `web/src/lib/stellar.js` rejects anything else.

## Friendbot funding fails

`https://friendbot.stellar.org?addr=<G address>` funds testnet accounts.
Errors are usually transient; retry. Note the same address cannot be funded
repeatedly in a short window.

## The gateway will not start

The first boot can take ~10 seconds (Stellar SDK import). The startup line is:

```
AgentPay gateway listening on http://localhost:4000
```

If the port is already in use, kill the previous process:

```bash
netstat -ano | grep ':4000'
taskkill //F //PID <pid>
```

Missing `server/.env` produces `Missing required env var: STELLAR_RECIPIENT`;
run `npm run setup` first.

## Ledger write failures (ENOSPC)

If the disk is full, JSONL appends fail with `ENOSPC`; the error is logged and
the payment is still recorded in memory and on-chain. Free disk space and
restart. The on-chain contract is the durable record.

## Contract invokes return nothing or time out

Testnet RPC can be slow. Retry; `payment_count` should return an integer.
`total_volume` returns a JSON string of base units (500000 = 0.05 XLM).

## `cargo test` fails to link on Windows GNU

The Rust standard library test binary hits the GNU toolchain's DLL export
ordinal limit. Use an MSVC toolchain (`rustup toolchain install
stable-x86_64-pc-windows-msvc`) or run tests on another OS. The contract wasm
build (`../stellar-cli.exe contract build`) is unaffected, and the deployed
contract is verified with live invoke calls.
