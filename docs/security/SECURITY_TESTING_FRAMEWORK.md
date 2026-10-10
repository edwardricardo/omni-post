# 🛡️ Security Testing Framework

This document describes the security testing infrastructure for the Social Media CMS platform.

> ## ⚠️ Status — read before running anything here
>
> **Most of the `security/tests` suite described below does not execute, and
> cannot pass.** Its 7 suites target an `/api/*` prefix the application never
> registers, so every `before` hook 404s and every test skips. The run is
> measured identically with Postgres up and with Postgres down: of 65 tests,
> only 3 pass, 6 fail and 56 skip. The 5 `pnpm test:*-security` scripts that
> used to invoke it exited 0 over that, and were **deleted** for exactly that
> reason.
>
> - Disposition of the suite is tracked as **SMELL-83** in
>   [`docs/reports/roadmap-detected-smells-backlog.md`](../reports/roadmap-detected-smells-backlog.md);
>   the in-tree warning is [`security/tests/README.md`](../../security/tests/README.md).
> - Sections 1–4 below (§"Security Test Categories") describe **intent**, not
>   verified behaviour. Nothing in them has ever been observed to run green.
> - The checks that DO run today, and the gate that runs each one, are in
>   §"Where each check runs" — that table is the live one.
>
> Do not restore the deleted scripts, and do not wire the suite into a job,
> without reading SMELL-83 first: a naive wiring lands either a permanently-red
> required job or a green one with 56 of 65 tests skipped.

## 📁 Directory Structure

```
security/
├── config/
│   └── security-policies.json                      # Read by no script or workflow
├── tests/                                          # ⚠️ VACUOUS — see SMELL-83 + tests/README.md
│   ├── README.md                                   # Why this suite must not be wired yet
│   ├── auth-security.test.ts
│   ├── api-security.injection.test.ts
│   ├── api-security.validation-auth.test.ts
│   ├── injection-tests.sql-nosql.test.ts
│   ├── injection-tests.xss-command.test.ts
│   ├── injection-tests.ldap-xml-template-header.test.ts
│   ├── injection-tests.test-helpers.ts             # Shared (broken) bootstrap
│   └── infrastructure-security.test.ts
└── zap/
    └── zap-config.conf                             # Not read by the ZAP job
```

## 🔧 Quick Start

### Where each check runs

