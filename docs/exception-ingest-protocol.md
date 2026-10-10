# Exception ingest protocol: recommendation (task #2704)

Status: research/design only, no code changes. Repo state reviewed: `main` @ `8bbfa40`.

## 1. TL;DR

- **Wire protocol: adopt the Sentry ingestion protocol as is.** That means the DSN, the envelope endpoint `POST /api/<source_id>/envelope/`, `X-Sentry-Auth` with a `sentry_key`, and the Sentry event schema. Keera then works with every stock Sentry SDK (Python, JS, PHP, Go, Java, .NET and others) by changing only the DSN. GlitchTip, Bugsink and Uptrace already work this way, so the approach is proven.
- **Error responses: RFC 9457 Problem Details** (`application/problem+json`). The body keeps a `detail` member, which is the same shape Sentry/Relay returns, so Sentry SDKs see nothing unusual.
- **Two auth planes:**
  - **Ingest plane:** a per-source **DSN public key** (the Sentry model). Stock SDKs can only send this credential. It is checked by a small custom FastAPI dependency. It is not a startkit guard, because startkit guards expect Bearer tokens or sessions, which SDKs never send.
  - **Management plane:** used to register a source and issue its credentials. It uses **OAuth2 client-credentials from `fastapi-startkit-auth` (`AuthOAuth2Provider`)** with scopes, protected by `require_scopes("sources:write")`. Sentry, CI or any other third-party tool gets an OAuth client, exchanges it for a token, creates a source and receives a DSN back.
- **OpenTelemetry:** align internal field names with OTel `exception.*` semconv. OTLP/HTTP ingest is a later, optional adapter, not the primary protocol.
- **HMAC:** only for inbound webhooks from hosted tools, for example Sentry's own integration webhooks (`Sentry-Hook-Signature`). **mTLS:** a deployment option at the reverse proxy, not app logic.

## 2. What Keera has today (codebase findings)

| Area | Finding | Implication |
|---|---|---|
| Auth | **None.** No `AuthProvider` in `bootstrap/application.py`. `fastapi-startkit-auth` is not a dependency (`pyproject.toml` has `fastapi-startkit[database,fastapi,sqlite,vite]>=0.58.0`). Every `/api/*` route, `/mcp` and the terminal WebSockets are unauthenticated. | Keera is a localhost tool bound to `127.0.0.1:4545`. **Exposing an ingest endpoint to remote apps exposes everything else too**, unless we add auth or network separation first. See open question Q1. |
| Routing | All routes are in `routes/web.py` through the startkit `Router`. API routes come before the `/{project}` wildcard. | `/api/{source_id}/envelope/` has 4 segments, so it can't collide with `/{project}`, but it is still registered in the API block. It needs the **trailing slash** exactly, because SDKs post to `.../envelope/`. |
| Errors | `app/exceptions/handlers.py` maps `ModelNotFoundException` to `{"error": ...}` 404. | A new `ProblemDetails` exception handler is added for the ingest and management APIs. |
| Conventions | Controllers use RESTful verbs, Pydantic requests in `app/requests/`, `JsonResource` in `app/resources/`, actions in `app/actions/`, factory-driven tests. | Followed in the ticket breakdown (§10). |
| Queue | `app/console/queue_work_command.py` (taskiq) references task modules that don't exist in this repo. | It is stale, so don't rely on it. Process inline first, or add a small background task. See Q6. |

## 3. Standards compared

