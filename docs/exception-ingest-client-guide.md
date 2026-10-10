# Sending exceptions to Keera: client integration guide (DRAFT)

> Draft for ticket #2710. It describes the protocol proposed in #2704 and is **not implemented yet**. Hostnames, ids and keys are examples.

Keera receives error reports through the **Sentry ingestion protocol**. You can use either:

- **A stock Sentry SDK**, which is recommended. Point its DSN at Keera and you're done.
- **Any HTTP client**, for custom apps or third-party tools. Post a small "envelope" yourself.

There are three steps: **register a source → get a DSN → send events.**

---

## 1. Concepts

| Term | Meaning |
|---|---|
| **Source** | One app or service that reports errors, such as `billing-api`. It has a numeric id like `42`. |
| **Key / DSN** | The credential an app uses to send events: `https://<public_key>@keera.example.com/42`. A source can have several keys, so you can rotate them. |
| **OAuth client** | The credential a *tool or admin script* uses to register sources and issue keys. It is never used to send events. |
| **Event** | One exception occurrence, identified by a client-generated `event_id`. |

The DSN key is safe to embed in apps and browser bundles. It can only *send* events to one source, and it's protected by rate limits, an origin allowlist and revocation. Keep the **OAuth client secret** private.

---

## 2. Register a source and get credentials

### Option A: Keera UI (humans)

Open **Settings → Sources → New source**, enter a name and platform, and optionally link it to a Keera project. Copy the DSN shown.

### Option B: API (Sentry, CI, Terraform or any other tool)

**Step 1: get an OAuth client.** A Keera admin creates one with these scopes: `sources:read sources:write keys:write`.

```bash
uv run python artisan auth:oauth2:client   # prints client_id and client_secret once
```

**Step 2: exchange it for an access token** (OAuth 2.0 client credentials, RFC 6749 §4.4):

```bash
curl -s https://keera.example.com/oauth/token \
  -u "$KEERA_CLIENT_ID:$KEERA_CLIENT_SECRET" \
  -d grant_type=client_credentials \
  -d scope="sources:write keys:write"
```
```json
{"access_token":"eyJhbGciOiJIUzI1NiIs...","token_type":"Bearer","expires_in":3600,"scope":"sources:write keys:write"}
```

Cache the token until `expires_in`, then request a new one. There are no refresh tokens for this grant.

**Step 3: register the source:**

```bash
curl -s https://keera.example.com/api/v1/sources \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"billing-api","platform":"python","allowed_origins":[],"rate_limit_per_minute":600}'
```
```http
HTTP/1.1 201 Created
Location: /api/v1/sources/42
```
```json
{"data":{"id":42,"name":"billing-api","status":"active",
  "keys":[{"id":7,"label":"default",
    "dsn":"https://9f2c1d8e4b7a4c0e8a1f3b5d6e7c8a90@keera.example.com/42"}],
  "endpoints":{"envelope":"https://keera.example.com/api/42/envelope/"}}}
```

**Managing keys:**

| Action | Request |
|---|---|
| Issue another DSN (rotation) | `POST /api/v1/sources/42/keys` with `{"label":"2026-q4"}` |
| Revoke a DSN | `DELETE /api/v1/sources/42/keys/7` |
| Change origins or limits | `PATCH /api/v1/sources/42` |
| Disable the source | `DELETE /api/v1/sources/42` |

To rotate a key: issue a new key, deploy apps with the new DSN, then revoke the old key.

---

## 3. Send exceptions

### 3.1 With a Sentry SDK (recommended)

Set the DSN. Nothing else changes.

```python
# Python
import sentry_sdk
sentry_sdk.init(
    dsn="https://9f2c1d8e4b7a4c0e8a1f3b5d6e7c8a90@keera.example.com/42",
    environment="production",
    release="billing@1.4.2",
    send_default_pii=False,   # keep the default unless you need user/IP data
)
```
```js
// Node / browser
Sentry.init({ dsn: "https://9f2c1d8e4b7a4c0e8a1f3b5d6e7c8a90@keera.example.com/42" });
```