Every security check below runs in a CI gate. The two local scan scripts that
repeated them, `security/scripts/security-scan.sh` and
`security/scripts/vulnerability-report.ts`, were removed on 2026-10-10, with
their two `apps/api` entry scripts and the four single-suite scripts they
called (`test:auth`, `test:rbac`, `test:security`, `test:mfa`). Two checks they
ran have no gate: see [Not covered by a gate](#not-covered-by-a-gate).

"PR, main" means every pull request and every push to `main`. Gate paths are
under `.github/workflows/`.

| Check                               | CI gate: file, job › step                                                                                                                                            | Runs on                   | Run it locally                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| ESLint                              | `ci.yml:65`, Lint and Format Check › Run ESLint                                                                                                                      | PR, main                  | `pnpm lint`                                                                  |
| Type check                          | `ci.yml:68`, Lint and Format Check › TypeScript type check (full monorepo)                                                                                           | PR, main                  | `pnpm typecheck`                                                             |
| Semgrep                             | `audit.yml:82`, Semgrep CE (SAST) › Run Semgrep                                                                                                                      | PR, main                  | the step's `semgrep scan` command                                            |
| CodeQL                              | `security-testing.yml:79`, CodeQL (typescript, javascript) › Perform CodeQL analysis                                                                                 | PR, main, nightly         | —                                                                            |
| Dependency advisories               | `ci.yml:652`, Security Audit › Run security audit; `production-ci.yml:37`, Security Audit › Audit dependencies                                                       | PR, main                  | `pnpm audit --audit-level moderate`                                          |
| Container images (Trivy)            | `production-ci.yml:371`, Container Security › Run Trivy vulnerability scanner, for api, workers, admin and client                                                    | PR, main                  | [Container images](#container-images)                                        |
| Security headers                    | `ci.yml:174`, Test Suite (shard N) › Run API tests (shard, blob reporter), which collects `tests/unit/securityHeaders.test.ts`; on a running API, the ZAP scan below | PR, main                  | `pnpm --filter @apps/api exec vitest run tests/unit/securityHeaders.test.ts` |
| SQL injection and XSS               | `ci.yml:533`, Integration Tests › Run integration tests (full tier): the cases of `tests/security.live.test.ts`                                                      | PR, main                  | [The security suites](#the-security-suites)                                  |
| OWASP ZAP baseline                  | `security-testing.yml:168`, OWASP ZAP DAST › Run OWASP ZAP baseline scan                                                                                             | nightly 03:00 UTC, manual | —                                                                            |
| Auth, RBAC, MFA and security suites | `ci.yml:533`, Integration Tests › Run integration tests (full tier), with `TIER=full-integration`                                                                    | PR, main                  | [The security suites](#the-security-suites)                                  |
| Secrets in committed files          | `audit.yml:158`, gitleaks (secrets) › Scan the PR's commits; `audit.yml:265`, secretlint (rule-based secrets) › Run secretlint                                       | PR                        | `pnpm secret:scan`                                                           |

#### The security suites

`apps/api/scripts/run-tests.sh` collects the four suites in its live-API
batches, which run when `TIER` is unset or `full-integration`:
`integration:flows` holds `tests/auth.integration.test.ts` and
`tests/security.live.test.ts`, and `remaining` holds
`tests/mfa.integration.test.ts` and `tests/rbac.integration.test.ts`. The auth,
RBAC and MFA suites call the services against the test database; the security
suite sends requests to the API on `http://localhost:3000`.

```bash
# From the repository root: Postgres and Redis up, the test environment exported
pnpm db:up
set -a; . ./.env.test; set +a

# Every integration batch, the four suites included. The live-API batches also
# need the API running: pnpm --filter @apps/api dev:test
pnpm --filter @apps/api test:integration

# One suite, from apps/api
cd apps/api
NODE_ENV=test node --conditions development --import tsx --test --test-force-exit tests/auth.integration.test.ts

# The two rate-limit unit suites run in the Vitest collector; naming their paths
# fails loudly ("No test files found") if either file is renamed or moved
pnpm --filter @apps/api exec vitest run tests/unit/security/httpRateLimitPreHandler.test.ts tests/unit/authRateLimit.test.ts
```

#### Container images

The gate builds each image from `apps/<service>/Dockerfile` at the repository
root and fails on a CRITICAL or HIGH finding that `.trivyignore` does not list:

```bash
docker build -f apps/api/Dockerfile -t local/api:scan .
trivy image --severity CRITICAL,HIGH --exit-code 1 --ignorefile .trivyignore local/api:scan
```

#### Not covered by a gate

- **License allowlist.** `security-scan.sh` judged every installed package's
  SPDX expression against an allowlist (MIT, Apache-2.0, BSD-2-Clause,
  BSD-3-Clause, ISC, 0BSD). No workflow runs `pnpm licenses`, and
  `pnpm licenses list` prints the licenses without judging them.
- **Dockerfile rules.** `vulnerability-report.ts` flagged a stage running as
  root, a `FROM` on `:latest` and an `ADD`. No workflow lints a Dockerfile. The
  four Dockerfiles meet all three today: each production stage sets
  `USER nonroot`, no `FROM` uses `:latest` and none uses `ADD`.

> **Deleted, do not use:** `test:auth-security`, `test:api-security`,
> `test:injection-security`, `test:infrastructure-security`,
> `test:security-comprehensive`. They were the only invokers of the vacuous
> `security/tests` suite and exited 0 without running it. See SMELL-83.

## 🛡️ Security Test Categories

> **These four sections describe the `security/tests` suite, which does not
> run.** Read them as the suite's stated intent — a specification of what a
> rewrite would need to cover — not as coverage the repo has. See the status
> banner at the top and SMELL-83.

### 1. Authentication Security Tests (`auth-security.test.ts`)

**Purpose**: Validate authentication mechanisms and prevent unauthorized access

**Test Coverage**:

- Password security policy enforcement
- Authentication bypass attempts (SQL injection, timing attacks)
- Account lockout protection and progressive delays
- Session security (JWT validation, session fixation prevention)
- Rate limiting on authentication endpoints
- Password reset security (token security, user enumeration prevention)
- Privilege escalation prevention
- Input validation and sanitization

**Key Tests**:

```typescript
// Example test cases
- Password strength requirements
- SQL injection in login forms
- Timing attack prevention
- Account lockout after failed attempts
- JWT token tampering detection
- Session security validation
```

### 2. API Security Tests (`api-security.injection.test.ts`, `api-security.validation-auth.test.ts`)

**Purpose**: Comprehensive API vulnerability testing and security control validation

**Test Coverage**:

- SQL injection prevention across all endpoints
- NoSQL injection attack prevention
- Cross-Site Scripting (XSS) prevention
- Command injection prevention
- LDAP injection prevention
- XML External Entity (XXE) attack prevention
- JSON injection and prototype pollution prevention
- Server-Side Request Forgery (SSRF) prevention
- Rate limiting and DDoS protection
- Input validation and data type enforcement
- Authorization security (RBAC testing)

**OWASP Top 10 — categories this suite was written to address**:

The ticks this list used to carry asserted verified coverage. They are removed:
the suite has never produced a green assertion against any of these categories,
so a tick here would be a claim no run supports. Treat the list as scope-of-
intent for the SMELL-83 rewrite.

- A01:2021 – Broken Access Control
- A02:2021 – Cryptographic Failures
- A03:2021 – Injection
- A04:2021 – Insecure Design
- A05:2021 – Security Misconfiguration
- A06:2021 – Vulnerable Components
- A07:2021 – Identification and Authentication Failures
- A08:2021 – Software and Data Integrity Failures
- A09:2021 – Security Logging and Monitoring Failures
- A10:2021 – Server-Side Request Forgery

### 3. Injection Attack Tests (`injection-tests.sql-nosql`, `.xss-command`, `.ldap-xml-template-header`)

**Purpose**: Comprehensive testing for all types of injection vulnerabilities

**Test Coverage**:

- **SQL Injection**: Classic, Union-based, Boolean-based, Time-based, Error-based attacks
- **NoSQL Injection**: MongoDB operators, Function injection, Type confusion
- **XSS Prevention**: Reflected, Stored, DOM-based XSS attacks
- **Command Injection**: System command execution, File operations
- **LDAP Injection**: Directory traversal, Filter manipulation
- **XML Injection**: XXE attacks, Billion laughs attack
- **Template Injection**: Various template engines (Jinja2, Twig, etc.)
- **Header Injection**: HTTP response splitting, CRLF injection

**Attack Vectors Tested**:

```typescript
// SQL Injection Examples
"' OR '1'='1";
"'; DROP TABLE users; --";
"' UNION SELECT * FROM sensitive_data --";

// XSS Examples
"<script>alert('xss')</script>";
"javascript:alert('xss')";
"<img src=x onerror=alert('xss')>";

// Command Injection Examples
"; ls -la";
"| whoami";
"$(cat /etc/passwd)";
```

### 4. Infrastructure Security Tests (`infrastructure-security.test.ts`)

**Purpose**: Validate infrastructure security controls and configurations

**Test Coverage**:

- **Security Headers**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- **CORS Security**: Origin validation, Credential handling
- **TLS/Transport Security**: Certificate validation, Cipher strength
- **Information Disclosure**: Error message sanitization, Version hiding
- **File Upload Security**: Type validation, Size limits, Path sanitization
- **Rate Limiting**: Global and endpoint-specific limits
- **Session Security**: Cookie security attributes, Session ID generation
- **Environment Security**: Secret exposure prevention
- **API Versioning**: Version negotiation security
- **Logging Security**: Sensitive data exclusion, Log injection prevention

## 📊 Security Automation Pipeline

### GitHub Actions Workflows

> The list below predates the current workflows and names tools that do not
> run here: SonarQube, Snyk, Grype, a license check and a
> `container-security.yml`. The gates that run are the table in §"Where each
> check runs".

#### 1. Security Testing (`security-testing.yml`)

- **SAST (Static Application Security Testing)**
  - CodeQL analysis for TypeScript/JavaScript
  - SonarQube security analysis
  - ESLint security rule enforcement

- **Dependency Scanning**
  - NPM audit for vulnerable packages
  - Snyk vulnerability scanning
  - License compliance checking

- **Container Security**
  - Trivy vulnerability scanning
  - Grype security analysis
  - Container best practices validation

- **DAST (Dynamic Application Security Testing)**
  - OWASP ZAP full security scan
  - API security testing
  - Authenticated endpoint scanning

- **Authentication, RBAC, input validation and MFA suites** are not a job of this
  workflow: `tests/auth.integration.test.ts`, `tests/rbac.integration.test.ts`,
  `tests/security.live.test.ts` and `tests/mfa.integration.test.ts` run in the
  node:test batches of `apps/api/scripts/run-tests.sh` (the Integration Tests job
  of `ci.yml`), and the rate-limit suites under `apps/api/tests/unit` run in the
  Vitest shards

#### 2. Container Security (`container-security.yml`)

- Multi-service container scanning
- Dockerfile security analysis
- Runtime security validation
- Policy enforcement with OPA

## 🔍 OWASP ZAP Integration

### Configuration

ZAP is configured for comprehensive API security testing with:

- **Authentication**: Automated login via JWT tokens
- **Session Management**: Cookie-based session handling
- **Scan Policies**: Custom policies for social media CMS threats
- **API Scanning**: OpenAPI specification-based testing

### ZAP Authentication Script

```javascript
// Automated authentication for protected endpoints
function authenticate(helper, paramsValues, credentials) {
  // Login with JWT token
  // Store authentication cookies
  // Return authenticated session
}
```

### Custom Scan Policies

- Social media specific security checks
- Provider credential validation
- Post content security scanning
- Project isolation verification
- Rate limiting validation

## 📈 Security Metrics & Reporting

### Vulnerability Severity Levels

| Severity | Max Allowed | Action           |
| -------- | ----------- | ---------------- |
| Critical | 0           | Block deployment |
| High     | 0           | Require approval |
| Medium   | 5           | Warning          |
| Low      | 20          | Informational    |

### Compliance Tracking

- **GDPR**: Data protection and privacy validation
- **CCPA**: Consumer privacy rights verification
- **SOC 2**: Security controls implementation
- **OWASP Top 10**: Comprehensive vulnerability prevention

### Security Reports

Automated reports include:

- Vulnerability summary with CVSS scoring
- Remediation guidance and priority
- Compliance status dashboard
- Trend analysis and metrics
- Executive summary for stakeholders

## 🚀 Integration with CI/CD

### Quality Gates

Security tests are integrated as quality gates:

1. **Pre-commit**: Basic security linting
2. **PR Validation**: Comprehensive security testing
3. **Merge Requirements**: Zero critical vulnerabilities
4. **Deployment Gates**: Security approval required
5. **Post-deployment**: Continuous monitoring

### Failure Handling

- **Critical/High**: Block deployment, notify security team
- **Medium**: Require review and approval
- **Low**: Allow with tracking

### Notifications

- Slack alerts for security failures
- GitHub Security tab integration
- Email notifications for critical issues
- Dashboard updates and metrics

## 🔧 Configuration

### Security Policies (`security-policies.json`)

No script or workflow reads this file. It describes:

- Severity thresholds and actions
- Authentication requirements
- Input validation rules
- API security settings
- Data protection policies
- Compliance requirements

### Environment Variables

Required environment variables:

```bash
# Database
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# Authentication
JWT_SECRET=your-jwt-secret
ENCRYPTION_KEY=your-encryption-key

# External Services
SNYK_TOKEN=your-snyk-token
SONAR_TOKEN=your-sonar-token

# Notifications
SLACK_WEBHOOK_SECURITY=your-slack-webhook
```

## 🧪 Running Tests Locally

### Setup

```bash
# Install dependencies
pnpm install

# Start required services
pnpm db:up

# Run database migrations
pnpm db:migrate
```

### Individual Test Execution

Run each suite from `apps/api` with the root `.env.test` exported. The auth,
RBAC and MFA suites need the test database only; the security suite also needs
the API running (`pnpm --filter @apps/api dev:test`).

```bash
# Authentication
NODE_ENV=test node --conditions development --import tsx --test --test-force-exit tests/auth.integration.test.ts

# Authorization / RBAC
NODE_ENV=test node --conditions development --import tsx --test --test-force-exit tests/rbac.integration.test.ts

# General security suite
NODE_ENV=test node --conditions development --import tsx --test --test-force-exit tests/security.live.test.ts

# MFA
NODE_ENV=test node --conditions development --import tsx --test --test-force-exit tests/mfa.integration.test.ts

# Rate limiting (the two Vitest unit suites, named by path)
pnpm --filter @apps/api exec vitest run tests/unit/security/httpRateLimitPreHandler.test.ts tests/unit/authRateLimit.test.ts
```

### Debugging Tests

```bash
# Verbose output
NODE_ENV=test DEBUG=* node --conditions development --import tsx --test tests/auth.integration.test.ts

# Coverage report (unit suites; the script is test:unit:coverage, not test:coverage)
pnpm --filter @apps/api test:unit:coverage

# Specific node:test file
cd apps/api && NODE_ENV=test node --conditions development --import tsx --test tests/auth.integration.test.ts
```

> There is deliberately no debug recipe for `security/tests/*` here. Running one
> of those files directly reproduces the 404 bootstrap described in the status
> banner — it skips its way to a useless result rather than telling you
> anything. Start from [`security/tests/README.md`](../../security/tests/README.md).

## 📚 Security Best Practices

### Code Security

1. **Input Validation**: Always validate and sanitize user inputs
2. **Authentication**: Use strong authentication mechanisms
3. **Authorization**: Implement proper access controls
4. **Encryption**: Encrypt sensitive data at rest and in transit
5. **Error Handling**: Don't expose sensitive information in errors

### Infrastructure Security

1. **Container Security**: Use minimal base images, run as non-root
2. **Network Security**: Implement proper network segmentation
3. **Secrets Management**: Use secure secret storage
4. **Monitoring**: Implement comprehensive security monitoring
5. **Updates**: Keep dependencies and systems updated

### API Security

1. **Rate Limiting**: Implement rate limiting on all endpoints
2. **Input Validation**: Validate all inputs with strict schemas
3. **Authentication**: Require authentication for sensitive operations
4. **CORS**: Configure CORS properly for your domains
5. **Headers**: Use security headers to prevent attacks

## 🔄 Continuous Improvement

### Regular Activities

- **Weekly**: Review security scan results
- **Monthly**: Update security policies and thresholds
- **Quarterly**: Conduct security assessment reviews
- **Annually**: Full security architecture review

### Metrics Tracking

- Vulnerability discovery and remediation time
- Security test coverage and effectiveness
- Compliance status and improvements
- Security incident frequency and impact

## 🆘 Incident Response

### Security Alert Handling

1. **Critical**: Immediate response required (15 minutes)
2. **High**: Urgent attention needed (1 hour)
3. **Medium**: Review required (4 hours)
4. **Low**: Track for next cycle (24 hours)

### Escalation Contacts

- Security Team: `#security-alerts`
- Development Team: `#development`
- Management: `#management`

## 📞 Support

For security-related questions or issues:

1. Check this documentation first
2. Review security scan reports
3. Contact the security team via `#security`
4. For critical issues, use emergency contacts

---

**Remember**: Security is everyone's responsibility. When in doubt, err on the side of caution and consult the security team.
