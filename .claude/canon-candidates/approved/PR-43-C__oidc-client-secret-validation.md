# Canon Candidate — OIDC client_secret validation before persisting

## Metadata

- **Task surfacing this gap**: PR-43-C (Wave 3.2 — OIDC clientSecret atomic replace + handshake)
- **Specific decision**: how to validate a NEW OIDC `clientSecret` against the IdP BEFORE persisting it to the DB? Currently: I call `openidClient.discovery(URL, clientId, clientSecret)` and treat success as "secret is valid". Is this actually validating the secret, or just loading metadata?
- **Decision date**: 2026-05-07
- **Synthesized by**: claude-opus-4-7
- **Status**: approved (2026-05-07)

## Why this gap exists

- **Existing canon adjacent**:
  - `cockburn-hexagonal-architecture` (stateless adapters w.r.t. credentials) — covers structure
  - No canon entry on OIDC client authentication semantics or the difference between "discovery" and "token endpoint" w.r.t. credential validation
- **What's missing in those entries**: nothing prescribes which OIDC endpoint actually authenticates the client, so I picked `discovery()` by intuition.
- **Why default heuristic is insufficient**: I assumed `openidClient.discovery(url, clientId, clientSecret)` validates the secret because all 3 args are passed. **This is wrong** — discovery only fetches the public well-known metadata document; the clientSecret is stored in the returned `Configuration` for LATER use, not validated at discovery time. So my probe gives FALSE POSITIVES — a wrong secret passes discovery silently. The "test before commit" semantic in our `ReplaceOidcClientSecretUseCase` is broken.

## Research scope

- **Search keywords**: `openid-client discovery validate client_secret`, `clientCredentialsGrant openid-client v6`, `RFC 6749 invalid_client error response`
- **Sources targeted**: (1) openid-client v6 official docs (the lib we use); (2) RFC 6749 §5.2 (canonical OAuth 2.0 error response semantics); (3) RFC 8414 / OIDC Core 1.0 (discovery vs token endpoint roles).
- **Sources excluded**: blog posts on OAuth without authoritative grounding.

## Sources consulted

### [1] openid-client v6 — discovery() function — [github.com/panva/openid-client](https://github.com/panva/openid-client/blob/main/docs/functions/discovery.md)

- **Fetched**: 2026-05-07
- **Authority**: official docs of the library we use directly in production code (`apps/api/src/infrastructure/auth/OpenidClientHandshakeProbe.ts`).
- **Key claims**:
  - "Performs Authorization Server Metadata discovery and returns a Configuration with the discovered Authorization Server metadata."
  - The function fetches the well-known metadata document (a public GET); it does NOT call the token endpoint.
  - The clientSecret is stored in the resulting `Configuration` object for use in subsequent token/userinfo calls, but is NOT transmitted to the IdP during discovery itself.
- **My reading**: `discovery()` validates that the IdP has a well-formed metadata document. It does NOT validate the clientSecret. Our probe is WRONG.

### [2] openid-client v6 — clientCredentialsGrant() function — [github.com/panva/openid-client](https://github.com/panva/openid-client/blob/main/docs/functions/clientCredentialsGrant.md)

- **Fetched**: 2026-05-07
- **Authority**: same library official docs.
- **Key claims**:
  - Signature: `clientCredentialsGrant(config, parameters?, options?): Promise<TokenEndpointResponse>`
  - Calls the IdP's `token_endpoint` with `grant_type=client_credentials` + the configured client authentication (clientSecret per `client_secret_post` or `client_secret_basic`).
  - Returns the token response on success; rejects with an error on authentication failure.
- **My reading**: this is the canonical openid-client method that ACTUALLY authenticates the client to the IdP. Throws on bad credentials.

### [3] RFC 6749 — OAuth 2.0 §5.2 Error Response — [datatracker.ietf.org](https://datatracker.ietf.org/doc/html/rfc6749#section-5.2)

- **Fetched**: 2026-05-07
- **Authority**: IETF RFC — the OAuth 2.0 spec.
- **Key claims**:
  - When client authentication fails at the token endpoint, the authorization server returns the `invalid_client` error code.
  - HTTP 401 (with `WWW-Authenticate` header) or 400 depending on auth method.
  - `invalid_client` is the canonical signal of "your secret is wrong".
- **My reading**: spec-level confirmation that the token endpoint is where client authentication happens, with a standardized error code we can pattern-match against in catch blocks.

### [4] OIDC Core 1.0 §9 Client Authentication — [openid.net](https://openid.net/specs/openid-connect-core-1_0.html#ClientAuthentication)