For browser apps, add your site's origin (`https://app.example.com`) to the source's `allowed_origins`, or use the SDK's `tunnel` option to send through your own backend.

What Keera supports: errors and exceptions, with stack traces, request, user, tags, extra, contexts and breadcrumbs. Transactions, sessions, replays, profiles and attachments are accepted but ignored. `sentry-cli` uploads (source maps, releases) are not supported.

### 3.2 With plain HTTP (custom clients and tools)

**Endpoint:** `POST https://keera.example.com/api/{source_id}/envelope/` (keep the trailing slash).

**Headers:**

```
Content-Type: application/x-sentry-envelope
X-Sentry-Auth: Sentry sentry_version=7, sentry_key=<public_key>, sentry_client=my-tool/1.0
Content-Encoding: gzip            (optional; gzip, deflate or br)
```

If you can't set headers, for example in a browser without a preflight, use `?sentry_key=<public_key>&sentry_version=7` instead.

**Body:** three lines separated by `\n`:

1. The envelope header: `event_id` and `sent_at`.
2. The item header: `{"type":"event","length":<bytes of line 3>}`.
3. The event JSON, on one line.

**Example:**

```bash
EVENT_ID=$(uuidgen | tr -d '-' | tr 'A-Z' 'a-z')
EVENT=$(cat <<JSON | jq -c .
{
  "event_id": "$EVENT_ID",
  "timestamp": "2026-10-07T23:10:01.982Z",
  "platform": "python",
  "level": "error",
  "environment": "production",
  "release": "billing@1.4.2",
  "exception": {"values": [{
    "type": "ZeroDivisionError",
    "value": "division by zero",
    "mechanism": {"type": "generic", "handled": false},
    "stacktrace": {"frames": [
      {"filename": "app/billing.py", "function": "prorate", "lineno": 88, "in_app": true,
       "context_line": "    return amount / days"}
    ]}
  }]},
  "request": {"method": "POST", "url": "https://billing.example.com/invoices",
              "data": {"customer_id": "c_123", "days": 0}},
  "user": {"id": "u_981"},
  "contexts": {"runtime": {"name": "CPython", "version": "3.13.1"}},
  "tags": {"tenant": "acme"}
}
JSON
)
LEN=$(printf '%s' "$EVENT" | wc -c | tr -d ' ')
printf '{"event_id":"%s","sent_at":"%s"}\n{"type":"event","length":%s}\n%s\n' \
  "$EVENT_ID" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$LEN" "$EVENT" > envelope.txt

curl -s https://keera.example.com/api/42/envelope/ \
  -H "Content-Type: application/x-sentry-envelope" \
  -H "X-Sentry-Auth: Sentry sentry_version=7, sentry_key=9f2c1d8e4b7a4c0e8a1f3b5d6e7c8a90, sentry_client=my-tool/1.0" \
  --data-binary @envelope.txt
```

**Success:**

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"id":"4b0e5c3a9d1f4e2a8b7c6d5e4f3a2b1c"}
```

**Event fields** (Sentry event schema). Only `event_id`, `timestamp`, `platform` and `exception` are required for errors:

| Field | Purpose |
|---|---|
| `event_id` | 32-char lowercase hex UUID v4. **Generate once per error and reuse it on every retry.** |
| `timestamp` | When the error happened (RFC 3339, UTC). |
| `level` | `fatal`, `error`, `warning`, `info` or `debug`. |
| `exception.values[]` | `type`, `value`, `mechanism.handled`, and `stacktrace.frames[]`. Frames are ordered **oldest call first, crashing frame last**. |
| `request` | `method`, `url`, `query_string`, `headers`, `data` (the request payload). |
| `user` | `id`, `username`, `email`, `ip_address`. Send only what you need. |
| `contexts`, `tags`, `extra`, `breadcrumbs` | Free-form context. `tags` are short, indexed strings. |
| `environment`, `release`, `server_name` | Used for filtering. |
| `fingerprint` | Optional array that overrides how Keera groups events into issues. |

---

## 4. Errors and how to handle them

Error bodies use **RFC 9457 Problem Details** (`application/problem+json`):

```json
{"type":"https://keera.dev/problems/invalid-key","title":"Invalid key","status":401,
 "detail":"Key is unknown or revoked for source 42","instance":"/api/42/envelope/"}
