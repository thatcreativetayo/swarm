# SWARM - Telegraph Integration

**Version:** 0.1
**Status:** Implemented; live x402 settlement unverified
**Last updated:** 2026-10-31
**Related:** [Tool Runtime](TOOL_RUNTIME.md), [Security](SECURITY_AND_PERMISSIONS.md), [Architecture](ARCHITECTURE.md)

---

## 1. Overview

Telegraph is a protocol for paid specialist intelligence. SWARM exposes four native tools:

| Tool | Cost | Approval | Purpose |
| --- | --- | --- | --- |
| `telegraph_discover` | Free | No | List miners, intents, prices, and endpoints. |
| `telegraph_quote` | Free | No | Read the x402 payment requirements for a query. |
| `telegraph_purchase` | Paid | Always | Buy one answer using x402 and a server-side burner wallet. |
| `telegraph_signal` | Free | No | Look up a signal by hash for audit/verification. |

Discovery and quoting do not spend. A purchase always creates a pending approval, and the
approved maximum price is enforced both before and during payment.

Telegraph is optional. SWARM works without a node URL or wallet; the purchase tool fails closed
with a configuration error.

## 2. Configuration

### 2.1 Environment

```dotenv
# Default: https://devnode.telegraphprotocol.com
TELEGRAPH_NODE_URL=https://devnode.telegraphprotocol.com

# 0x-prefixed 32-byte EVM private key. Server-side only.
TELEGRAPH_EVM_PRIVATE_KEY=
```

`TELEGRAPH_NODE_URL` may include a trailing slash or `/engine`; both are normalized away.
The default node is a development/testnet endpoint. Do not assume it is mainnet or production.

### 2.2 Encrypted integration (preferred)

Create a workspace integration:

```http
POST /api/workspaces/ws_.../integrations
Authorization: Bearer <SWARM_API_TOKEN>
Content-Type: application/json

{
  "provider": "telegraph",
  "name": "Telegraph burner",
  "config": {
    "nodeUrl": "https://devnode.telegraphprotocol.com"
  },
  "secret": "0x..."
}
```

Resolution order in the tool:

1. the encrypted `telegraph` integration secret and `config.nodeUrl`;
2. `TELEGRAPH_EVM_PRIVATE_KEY` and `TELEGRAPH_NODE_URL`.

Only the first integration for the `telegraph` provider is used (ordered by creation time).
Create one per workspace. The API never returns the secret; it reports `hasSecret`.

The key is loaded only when a purchase executes. A missing or malformed key is a tool failure,
not a startup failure. This keeps discovery and quoting usable without a wallet.

### 2.3 Wallet requirements

- The key must be a valid EVM private key accepted by `viem`'s `privateKeyToAccount`.
- The wallet needs the asset and network returned in the payment challenge. In the common
  testnet case this is testnet USDC, but SWARM does not assume a specific network in the quote.
- Use a dedicated burner wallet with a small balance. Never use a primary treasury key.
- Fund the wallet only after inspecting a real quote (`telegraph_quote`). No funded wallet was
  available during development, so the full settlement path has not been exercised.

## 3. Node endpoints used

All paths are relative to the normalized node URL.

| Tool | Request |
| --- | --- |
| `telegraph_discover` | `GET /api/miners?intent=<intent>&limit=<n>` |
| `telegraph_quote` | `POST /engine/v1/ask` with `{ "query": "..." }` |
| `telegraph_purchase` | `POST /engine/v1/ask` or `POST /engine/v1/ask/<minerId>` through x402 |
| `telegraph_signal` | `GET /engine/v1/signal/<signalHash>` |

Discovery accepts an optional intent (max 120 chars) and limit (1-25, default 10). The response
is normalized to a compact list of `id`, `slug`, `name`, `intents`, `minPriceUsdc`, `status`,
and up to five endpoints. Unknown fields are ignored.

Signal lookup requires `0x` followed by 1-128 hex characters.

## 4. Quote and payment flow

### 4.1 Quote

`telegraph_quote` sends the query and expects HTTP `402 Payment Required`. It decodes the
base64 JSON in the `payment-required` header, falling back to `x-payment-required`, and reads
the first entry in `accepts`.

It extracts:

- `amount` (atomic string);
- `asset`, `network`, `payTo`;
- `maxTimeoutSeconds` (default 60 if absent).

`priceUsd` is computed as `Number(amount) / 1_000_000`. This assumes a six-decimal asset such
as USDC. If a node returns a different decimal convention or a non-USD asset, the displayed
price can be wrong. The raw amount, asset, network, and pay-to address are included so the user
and agent can inspect them.

A `200` response means the node answered without a payment challenge; the tool reports
`quote_unavailable` rather than inventing a price. Other non-402 statuses become `quote_failed`.

The quote output does not include the raw challenge or a signature. It is informational; the
purchase performs its own preflight quote.