### 3.1 Wire protocol

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Sentry ingestion protocol** (DSN, envelope, event schema) | Mature, rich error model: structured frames, `request`, `user`, `contexts`, `breadcrumbs`, `tags`, `release`, `environment`, `fingerprint`. **Every major language already has an SDK**, with PII defaults, sampling, offline caching, rate-limit handling, gzip/br and `event_id` idempotency built in. Third-party self-hosters prove it can be reimplemented. | Format is Sentry-defined: a de facto standard, not an IETF one. Envelope parsing is custom (newline-delimited). The project id in the DSN **must be numeric** for some SDKs. | **Chosen** |
| **OpenTelemetry OTLP/HTTP** + exception semconv | Vendor-neutral CNCF standard. Strong transport rules (gzip mandatory on servers, 413, retryable 429/502/503/504 with Retry-After, partial success). | Built for traces/logs/metrics, not issues. The exception semconv is thin: `exception.type`, `exception.message`, `exception.stacktrace` (a **single string**, no structured frames), and `exception.escaped` is deprecated. There is no first-class request payload or "issue". It needs protobuf, and users would have to set up the OTel SDK plus an exporter. | Later adapter (`/v1/logs`) |
| **Custom JSON API** | Simplest to build. | No SDKs, so every client reimplements retries, PII and batching. It's exactly the thing the user wants to avoid. | Rejected |

### 3.2 Error responses: RFC 9457 Problem Details

Use `Content-Type: application/problem+json` with `type`, `title`, `status`, `detail`, `instance`, plus extension members (`errors`, `retry_after`). RFC 9457 obsoletes RFC 7807. Sentry SDKs ignore response bodies apart from the status and rate-limit headers, so this is compatible. The exception is the `/oauth/token` errors, which must stay in RFC 6749 §5.2 shape `{"error","error_description"}`, which startkit already emits.

### 3.3 Auth options

| Option | Fits ingest (SDKs)? | Fits management (register source)? | Notes |
|---|---|---|---|
| **Per-source key embedded in a DSN** | **Yes, the only thing stock SDKs send.** | No | The key is an *identifier with abuse limits*, not a secret. It ships inside browser bundles. Protection comes from per-key rate limits, origin allowlists, revocation and rotation. |
| Static API key / Bearer (startkit `ApiTokenGuard`, `{id}\|{secret}`) | No (SDKs can't send it) | Possible | Tokens belong to a *user* (`ApiToken.create(user_or_id, ...)`). Keera has no users table. Good later for humans/CLI. |
| **OAuth2 client-credentials** (startkit `AuthOAuth2Provider`) | No | **Yes, chosen** | A standard machine-to-machine grant with scopes, rotation and revocation. Startkit provides `/oauth/token`, `/oauth/introspect`, `/oauth/revoke` and the `auth:oauth2:client` command. Client-credentials tokens have no user, so routes use `require_scopes(...)`, which exposes `ctx.client_id`, and **not** `auth`/`current_user`, which reject user-less tokens. |
| HMAC request signing | No (no SDK support) | Overkill | Use it for **inbound webhooks** from hosted tools, for example verifying Sentry's `Sentry-Hook-Signature` (HMAC-SHA256 of the body with the integration's client secret). |
| mTLS | No (impractical for SDKs and browsers) | Optional | Terminate at the reverse proxy (Caddy/nginx) for private server-to-server deployments. No app code needed. |

## 4. Integration model: sources, keys and DSNs

```
Admin / third-party tool                          Keera
--------------------------                        -----
1. Obtain OAuth client (admin runs                 oauth_clients (startkit)
   `artisan auth:oauth2:client` or Keera UI)
2. POST /oauth/token  (client_credentials)   -->  JWT access token, scopes
3. POST /api/v1/sources  (Bearer)            -->  ingest_sources + ingest_source_keys
                                             <--  { id: 42, dsn: "https://<key>@keera.example.com/42" }
4. App configures SDK with that DSN
5. SDK: POST /api/42/envelope/ (X-Sentry-Auth: sentry_key=<key>)  --> error_events / error_issues
```

- A **source** is one reporting app or service (Sentry calls it a "project"). It optionally belongs to a Keera `Project`, so issues can become Keera tasks for agents. See Q3.
- A **source key** is one DSN. A source can have several keys for rotation or per-environment use. Each key can be revoked and rate-limited on its own.
- **DSN format** (Sentry-compatible): `{scheme}://{public_key}@{host}[/{path_prefix}]/{source_id}`. SDKs derive `{scheme}://{host}[/{path_prefix}]/api/{source_id}/envelope/`. `source_id` is the integer PK, because sentry-python does `int(project_id)`.
- The Keera UI (Settings → Sources) does the same create/rotate/revoke actions for a human admin as the API does.

