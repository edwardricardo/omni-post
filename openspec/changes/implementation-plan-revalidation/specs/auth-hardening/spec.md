# Auth Hardening — Specification (§2C confirmed-fix end state)

> The END STATE the confirmed §2C auth/priv-esc fixes MUST satisfy. Applies only
> to leads Phase A confirmed. RFC 2119 keywords are normative.

## Requirements

### Requirement: Registration cannot escalate privilege

`POST /auth/register` MUST NOT accept a caller-supplied `role` (or any
privilege-bearing field) from the request body. Registration MUST create only a
default non-privileged role; ADMIN MUST NOT be assignable via self-registration
(AUTH-REGISTER-PRIVESC, mass-assignment).

#### Scenario: role in body is ignored

- GIVEN an anonymous caller posting to `/auth/register` with `role: "ADMIN"`
- WHEN the account is created
- THEN the created user has the default non-privileged role, not ADMIN

#### Scenario: legitimate registration succeeds unchanged

- GIVEN a valid registration payload with no role field
- WHEN the account is created
- THEN registration succeeds with the default role

### Requirement: Rate limiting is live and not spoofable

`@fastify/rate-limit` MUST be registered so the auth `rateLimit` config is
enforced (not dead code). The rate-limit key MUST NOT be spoofable via
`X-Forwarded-For` (the `trustProxy` configuration must not let an untrusted client
forge the limit key). This is the core middleware, distinct from the
`rateLimitingDashboard` observability plugin (§4A).

#### Scenario: rate limit enforced on auth

- GIVEN the rate-limit threshold for an auth route
- WHEN a single client exceeds that threshold within the window
- THEN subsequent requests are rejected with a rate-limit response

#### Scenario: forged forwarding header does not reset the limit

- GIVEN a client at the rate-limit threshold
- WHEN it sends requests rotating a spoofed `X-Forwarded-For`
- THEN the limit still applies (the key is not attacker-controlled)