- **Fetched**: 2026-05-07 (via prior knowledge — well-known section of the spec)
- **Authority**: OpenID Foundation — the OIDC spec.
- **Key claims**:
  - Defines client authentication methods: `client_secret_basic` (Authorization header), `client_secret_post` (body params), `client_secret_jwt`, `private_key_jwt`, `none`.
  - All except `none` rely on the clientSecret (or signed assertion) authenticated AT the token endpoint, not at discovery.
  - Discovery's `token_endpoint_auth_methods_supported` field tells you which methods the IdP accepts — doesn't authenticate them.
- **My reading**: definitive — discovery is metadata-only; authentication is at the token endpoint. The IdP's choice of `token_endpoint_auth_methods_supported` constrains the validation method but doesn't change the validation point.

## Synthesis

### Recommendation: USE

- **`clientCredentialsGrant(config)` as the primary validation method** — calls the token endpoint, which authenticates the client per RFC 6749. If credentials are valid, returns a token (which we discard). If invalid, throws with `invalid_client` semantics.
- **Catch + map `invalid_client` to VALIDATION_FAILED** in the use case — that's the canonical "secret is wrong" signal.
- **Catch + map `unsupported_grant_type` to PARTIAL_VALIDATION** — some OIDC IdPs (especially SSO-only configs) don't allow `client_credentials` grant. In that case, our "test before commit" cannot fully verify; the operator should be warned the validation is partial.
- **Pre-validate via `discovery()` first** — confirms the issuerUrl returns valid metadata; failure here means wrong issuer, not wrong secret. Useful for differentiating error categories.

### Recommendation: AVOID

- **`discovery()` as sole validation** — does NOT validate the clientSecret. Returns success for ANY secret value (or even none). This is exactly what our current `OpenidClientHandshakeProbe.discover()` does; it's a false-confidence pattern.
- **Resource Owner Password Credentials grant** (`grant_type=password`) — deprecated in OAuth 2.1 (draft). Don't use even though it would work.
- **Authorization Code flow as a test mechanism** — requires browser, redirect, user interaction. Not feasible for a sync admin endpoint.
- **Trusting the operator's input syntactically** (length/format check only) — falsely raises confidence. The operator can paste obviously-correct-looking-but-wrong secrets.

### Tradeoffs / decision tree

- **If the IdP allows `client_credentials` grant**: `clientCredentialsGrant` is canonical. Returns a token to discard.
- **If the IdP rejects `client_credentials` grant** (`unsupported_grant_type`): we have no fully-server-side validation path. Best we can do is `discovery()` + return `PARTIAL` + note in audit log "format-only validation; actual SSO attempt required to confirm".
- **If we want maximum coverage**: chain — discovery first (validates issuerUrl + clientId well-formed), then `clientCredentialsGrant` (validates clientSecret). Two specific error categories surface to the admin.
- **Open question**: should we expose a "validation level" enum to the admin UI (`STRICT_PASSED` | `PARTIAL_PASSED` | `FAILED`) so they understand the residual risk? Defer; current contract returns ok/err only.

### Pinned values / flags

- **openid-client version floor**: ≥ 6.0 (workspace already uses recent v6). API for `clientCredentialsGrant` is stable in v6+.
- **Canonical error pattern-match**: catch the openid-client error type and check `error?.error === 'invalid_client'` (per RFC 6749 §5.2).
- **Token disposal**: the access_token returned by `clientCredentialsGrant` during validation is **never used and never logged** — discard immediately. Even short-lived, leaking a token in audit logs is a vector. Wrap the call to ensure the variable goes out of scope before any logger statement.

## Proposed canon-index.json entry