```

| Status | Meaning | What the client should do |
|---|---|---|
| **200** | Accepted. A duplicate `event_id` also returns 200. | Done. |
| **400** | Malformed envelope or JSON. | Fix the payload. **Do not retry.** |
| **401** | Key unknown, revoked or mismatched. On `/api/v1`, the token is invalid or expired. | Envelope: stop sending and alert the operator, because the DSN needs replacing. API: get a new access token once, then retry. |
| **403** | No credentials, origin not allowed, source disabled, or `insufficient_scope` on `/api/v1`. | Fix the configuration. **Do not retry.** |
| **413** | Payload too large. Limits: 1 MiB per event, 20 MiB per envelope (compressed and decompressed). | Trim `request.data`, `extra`, breadcrumbs and frame `vars`, then send again. Otherwise drop the event. **Do not retry it unchanged.** |
| **415** | Unsupported `Content-Encoding`. | Use gzip, deflate or br. |
| **422** | (`/api/v1` only) Validation failed. `errors[]` lists each field. | Fix the request. |
| **429** | Rate limited. | Stop sending until `Retry-After` seconds have passed (60 if the header is missing). Drop or queue events during that time. Also honour `X-Sentry-Rate-Limits`. |
| **502 / 503 / 504** | Keera temporarily unavailable. | Retry with backoff, honouring `Retry-After` if present. |
| network error / timeout | Request never reached Keera or the response was lost. | Retry with backoff. Idempotency makes this safe. |

### Rate-limit headers

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 60
X-Sentry-Rate-Limits: 60:error;default:key
```

`X-Sentry-Rate-Limits` is `retry_after:categories:scope[:reason]`, and several limits are comma-separated. An empty category list means *all*. The header can also appear on a **200** response. Treat it the same way: back off for those categories.

### Retry policy for custom clients

- Retry **only** on network errors, timeouts, 429, 502, 503 and 504.
- Use exponential backoff with full jitter: `sleep = random(0, min(300, 1 * 2^attempt))` seconds. Use `Retry-After` instead when it is present. Give up after ~5 attempts or 24 h and drop the event.
- **Reuse the same `event_id`** on every retry. Keera ignores duplicates, so you never create double events.
- Send from a background queue with a bounded size. Never block the user request, and never let a crash reporter crash your app.
- Set `sent_at` again on each attempt, because Keera uses it to correct clock skew. Don't change `timestamp`.

---

## 5. Privacy (PII)

- Keep `send_default_pii=False` (the SDK default) unless you need user identity.
- Scrub on the client first. Sentry SDKs have `before_send` and Python has `EventScrubber`.
- Keera also scrubs on receipt, before storing. It masks values under keys like `password`, `secret`, `token`, `api_key`, `authorization`, `cookie`, `session`, `card` and `ssn`, masks card-number patterns, and drops `Cookie`/`Authorization` headers. IP addresses are discarded unless the source enables `store_ip_address`.
- Never put secrets in `tags`, `fingerprint` or exception messages. These aren't key/value structures, so key-based scrubbing can't find them.

---

## 6. Versioning

- The ingest endpoint follows the Sentry protocol, `sentry_version=7`. Unknown fields are ignored, so newer SDKs keep working.
- The management API is versioned in the path (`/api/v1`). Deprecations are announced with `Deprecation` and `Sunset` response headers before removal.

---

## 7. Checklist

- [ ] The source is created and the DSN is stored as a secret or config value in your app.
- [ ] Browser apps: the origin is added to `allowed_origins`.
- [ ] `event_id` is generated once per error and reused on retries.
- [ ] Retries happen only on network errors and 429/502/503/504, with backoff and `Retry-After`.
- [ ] 400, 401, 403 and 413 are not retried.
- [ ] Payloads are under 1 MiB per event, and PII is scrubbed client-side.