## 5. Endpoint contract

### 5.1 Ingest: `POST /api/{source_id}/envelope/` (Sentry-compatible)

**Authentication.** Accept the key from any of these places. If more than one is present, they must agree. Otherwise return 401.

1. Header `X-Sentry-Auth: Sentry sentry_version=7, sentry_key=<public_key>, sentry_client=<sdk>/<ver>`, as sent by server SDKs. Also accept `Authorization: Sentry ...`.
2. Query string `?sentry_key=<public_key>&sentry_version=7`, as sent by browser SDKs to avoid a CORS preflight.
3. The envelope header `"dsn": "https://<public_key>@host/<source_id>"`.

The key must belong to `source_id`, be active, and its source must be active. Unknown, revoked or mismatched keys return **401**. A missing key returns **403**, matching Relay's behaviour.

**Request headers.**

| Header | Values |
|---|---|
| `Content-Type` | `application/x-sentry-envelope` (default if absent). `text/plain` is also accepted (browser, no preflight). |
| `Content-Encoding` | optional: `gzip`, `deflate`, `br`. sentry-python defaults to `br` when `brotli` is installed, otherwise `gzip`. `zstd` is a later addition. |
| `Origin` | Checked against `ingest_sources.allowed_origins` when present (browser). The response echoes it in `Access-Control-Allow-Origin`. `OPTIONS` is answered for preflights. |

**Body: newline-delimited envelope.** Header line, then item-header line + payload, repeated. Only `event` items (type `event`) are turned into errors. `attachment`, `session(s)`, `transaction`, `client_report` and unknown types are **skipped without error**, as the spec requires. Client reports are recorded as outcomes.

**Example request** (shown uncompressed and abbreviated):

```http
POST /api/42/envelope/ HTTP/1.1
Host: keera.example.com
Content-Type: application/x-sentry-envelope
X-Sentry-Auth: Sentry sentry_version=7, sentry_key=9f2c1d8e4b7a4c0e8a1f3b5d6e7c8a90, sentry_client=sentry.python/2.18.0
```
```
{"event_id":"4b0e5c3a9d1f4e2a8b7c6d5e4f3a2b1c","sent_at":"2026-10-07T23:10:02.114Z","sdk":{"name":"sentry.python","version":"2.18.0"}}
{"type":"event","length":1187}
{"event_id":"4b0e5c3a9d1f4e2a8b7c6d5e4f3a2b1c","timestamp":"2026-10-07T23:10:01.982Z","platform":"python","level":"error","environment":"production","release":"billing@1.4.2","server_name":"web-3","transaction":"POST /invoices","exception":{"values":[{"type":"ZeroDivisionError","value":"division by zero","mechanism":{"type":"starlette","handled":false},"stacktrace":{"frames":[{"filename":"app/billing.py","module":"app.billing","function":"prorate","lineno":88,"in_app":true,"context_line":"    return amount / days","pre_context":["def prorate(amount, days):"],"post_context":[],"vars":{"amount":"120.0","days":"0"}}]}}]},"request":{"method":"POST","url":"https://billing.example.com/invoices","query_string":"draft=1","headers":{"Content-Type":"application/json","User-Agent":"curl/8.7"},"data":{"customer_id":"c_123","days":0}},"user":{"id":"u_981","email":"jane@example.com","ip_address":"{{auto}}"},"contexts":{"runtime":{"name":"CPython","version":"3.13.1"},"os":{"name":"Linux"},"trace":{"trace_id":"0af7651916cd43dd8448eb211c80319c","span_id":"b7ad6b7169203331"}},"tags":{"tenant":"acme"},"extra":{"invoice_id":"inv_77"},"breadcrumbs":{"values":[{"timestamp":"2026-10-07T23:10:01.900Z","category":"http","message":"POST /invoices","level":"info"}]}}
```

