# Architecture

## Components

```
web/ (React + Vite)
  App.jsx            Chat UI, payment stepper, wallet controls, toasts
  lib/paywall.js     Browser MPP client: challenge parsing, transfer build,
                     credential serialization, pay-then-retry
  lib/stellar.js     Freighter integration, RPC/Horizon clients, helpers
  components/        SVG icon set, markdown renderer

server/ (Express 5, ESM)
  src/index.js       HTTP app; MPP paywall middleware; health, payments, chat
  src/config.js      Env parsing; .env-precedence for the AI key
  src/ai.js          OpenAI-compatible client + mock fallback + mode detection
  src/ledger.js      Append-only JSONL ledger (server/data/ledger.jsonl)
  src/registry.js    Soroban client that calls record_payment on the contract
  src/cli-agent.js   Demo payer using @stellar/mpp + mppx

contract/ (Rust, soroban-sdk 27)
  src/lib.rs         PaymentRegistry: admin-gated payment history
```

## Data flow (paid request)

1. Browser or CLI agent POSTs `{ prompt }` to `/api/ai/chat`.
2. `index.js` builds a WHATWG `Request` from the Express request and hands it
   to the MPP charge handler (`mppx.charge(...)`).
3. Without a credential the handler returns 402; `index.js` copies the
   challenge headers onto the Express response.
4. The client parses the challenge, builds the SAC transfer, simulates it via
   `prepareTransaction`, signs it (Freighter or keypair), and retries with an
   `Authorization: Payment` header.
5. The MPP handler verifies the transfer on-chain, broadcasts it, and returns
   200 with a `withReceipt` response carrying the `Payment-Receipt` header.
6. `index.js` extracts the tx hash from the receipt header, calls
   `generateAiResponse`, then:
   - appends the payment to the JSONL ledger (`ledger.recordPayment`);
   - calls `recordOnChainPayment` (best effort) to invoke
     `record_payment` on the PaymentRegistry contract.
7. The response body `{ ok, response, payment }` is returned; failures before
   or during AI generation produce a `500` with a descriptive `error`.

## Security model

- **Pull-mode payments.** The payer signs a standard Soroban transaction; the
  gateway never sees or stores payer secrets. The signed envelope is
  validated against the challenge before broadcast.
- **Verification before content.** The AI provider is only called after the
  transfer is verified and settled on-chain. There is no unpaid path to the
  model.
- **Replay protection.** Challenge ids are redeemed atomically through the
  configured `Store` (in-memory in this deployment; see limitations).
- **Freshness.** Transfers are accepted only within the challenge lifetime
  and must postdate challenge issuance.
- **Contract access control.** Only the `admin` address (the gateway
  operator) may call `record_payment`; writes require
  `Address::require_auth`.
- **CORS.** The gateway restricts origins to `CORS_ORIGIN` and only exposes
  the headers the browser client needs (`WWW-Authenticate`,
  `Payment-Receipt`, ...).
- **Secrets.** `server/.env` is gitignored. The gateway re-reads `.env` for
  the AI key so a stale shell-exported variable cannot shadow the configured
  key.
- **Provider errors are surfaced.** AI provider failures (timeouts, 401/429)
  are returned with actionable messages rather than silent fallbacks. The
  mock fallback only engages when no valid key is configured, and is
  reported in `/api/health` (`aiMode`) plus a console warning.

## Failure modes

| Failure | Behavior |
|---|---|
| AI provider down / rate-limited | Payment already settled; gateway returns 500 with the provider error. The payer is not refunded (demo scope). |
| Ledger append fails (disk full) | Payment is still recorded in memory and on-chain; the append error is logged. |
| On-chain recording fails | Logged and skipped; the JSONL ledger and API remain authoritative. |
| Challenge replayed | MPP store rejects the second submission with a 402; the client maps this to a clear message. |
| Contract not deployed / no secret key | `recordOnChainPayment` no-ops. |

## Limitations (explicit)

- The MPP replay store is `Store.memory()`, which is correct for a single
  process only. A multi-instance deployment needs a shared atomic store
  (Redis CAS or Postgres conditional update).
- The gateway has no rate limiting or auth beyond the paywall itself.
- `payment_count`/`Payments` in the contract grow without bound; fine for a
  demo, budget for archival in production.
- The JSONL ledger is append-only and reloaded in memory at boot.
- Contract unit tests do not link on Windows GNU toolchains (documented Rust
  limitation); the contract is verified via live testnet calls instead.

## Development services

| Service | URL | Notes |
|---|---|---|
| Gateway | http://localhost:4000 | `cd server && npm start` |
| Web app | http://localhost:5173 | `cd web && npm run dev`; proxies `/api` to :4000 |
| Testnet RPC | https://soroban-testnet.stellar.org | `prepareTransaction`, submit, poll |
| Testnet Horizon | https://horizon-testnet.stellar.org | Balances |
| Friendbot | https://friendbot.stellar.org?addr=G... | Testnet funding |