### 4.2 Purchase

`telegraph_purchase` accepts:

```ts
{
  query: string;                 // 3-4,000 chars
  minerId?: string;              // max 120 chars
  maxPriceUsd?: number;          // 0.000001-1; default 0.02
}
```

Flow:

1. Resolve the private key and node URL.
2. Request a fresh quote for the query.
3. Compare the quoted price with `maxPriceUsd`; abort with `price_exceeds_limit` if it is higher.
4. Build an x402 client with `ExactEvmScheme` for `eip155:*` using the burner account.
5. Set the x402 client spend control `maxAmountPerPayment` to `maxPriceUsd`, so a changed
   challenge at payment time cannot exceed the approved ceiling.
6. POST the query to the chosen endpoint with x402 payment handling.
7. Store the response body, quoted price, `payment-response` header, and
   `x-telegraph-receipt` header in the tool output.

The tool's inner timeout is 90 seconds, but the runtime's global tool timeout
(default 60 seconds) caps the actual call. Increase `SWARM_TOOL_TIMEOUT_MS` if a node needs
longer, up to the configured maximum of 300 seconds.

If `maxPriceUsd` is omitted, the default ceiling is $0.02. The approval payload contains the
arguments as provided, so an omitted ceiling may not be obvious in the UI. Agents are instructed
to quote first and set the ceiling explicitly.

## 5. Approval and policy

`telegraph_purchase` has risk `purchase` and `requiresApproval: true`. Policy therefore returns
`approval` for every purchase; there is no workspace setting that auto-approves it. In a health
workflow, purchase risk is denied outright.

The approval payload contains the tool name, source, risk, and redacted input (`query`,
`minerId`, `maxPriceUsd`). The private key is never part of the payload. A denial or expiry
prevents the call, and the agent receives a tool error.

The price ceiling has two layers:

1. preflight check against the fresh quote;
2. x402 client spend control at payment time.

The x402 client also applies its default asset allowlist and default cap unless overridden; the
explicit per-payment cap is the user's `maxPriceUsd`.

## 6. Failure behavior

| Failure | Result |
| --- | --- |
| No wallet key | `payment_not_configured`; no request sent. |
| Malformed key | Tool failure from `viem`; no payment. |
| Quote returns 200 | `quote_unavailable`; no payment. |
| Quote returns non-402 | `quote_failed`. |
| Challenge cannot be decoded | `quote_failed`. |
| Price above ceiling | `price_exceeds_limit`; no payment. |
| Paid request returns non-2xx | `purchase_failed`; response body stored in the error. |
| Node timeout | `purchase_failed` / tool timeout. |
| Run cancelled | `cancelled`; payment call is aborted. |
| Signal hash invalid | `invalid_input`. |

The purchase error text says failed calls are not charged. That behavior belongs to the
Telegraph/x402 service and has not been independently verified in this project.

## 7. Security

- **Server-side key only.** The private key is read in the worker and passed to `viem`; it is
  never sent to the model, browser, artifact, approval payload, or API response.
- **Encrypted at rest.** Integration secrets use AES-256-GCM. The environment key is an
  alternative for local use, but the encrypted integration is preferred.
- **Burner wallet.** A compromise should cost no more than the burner balance.
- **Testnet default.** The default node is a development endpoint. Confirm the network from the
  quote before funding a wallet.
- **Explicit approval.** Every purchase is gated, and the user sees the query and ceiling.
- **Two price checks.** Quote-time comparison plus x402 payment-time spend control.
- **No automatic retry.** A failed purchase is not retried by the tool; a task retry creates a
  new call and requires a new approval path through policy.
- **Audit.** The tool execution records the query, result, price, and receipt headers. The
  approval and run event log record the decision.

Residual risks:

- the atomic-amount-to-USD conversion is an assumption;
- the live challenge schema, header names, and receipt format are unverified;
- the x402 package's behavior against a malicious or non-compliant node is not tested;
- a user can still approve a purchase whose query or miner they have not reviewed carefully;
- a changed quote after approval is blocked by the ceiling, but a node could return a
  different asset or network; inspect the raw quote before funding.

## 8. Verification boundary

Implemented and typechecked:

- discovery/quote/signal requests and response normalization;
- challenge decoding, price extraction, and price-ceiling check;
- x402 client wiring and payment-time spend control;
- approval policy and health denial;
- server-side secret resolution;
- build and smoke execution (Telegraph tools loaded, not called against a node).

Not verified:

- a live Telegraph devnode response;
- a funded testnet burner wallet;
- x402 payment creation, settlement, and receipt headers;
- the "failed calls are not charged" claim;
- mainnet behavior or asset decimals other than six.

See [IMPLEMENTATION_STATUS](../IMPLEMENTATION_STATUS.md) and the PRD acceptance criteria.