**Responses.**

| Status | When | Body / headers |
|---|---|---|
| `200 OK` | Accepted, or a **duplicate `event_id`** (idempotent no-op) | `{"id":"4b0e5c3a9d1f4e2a8b7c6d5e4f3a2b1c"}`. May carry `X-Sentry-Rate-Limits` to warn early. |
| `400 Bad Request` | Malformed envelope, bad JSON, `length` mismatch, duplicate `sent_at`, invalid `event_id` | problem+json. **Clients must not retry.** |
| `401 Unauthorized` | Unknown, revoked or mismatched key, or the sources disagree | problem+json |
| `403 Forbidden` | No credentials, origin not allowed, source disabled | problem+json |
| `413 Content Too Large` | Compressed or decompressed body over the limit (§6) | problem+json. SDKs drop the event and don't retry. |
| `415 Unsupported Media Type` | Unknown `Content-Encoding` | problem+json |
| `429 Too Many Requests` | Rate-limited | `Retry-After: 60` and `X-Sentry-Rate-Limits: 60:error;default:key` |
| `503 Service Unavailable` | Overloaded or in maintenance | `Retry-After`. Retryable. |

Example error:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/problem+json
Retry-After: 60
X-Sentry-Rate-Limits: 60:error;default:key

{"type":"https://keera.dev/problems/rate-limited","title":"Rate limit exceeded","status":429,
 "detail":"Source 42 key 9f2c…8a90 exceeded 600 events/min","instance":"/api/42/envelope/","retry_after":60}
```

**Optional compatibility endpoint:** `POST /api/{source_id}/store/` takes a single Sentry event as plain JSON. Older SDKs and quick curl integrations use it. It shares the same pipeline.

### 5.2 Management: register a source and issue credentials (`/api/v1`, OAuth2)

Scopes: `sources:read`, `sources:write`, `keys:write`, `events:read`.

| Method & path | Scope | Purpose |
|---|---|---|
| `POST /oauth/token` | none (client auth) | startkit, `grant_type=client_credentials` |
| `GET /api/v1/sources` | `sources:read` | List the sources this client can see |
| `POST /api/v1/sources` | `sources:write` | **Register a source.** Returns its first key/DSN. |
| `GET /api/v1/sources/{id}` | `sources:read` | Show one source |
| `PATCH /api/v1/sources/{id}` | `sources:write` | Change name, origins, limits, scrubbing or status |
| `DELETE /api/v1/sources/{id}` | `sources:write` | Disable (soft delete) |
| `POST /api/v1/sources/{id}/keys` | `keys:write` | Issue an extra DSN (rotation) |
| `DELETE /api/v1/sources/{id}/keys/{key_id}` | `keys:write` | Revoke a DSN |
| `GET /api/v1/sources/{id}/issues` | `events:read` | Read back grouped issues (optional) |

Controllers follow the repo convention: `source_controller.index/show/store/update/destroy` and `source_key_controller.store/destroy`.

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded
Authorization: Basic base64(client_id:client_secret)

grant_type=client_credentials&scope=sources:write keys:write
```
```json
{"access_token":"eyJhbGciOiJIUzI1NiIs...","token_type":"Bearer","expires_in":3600,"scope":"sources:write keys:write"}
```
```http
POST /api/v1/sources
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json

{"name":"billing-api","platform":"python","project_id":3,
 "allowed_origins":[],"rate_limit_per_minute":600}
```
```http
HTTP/1.1 201 Created
Location: /api/v1/sources/42
Content-Type: application/json

{"data":{"id":42,"name":"billing-api","platform":"python","project_id":3,"status":"active",
 "rate_limit_per_minute":600,"allowed_origins":[],
 "keys":[{"id":7,"label":"default","public_key":"9f2c1d8e4b7a4c0e8a1f3b5d6e7c8a90",
          "dsn":"https://9f2c1d8e4b7a4c0e8a1f3b5d6e7c8a90@keera.example.com/42",
          "created_at":"2026-10-07T23:00:00Z"}],
 "endpoints":{"envelope":"https://keera.example.com/api/42/envelope/"}}}
```

