# x402 / MPP wire protocol

This document describes the exact wire format used between AgentPay clients
and the gateway. It follows the Machine Payments Protocol (MPP) "charge"
intent, implemented by `@stellar/mpp` (server) and `mppx` (client), and is
reproduced in the browser by `web/src/lib/paywall.js` without any SDK.

## 1. Challenge (server to client)

A request without a credential receives:

```
HTTP/1.1 402 Payment Required
WWW-Authenticate: Payment id="<id>", realm="<realm>", method="stellar", intent="charge", request="<base64url JSON>", expires="<ISO-8601>"
```

Header parameters:

| Parameter | Description |
|---|---|
| `id` | Challenge id, HMAC-bound to the request contents via `MPP_SECRET_KEY` |
| `realm` | Server realm (hostname when available) |
| `method` | Always `stellar` in this gateway |
| `intent` | Always `charge` |
| `request` | Base64url-encoded JSON describing the payment |
| `expires` | ISO-8601 challenge expiry (~300s lifetime) |

Decoded `request` JSON:

```json
{
  "amount": "500000",
  "currency": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  "recipient": "GC5V36K6XI6EG5BDYMBDXHL5WFUPF3ZKTNMVMBM356B2TXIVZ2THALF6",
  "externalId": "req_...",
  "methodDetails": {
    "credentialTypes": ["transaction", "signedHash"],
    "network": "stellar:testnet"
  }
}
```

Field notes:

- `amount` is in base units (1 XLM = 10,000,000 base units). The client must
  not divide or multiply; it transfers this exact integer.
- `currency` is the SEP-41 Stellar Asset Contract id for the asset. This
  gateway uses only the native XLM SAC on testnet:
  `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`.
- `recipient` is the classic `G...` address of the gateway.
- `credentialTypes` lists acceptable payload types. This gateway accepts
  `transaction` (pull mode) and `signedHash`.

## 2. Credential (client to server)

The client retries with:

```
Authorization: Payment <base64url JSON>
```

Decoded credential JSON:

```json
{
  "challenge": {
    "id": "<challenge id>",
    "realm": "<challenge realm>",
    "method": "stellar",
    "intent": "charge",
    "request": "<exact base64url string from the challenge>",
    "expires": "<same expires>",
    "description": "<optional>"
  },
  "payload": {
    "type": "transaction",
    "transaction": "<signed transaction XDR (base64)>"
  },
  "source": "did:pkh:stellar:testnet:G..."
}
```

The `request` field inside `challenge` must echo the exact base64url string
issued by the server; clients must not re-encode it.

### Payload types

| Type | Payload | Mode |
|---|---|---|
| `transaction` | `{ type: "transaction", transaction: <XDR> }` | Pull: client-signed envelope; the gateway broadcasts it |
| `signedHash` | `{ type: "signedHash", hash, sourceSignature }` | Push: hash of a transfer the client already submitted |
| `hash` | `{ type: "hash", hash }` | Legacy push; disabled by default (`allowUnsignedPush: false`) |

This gateway is configured for pull mode (`transaction`), so the payer signs
and the server broadcasts.

### Source identifier

`source` is a CAIP-10-style `did:pkh:stellar:<network>:<G address>`. The
gateway derives the payer address from it for the ledger and contract records.

## 3. The transfer the client signs

Pull mode requires a SEP-41 `transfer` invocation on the XLM SAC contract:

```
transfer(from: <payer>, to: <recipient>, amount: <i128 base units>)
```

Construction rules:

- Fee starts at `BASE_FEE`; `prepareTransaction` simulation adjusts it and
  attaches the Soroban footprint and authorization entries.
- Time bounds must not exceed the challenge `expires` (`minTime = 0`,
  `maxTime = expires`). The gateway rejects envelopes whose `maxTime` exceeds
  the challenge lifetime.
- The transfer amount must equal the challenge amount and the recipient must
  match, or the gateway rejects the credential.

## 4. Server-side verification

On receiving a credential, the gateway (`@stellar/mpp` charge method):

1. Looks up the challenge id and rejects it if already redeemed (replay
   protection backed by the configured `Store`).
2. Decodes the envelope and checks the invoked contract, function, amount,
   recipient, and currency against the challenge.
3. Checks freshness: the transfer must postdate the challenge issuance and
   fall within the challenge lifetime.
4. Broadcasts the settlement transaction and polls until confirmed.

Only after confirmation does the gateway call the AI provider and record the
payment.

## 5. Response

On success the gateway responds `200` with a `Payment-Receipt` header
(base64url JSON) whose `reference` field is the settlement transaction hash,
and a JSON body:

```json
{
  "ok": true,
  "response": "<AI text>",
  "payment": {
    "requestId": "req_...",
    "amountXlm": "0.05",
    "currency": "XLM (native SAC)",
    "payer": "G...",
    "txHash": "<64 hex chars>",
    "explorerUrl": "https://stellar.expert/explorer/testnet/tx/<hash>"
  }
}
```

## References

- Payment auth draft: <https://paymentauth.org/draft-stellar-charge-00>
- `@stellar/mpp` charge server: `node_modules/@stellar/mpp/dist/charge/server/`
- `mppx` client/server: `node_modules/mppx/dist/`
- SEP-41 (token interface): <https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md>