```json
{
  "key": "oidc-client-secret-validation-clientcredentialsgrant",
  "topic": "OIDC client_secret validation — token endpoint, not discovery",
  "area": "Security · OIDC · Client authentication",
  "summary": "openid-client `discovery()` does NOT validate the clientSecret — it only fetches the public well-known metadata document. The clientSecret is stored in the returned Configuration for later use but never transmitted at discovery time. To actually validate a clientSecret before persisting it, call the token endpoint via `clientCredentialsGrant(config)` — the IdP authenticates the client and returns RFC 6749 `invalid_client` error if the secret is wrong. Caveat: not all IdPs allow `client_credentials` grant (especially SSO-only configs); fall back to PARTIAL_VALIDATION with `unsupported_grant_type` flag.",
  "keyTakeaway": "discovery = metadata fetch (no auth). clientCredentialsGrant = real client auth at token endpoint. Use the latter for `test-before-commit` validation. Map `invalid_client` → VALIDATION_FAILED, `unsupported_grant_type` → PARTIAL_VALIDATION (operator must verify with a real SSO attempt). Never log or persist the token returned by the validation call — discard immediately.",
  "patternAdopted": "OidcHandshakeProbe.discover(input) chains: (1) `openidClient.discovery(issuerUrl, clientId, clientSecret)` — validates issuerUrl + builds config; (2) `openidClient.clientCredentialsGrant(config)` — validates clientSecret. Catches errors and maps: `invalid_client` → throw matching VALIDATION_FAILED in caller; `unsupported_grant_type` → log warning + return special PARTIAL_VALIDATION result; network/timeout → INTERNAL_ERROR. Token from successful clientCredentialsGrant is never assigned to a logger-reachable variable. Use case `ReplaceOidcClientSecretUseCase` interprets PARTIAL_VALIDATION as ok-with-warning (still persists, but audit log notes 'partial validation only').",
  "usedIn": "PR-43-C (Wave 3.2 — OIDC clientSecret atomic replace + handshake)",
  "date": "2026-05-07",
  "sources": [
    {
      "url": "https://github.com/panva/openid-client/blob/main/docs/functions/discovery.md",
      "fetchedAt": "2026-05-07",
      "title": "openid-client v6 — discovery() (metadata-only, no auth)"
    },
    {
      "url": "https://github.com/panva/openid-client/blob/main/docs/functions/clientCredentialsGrant.md",
      "fetchedAt": "2026-05-07",
      "title": "openid-client v6 — clientCredentialsGrant() (token endpoint, real auth)"
    },
    {
      "url": "https://datatracker.ietf.org/doc/html/rfc6749#section-5.2",
      "fetchedAt": "2026-05-07",
      "title": "RFC 6749 §5.2 — invalid_client error response"
    },
    {
      "url": "https://openid.net/specs/openid-connect-core-1_0.html#ClientAuthentication",
      "fetchedAt": "2026-05-07",
      "title": "OIDC Core 1.0 §9 — client authentication methods"
    }
  ],
  "synthesizedBy": "claude-opus-4-7",
  "confidence": "high",
  "lastVerified": "2026-05-07",
  "version": 1,
  "appliesTo": ["apps/api/src/application/auth/", "apps/api/src/infrastructure/auth/"]
}
```

## Impact on existing code

- **Files that should change** (research surfaced different optimal pattern — current code is INCORRECT not just suboptimal):
  - `apps/api/src/infrastructure/auth/OpenidClientHandshakeProbe.ts` — current `discover()` only calls `openidClient.discovery`, gives false positive on wrong secret. **Refactor**: chain discovery + clientCredentialsGrant; catch and re-throw with structured error type. ~30 min.
  - `apps/api/src/application/auth/ReplaceOidcClientSecretUseCase.ts` — currently treats any handshake error as VALIDATION_FAILED. **Refactor**: handle `unsupported_grant_type` specifically as a `PARTIAL_VALIDATION` result (warning, persist anyway with audit-log note). ~20 min.
  - Tests in `apps/api/tests/unit/infrastructure/auth/OpenidClientHandshakeProbe.test.ts` — currently mocks `discovery` only. **Refactor**: also mock `clientCredentialsGrant`; add tests for `invalid_client` rejection + `unsupported_grant_type` partial validation. ~25 min.
  - Tests in `apps/api/tests/unit/application/auth/ReplaceOidcClientSecretUseCase.test.ts` — add scenarios for partial validation result. ~15 min.
  - Total refactor effort: ~90 min, similar to original PR-43-C implementation.

- **Honest disclosure**: this is a SECURITY-FACING bug in the original PR-43-C implementation. The "test before commit" was advertised but didn't work. Operator could paste wrong secret and the system would silently persist it, breaking SSO for all users until the next login attempt fails.

- **Files that already align with this canon**:
  - None — the entire flow needs the chain refactor.

## Edward's review

- [x] Sources are sufficient (4: openid-client docs × 2 + RFC 6749 + OIDC Core 1.0)
- [x] Recommendations match project values
- [x] Pinned values reasonable for our scale + threat model
- [x] Acknowledge that PR-43-C had a false-confidence bug (severity: medium — admin error UX, not security exposure)
- [x] Approve append to `canon_research_index.md`
- [x] Trigger refactor commit on `OpenidClientHandshakeProbe.ts` + use case + tests (~90 min effort)
- Notes: Approved.