Validation errors return `422` problem+json with an `errors` extension: `[{"pointer":"/name","detail":"required"}]`.

## 6. Transport concerns

| Concern | Decision |
|---|---|
| **Idempotency** | `event_id` (UUID v4, 32 hex chars; dashes stripped on input) is the idempotency key. A unique index on `(source_id, event_id)` makes a retry or duplicate return `200 {"id"}` with no second row. No separate `Idempotency-Key` header is needed (draft-ietf-httpapi-idempotency-key-header). The management `POST /api/v1/sources` may accept `Idempotency-Key` later. |
| **Batching** | An envelope may carry many items, but **at most one `event` item** (Sentry rule). SDKs batch by sending envelopes concurrently from a background queue. Extra items in the same envelope (attachments, client reports) are processed or ignored per item. |
| **Compression** | Support `gzip`, `deflate` and `br`. Decompress as a **stream with a byte cap** to block decompression bombs. |
| **Size limits** | Defaults (configurable): compressed body **≤ 20 MiB**, decompressed envelope **≤ 20 MiB**, each event item **≤ 1 MiB** (same as Sentry), each attachment **≤ 10 MiB** (or dropped if attachments are out of scope). Over the limit returns **413**. Also truncate long strings: `request.data` 10 KB, breadcrumbs 100, frames 250, `vars` per frame 50 keys. |
| **Rate limiting** | An in-process token bucket per key (and per source), configured with `rate_limit_per_minute`. Over the limit returns **429** + `Retry-After` + `X-Sentry-Rate-Limits: <secs>:<categories>:key`. SDKs honour both. 429/503 are the only retryable statuses. Keep counters in memory, which is fine for a single process. Move to a DB/Redis bucket if Keera runs with several workers. |
| **Retries / backoff** | Client side: retry only on network errors, 429, 502, 503 and 504, with exponential backoff and jitter capped at ~5 min, honouring `Retry-After`. Never retry 400/401/403/413. Sentry SDKs already behave this way. Server side: store first, process async, so ingest stays cheap. |
| **PII scrubbing** | Defence in depth: (1) SDK `send_default_pii=False` (the default) omits cookies, IP and user details. (2) **Server-side scrubbing before anything is persisted or logged**: recursively mask values whose keys match `password\|passwd\|secret\|token\|api[-_]?key\|authorization\|cookie\|set-cookie\|session\|csrf\|credit\|card\|cvv\|ssn`, mask PAN-looking digit runs (Luhn check), drop `Cookie`/`Authorization` headers, and resolve `{{auto}}` IP but store it only if `source.store_ip_address`. (3) Each source has `scrub_settings` (extra keys, opt-outs). Raw payloads are never written to logs. |
| **Versioning** | Ingest is versioned by the Sentry protocol itself (`sentry_version=7`). Accept 7 or a missing value. Unknown envelope/item attributes are kept or ignored, as the spec requires. The management API is under `/api/v1/`. Breaking changes get `/api/v2/`, with `Deprecation`/`Sunset` headers (RFC 9745/8594) on v1. Problem `type` URIs are stable. |
| **Clock drift** | Use `sent_at` to correct `timestamp` when they are skewed by more than 60 s. |
| **Transport security** | HTTPS only when exposed (the reverse proxy terminates TLS, with optional mTLS). The DSN key is treated as public: rate limits, origin allowlist and revocation are the controls. |

## 7. Auth mapped to fastapi-startkit

```python
# bootstrap/application.py: AuthProvider must come before its feature providers
(AuthProvider, AuthConfig),                       # config/auth.py: Config(AuthConfig)
(AuthOAuth2Provider, OAuth2Config(
    key=env("KEERA_OAUTH_KEY"), issuer=env("KEERA_APP_URL"),
    grant_types=["client_credentials"],
    scopes={"sources:read": "...", "sources:write": "...", "keys:write": "...", "events:read": "..."},
)),
```

- Management routes: `ctx = Depends(require_scopes("sources:write"))`. Use `ctx.client_id` to record `ingest_sources.created_by_client_id` and to scope listings, so each client sees only its own sources unless it holds an admin scope.
- OAuth clients come from `uv run python artisan auth:oauth2:client` or a Keera Settings UI, through `manager.client_repository.register(...)`.
- Ingest routes use a custom dependency `ingest_key = Depends(resolve_ingest_key)` that parses `X-Sentry-Auth`, `sentry_key` or the envelope `dsn` and loads `IngestSourceKey`. This is deliberately **outside** the startkit guard system: SDK credentials are not Bearer tokens, and guards must not try to turn them into users.
- Later, when Keera gets users: an `ApiTokenGuard` for humans/CLI (`ApiToken.create(user, abilities=["sources:write"])`) can sit beside OAuth2 without touching the ingest path.
- Startkit auth errors (`401 invalid_token`, `403 insufficient_scope`, `429 throttled`) keep their RFC 6749 shape. The new handlers emit problem+json for everything else.

## 8. Proposed tables

Startkit adds `oauth_clients`, `oauth_access_tokens`, `oauth_refresh_tokens` and `oauth_auth_codes` through its migrations. Keera adds:

**`ingest_sources`**: one reporting app.

| column | type | notes |
|---|---|---|
| id | int PK | **the DSN project id** (must be an integer) |
| project_id | int FK → projects, nullable | link to a Keera project (tasks/agents) |
| name | str | |
| slug | str unique | |
| platform | str nullable | python, javascript, … |
| status | str | `active` / `disabled` |
| allowed_origins | json list | browser CORS allowlist; `[]` means server-only |
| rate_limit_per_minute | int | default 600 |
| max_event_bytes | int nullable | override |
| store_ip_address | bool | default false |
| scrub_settings | json dict | extra keys, opt-outs |
| created_by_client_id | str nullable | OAuth `client_id` |
| created_at / updated_at / deleted_at | ts | soft delete |

**`ingest_source_keys`**: one DSN.

| column | type | notes |
|---|---|---|
| id | int PK | |
| source_id | int FK | |
| label | str | `default`, `staging`… |
| public_key | char(32) **unique** | random 128-bit hex. It's in the DSN, so it is stored as is (see Q4) |
| is_active | bool | |
| rate_limit_per_minute | int nullable | per-key override |
| last_used_at | ts nullable | updated at most once a minute |
| revoked_at / created_at | ts | |

**`error_issues`**: grouped occurrences.

| column | type | notes |
|---|---|---|
| id | int PK | |
| source_id | int FK | |
| fingerprint | char(64) | sha256 of the SDK `fingerprint`, or else of type + in-app frames (module/function) |
| title / culprit | str | e.g. `ZeroDivisionError: division by zero` / `app.billing in prorate` |
| level | str | |
| status | str | `unresolved` / `resolved` / `ignored` |
| times_seen | int | |
| first_seen / last_seen | ts | |
| task_id | int FK → tasks, nullable | the Keera task created for an agent |
| | | **unique(source_id, fingerprint)** |

**`error_events`**: individual occurrences (scrubbed).

| column | type | notes |
|---|---|---|
| id | int PK | |
| source_id, issue_id, source_key_id | int FK | |
| event_id | char(32) | **unique(source_id, event_id)**, the idempotency key |
| timestamp / received_at | ts | |
| level, platform, environment, release, server_name, transaction | str | indexed: environment, release |
| exception | json | `values[]` with structured frames (OTel: `exception.type/message/stacktrace` derivable) |
| request | json | method, url, query_string, headers, data (scrubbed, truncated) |
| user | json | id, email, username, ip (scrubbed per settings) |
| contexts, tags, extra, breadcrumbs, sdk | json | |
| size_bytes | int | |

**`ingest_outcomes`** (optional, for stats and debugging rate limits): `source_id, key_id, category, outcome (accepted|rate_limited|invalid|too_large|filtered|client_discard), reason, quantity, bucket_start (minute)`, with unique `(source_id, key_id, category, outcome, reason, bucket_start)` incremented by upsert.

Retention: purge `error_events` older than N days (setting). `error_issues` are kept.

## 9. Sentry-SDK compatibility assessment

**Feasible, and it's the main reason to pick this protocol.** Minimum surface for stock SDKs to work:

1. `POST /api/{id}/envelope/` with exact trailing-slash handling, plus `OPTIONS` for CORS.
2. Parsing auth from the header, the query or the envelope `dsn`.
3. gzip/deflate/br decoding.
4. `200 {"id"}`, and `429` with `Retry-After`/`X-Sentry-Rate-Limits`.
5. Tolerating, and ignoring where needed, transactions, sessions, client reports and attachments.

Caveats and limits:

- **DSN project id must be numeric**, so integer `ingest_sources.id` is used.
- **Path prefixes work**: `https://key@host/keera/42` posts to `/keera/api/42/envelope/`. That helps behind a reverse proxy.
- **Not supported** (out of scope): `sentry-cli` uploads (source maps, debug files, releases API), performance/tracing UI, replays, profiling, cron monitors, and the Relay project-config endpoints. SDK features that rely on them degrade silently. Errors still arrive, but minified JS stacks stay minified until source maps are supported.
- **Browser SDKs** post `text/plain` with `sentry_key` in the query. They need the CORS allowlist, and the `tunnel` option can route through the customer's own backend.
- **Sentry SaaS → Keera** (the "Sentry registers with Keera" case): Sentry SaaS can't forward raw events, but Sentry **Integration Platform webhooks** (`issue`, `error` and `event_alert` resources) can be received at `POST /api/v1/sources/{id}/webhooks/sentry`. They are verified with HMAC-SHA256 `Sentry-Hook-Signature` using the integration's client secret, which is stored on the source as `webhook_secret`. The other path is running *both*: an SDK can send to two DSNs via a custom transport.
- Verification: run the compatibility suite in ticket 8 with real `sentry-sdk` (Python) and `@sentry/node`/`@sentry/browser` against a test server.

## 10. Implementation ticket breakdown

| # | Ticket | Scope | Depends |
|---|---|---|---|
| 1 | **Network exposure & auth foundation** | Decide on Q1. Add `fastapi-startkit-auth`, register `AuthProvider` + `AuthOAuth2Provider` (client_credentials only), `config/auth.py`, scope catalog, `KEERA_OAUTH_KEY` env, and a problem+json exception handler. Tests: token issue, scope 403. | none |
| 2 | **Sources & keys data model** | Migrations, models and factories for `ingest_sources` and `ingest_source_keys`, plus a DSN builder service. | 1 |
| 3 | **Source management API** | `source_controller` and `source_key_controller` (store, index, show, update, destroy; rotate, revoke), Pydantic requests, `JsonResource`s, `require_scopes`, client scoping. Feature tests. | 2 |
| 4 | **Sources UI** | Settings → Sources page: create source, copy DSN, rotate/revoke keys, origins, limits. Also an OAuth client create/list UI. | 3 |
| 5 | **Envelope ingest endpoint** | Route, auth dependency (header/query/dsn agreement), streaming decompression with caps, envelope parser (`length`/implicit), item routing, CORS, 400/401/403/413/415 responses. Parser unit tests with fixtures. | 2 |
| 6 | **Event normalisation, PII scrubbing, storage & idempotency** | Scrubber, truncation, `error_events` with unique `event_id`, clock-drift fix, optional `/store/` endpoint. | 5 |
| 7 | **Rate limiting & outcomes** | Per-key/per-source token bucket, 429 + `Retry-After` + `X-Sentry-Rate-Limits`, `ingest_outcomes`, client_report items. | 5 |
| 8 | **Sentry SDK compatibility suite** | Integration tests that run real `sentry-sdk` (Python) and a Node script against a live test server: plain event, gzip/br, duplicate id, 429 backoff, 413. | 6, 7 |
| 9 | **Issue grouping → Keera tasks** | `error_issues` fingerprinting, times_seen/last_seen, issue list UI, "create task / dispatch agent" from an issue (Q3). | 6 |
| 10 | **Client integration guide** (#2710) | Publish the draft guide in `docs/`. | 3, 5 |
| 11 | *(optional)* Sentry webhook source | HMAC-verified `Sentry-Hook-Signature` receiver mapped to issues. | 9 |
| 12 | *(optional)* OTLP/HTTP logs adapter | `POST /v1/logs` (JSON + protobuf), mapping `exception.*` log records to events. | 6 |
| 13 | Retention job | Purge old events on a schedule. | 6 |

## 11. Open questions for the user

1. **Exposure / threat model (blocking):** Keera's whole API, `/mcp` and the terminal WebSockets have no auth today and bind to `127.0.0.1`. Once it accepts reports from other machines, how should ingest be exposed?
   - (a) A reverse proxy that forwards **only** `/api/*/envelope/`, `/oauth/token` and `/api/v1/sources*`. This is the smallest change and is recommended for now.
   - (b) A second listener/port for ingest only.
   - (c) Adding auth to all existing routes, which is a much larger project.
2. **Hosting:** will Keera stay a single-user desktop/local app, or become a hosted multi-user server? This decides between the in-memory and shared rate limiter, and whether `ApiTokenGuard` and users come in now.
3. **Source ↔ Project:** should a source map to a Keera `Project`, and should a new issue auto-create a Task and dispatch an agent, or only when a human clicks?
4. **Key storage:** store DSN public keys in plaintext (Sentry semantics, re-viewable in the UI) or hash them (show once, like startkit API tokens)? Recommendation: plaintext, because the key is public by design.
5. **Scope of Sentry compatibility:** errors only (recommended v1), or also attachments, source maps or transactions?
6. **Processing model:** process synchronously in the request (simplest, fine at low volume) or queue for a background worker? The existing taskiq command is stale.
7. **Retention & limits defaults:** are 30 days, 600 events/min/key and 1 MiB/event acceptable?
8. **"Sentry registers with Keera":** does this mean stock SDKs pointed at Keera (covered), Sentry SaaS forwarding via webhooks (ticket 11), or both?

## 12. Sources

- fastapi-startkit authentication: https://fastapi-startkit.github.io/docs/authentication (sections Providers, Guards, API tokens, OAuth 2.1, Protecting routes, Errors)
- Sentry Envelopes: https://develop.sentry.dev/sdk/data-model/envelopes/ (Serialization Format, Headers, Authentication, Size Limits, Data Model)
- Sentry Rate Limiting: https://develop.sentry.dev/sdk/expected-features/rate-limiting/ (`X-Sentry-Rate-Limits`, 429 defaults)
- Sentry overview / auth header & DSN: https://develop.sentry.dev/sdk/overview/ ("Parsing the DSN", "Authentication")
- Sentry event payload: https://develop.sentry.dev/sdk/data-model/event-payloads/ (exception, stacktrace, request, user, contexts, breadcrumbs)
- Sentry integration webhooks: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/ (`Sentry-Hook-Signature`)
- OTLP 1.x spec: https://opentelemetry.io/docs/specs/otlp/ (OTLP/HTTP Request/Response, Failures, Retryable Response Codes, OTLP/HTTP Throttling)
- OTel exception semconv: https://opentelemetry.io/docs/specs/semconv/exceptions/
- RFC 9457 Problem Details; RFC 6749 §4.4 (client credentials) & §5.2; RFC 6585 §4 (429); RFC 9110 §10.2.3 (Retry-After), §15.5.14 (413); RFC 8594 (Sunset); draft-ietf-httpapi-idempotency-key-header
