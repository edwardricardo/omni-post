# Security Architecture

## Overview

This document outlines the comprehensive security measures implemented in the SaaS platform, covering authentication, authorization, data protection, and operational security. The platform implements defense-in-depth strategies with multiple layers of protection.

## Authentication System

### JWT-Based Authentication ✅ IMPLEMENTED

The platform uses a dual-token JWT authentication system with comprehensive session management:

- **Access Tokens**: Short-lived JWT tokens (15 minutes) containing user claims
- **Refresh Tokens**: Long-lived secure tokens (7 days) stored with session metadata
- **Session Management**: Database-backed sessions with IP and user agent tracking
- **Token Rotation**: Automatic refresh token rotation on each use
- **Session Revocation**: Support for single and bulk session termination

```typescript
// Token payload structure
interface TokenPayload {
  userId: string;
  email: string;
  role: AdminRole;
  sessionId: string;
}

// Session security tracking
interface AdminSession {
  id: string;
  userId: string;
  refreshToken: string;
  ipAddress?: string;
  userAgent?: string;
  isActive: boolean;
  expiresAt: Date;
  revokedAt?: Date;
}
```

### Multi-Factor Authentication (MFA) ✅ IMPLEMENTED

Complete TOTP-based MFA system with fallback mechanisms:

- **TOTP Implementation**: Time-based One-Time Passwords using `otplib` library
- **QR Code Generation**: Secure QR code generation for authenticator app setup
- **Backup Codes**: 8 cryptographically secure recovery codes (SHA-256 hashed)
- **Setup Verification**: Two-step MFA activation requiring token verification
- **Backup Code Usage**: Single-use codes with automatic removal after use
- **MFA Disable**: Secure MFA deactivation requiring valid token proof

```typescript
// MFA service capabilities
class MfaService {
  async setupMfa(userId: string, userEmail: string): Promise<MfaSetupData>;
  async verifyMfaSetup(userId: string, token: string): Promise<{ backupCodes: string[] }>;
  async verifyMfaToken(userId: string, token: string): Promise<MfaVerificationResult>;
  async disableMfa(userId: string, token: string): Promise<void>;
  async regenerateBackupCodes(userId: string, token: string): Promise<string[]>;
}
```

### Password Security ✅ IMPLEMENTED

Robust password protection and validation:

- **Hashing**: argon2 for optimal security/performance balance
- **Validation (admin)**: 12 to 128 characters with a lowercase letter, an uppercase
  letter, a digit and a special character (`passwordSchema` and `validatePasswordStrength`
  in `apps/api/src/admin/auth/adminAuthSchemas.ts`, `passwordPolicy` in `adminAuthConfig.ts`)
- **Validation (customer)**: 8 to 128 characters, with no character-class rule, on
  registration and password reset (`RegisterSchema` and `ResetPasswordSchema` in
  `apps/api/src/auth/customerAuthRoutes.ts`)
- **Reuse prevention (admin)**: the last 5 password hashes are kept in
  `passwordHistory`, and a new admin password matching any of them is refused
  (`preventPasswordReuse` in `apps/api/src/admin/auth/adminAuthConfig.ts`)
- **No Plain Text**: Passwords never stored or logged in plain text
- **Login throttling**: the `AUTH` rate-limit preset on the credential endpoints (see
  Rate Limiting under API Security), plus exponential backoff, account lockout and
  IP blocking on repeated login failures through `BruteForceProtectionPort`
- **Secret Management**: every JWT secret is a required environment variable, validated at
  boot; nothing generates one (see Environment Variables below)

## Authorization & Access Control

### Role-Based Access Control (RBAC) ✅ IMPLEMENTED

Comprehensive permission-based access control system:

- **Granular Permissions**: 47 fine-grained permissions across 9 categories
- **Role Hierarchy**: SUPER_ADMIN → ADMIN → SUPPORT with permission inheritance
- **Permission Categories**: User Management, Project Management, Content Management, Analytics, System Administration, Audit & Compliance, Billing, AI Features, Support
- **Dynamic Permission Checking**: Runtime permission validation with caching
- **Role Modification**: Secure role updates with audit logging and hierarchy validation

```typescript
// Permission categories and examples
enum Permission {
  // User management
  USER_CREATE = "user:create",
  USER_READ = "user:read",
  USER_UPDATE = "user:update",
  USER_DELETE = "user:delete",

  // Content management
  CONTENT_CREATE = "content:create",
  CONTENT_PUBLISH = "content:publish",

  // System administration
  SYSTEM_CONFIGURE = "system:configure",
  AUDIT_READ = "audit:read",
}

// Role permission mappings
const RolePermissions: Record<string, Permission[]> = {
  SUPER_ADMIN: [...Object.values(Permission)], // All permissions
  ADMIN: [/* Selected admin permissions */],
  SUPPORT: [/* Limited support permissions */],
};
```

### Account Management ✅ IMPLEMENTED

- **Account Lifecycle**: Create, suspend, delete with comprehensive audit trails
- **Subscription Tiers**: BASIC, PRO, ENTERPRISE with feature limitations
- **Trial Management**: Secure trial period handling with auto-expiration
- **Usage Limits**: Project quotas enforced per subscription tier
- **Permission Enforcement**: Real-time permission validation across all endpoints

## Data Protection

### Input Validation ✅ IMPLEMENTED

Multi-layered input validation and sanitization system:

- **Security Pattern Detection**: Real-time scanning for SQL injection, XSS, path traversal, and command injection
- **Zod Schema Integration**: Enhanced Zod schemas with security validation layer
- **Context-Aware Validation**: Different validation rules based on input context (email, name, body, URL)
- **Length Limits**: Context-specific maximum length enforcement
- **Character Filtering**: Control character and null byte detection
- **Threat Metrics**: Security threat detection with Prometheus metrics

```typescript
// Security threat patterns
class SecurityValidator {
  private static readonly SQL_INJECTION_PATTERNS = [
    /(\\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\\b)/i,
    /(-{2}|\\/\\*|\\*\\/)/,
    /(\\b(OR|AND)\\s+\\d+\\s*=\\s*\\d+)/i
  ];

  private static readonly XSS_PATTERNS = [
    /<script[^>]*>.*?<\\/script>/gi,
    /javascript:/gi,
    /on\\w+\\s*=/gi
  ];
}

// Enhanced schemas with security validation
const SecureSchemas = {
  userEmail: z.string().email().max(320).transform(validateSecurity),
  postBody: z.string().min(1).max(10000).transform(validateSecurity),
  url: z.string().url().max(2048).transform(validateProtocol)
};
```

### Database Security ✅ IMPLEMENTED

- **Prisma ORM**: Type-safe database operations preventing SQL injection
- **Connection Security**: Encrypted PostgreSQL connections with TLS
- **Data Integrity**: Foreign key constraints and comprehensive data validation
- **Query Parameterization**: All queries properly parameterized through Prisma
- **Audit Logging**: Comprehensive activity logs for all account lifecycle events

### Credential Encryption and Storage ✅ IMPLEMENTED

Two live paths: one encrypts the secrets the platform stores, the other issues API keys.

- **AES-256-GCM encryption** (`apps/api/src/security/EncryptionService.ts`): a 256-bit
  key read base64-encoded from `PLATFORM_ENCRYPTION_KEY`, used as is (no derivation) and
  never stored in the database; a fresh 12-byte IV and a 16-byte auth tag per value.
- **Key versioning**: every envelope carries the `keyVersion` that wrote it, and prior
  keys (`PLATFORM_ENCRYPTION_KEY_V1` to `_V3`) keep decrypting the envelopes they wrote
  after the active key changes.
- **Context binding and audit**: every call passes an `EncryptionContext` (`fieldName`,
  `recordId`) that is bound as AAD, so a ciphertext copied to another field or row does
  not decrypt, and the API audits every decrypt attempt as `CREDENTIAL_DECRYPTED`.
  `Channel.credentials` goes through `ChannelCredentialsCrypto.ts`, and the workers
  decrypt it with the shared kernel's cipher (`packages/shared/src/channelCredentialsCrypto.ts`).
- **API keys** (`packages/core/apiKeys`): `op_{prefix}_{secret}` from `randomBytes`,
  hashed with Argon2id (`Argon2PasswordHasher`) and shown in plaintext once. Rotation
  issues a new key and invalidates the old one immediately. A `rotationSchedule` is
  stored but nothing applies it, and no request path authenticates with these keys yet:
  PREG-1 in `docs/product/MASTER_PLAN.md` §5.13 decides the public API's credential.

```typescript
// The port the application layer depends on
// (packages/core/domain/src/repositories/EncryptionPort.ts).
interface EncryptionPort {
  encrypt(plaintext: string, context: EncryptionContext): EncryptedValue;
  decrypt(encrypted: EncryptedValue, context: EncryptionContext): string;
}
```

## API Security

### Rate Limiting ✅ IMPLEMENTED

Token-bucket rate limiting through the technology-free `RateLimiterPort`,
backed by an atomic Lua token bucket over Redis (cross-pod). Enforced as a
global Fastify preHandler with per-path rules; the same port + algorithm also
throttles outbound AI provider calls (one rate-limiting canon, two instances).

- **Token-bucket algorithm**: atomic refill-and-consume in a single Redis `EVAL`
  (no read-modify-write race across pods).
- **Per-path rules**: the presets of `RateLimitConfigs` in
  `apps/api/src/security/httpRateLimitPreHandler.ts`, chosen by the first rule whose
  path prefixes the matched route pattern; capacity + window passed per call from
  that rule.

  | Preset               | Limit        | Window     | Route patterns it governs                                                                                                  |
  | -------------------- | ------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
  | `STANDARD` (default) | 100 requests | 1 minute   | every route no rule matches                                                                                                |
  | `HEALTH`             | 120 requests | 1 minute   | `/health*`                                                                                                                 |
  | `AUTH`               | 5 requests   | 15 minutes | `/auth/login*`, `/auth/refresh*`, `/auth/customer/login*` (MFA step 2 included), `/auth/customer/refresh*`                 |
  | `CRITICAL_EXPENSIVE` | 5 requests   | 1 minute   | `/analytics/project/*`, `/analytics/cross-platform*`, `/analytics/roi*`, `/admin/accounts/export*`, `/admin/audit/export*` |
  | `HEAVY_EXPENSIVE`    | 10 requests  | 1 minute   | `/engagement/geographic*`, `/threads/:threadId/performance*`, every other `/admin/accounts/*`                              |
  | `REDIRECT`           | 60 requests  | 1 minute   | `/r/:shortCode`, through its own route preHandler: one per-IP bucket for every short code                                  |

- **Per-IP + per-resource-path bucket** (the matched route pattern with its parsed
  parameters, never the raw URL, so a query string or URL variant does not mint a
  fresh bucket); `X-RateLimit-Remaining` / `X-RateLimit-Reset` headers +
  `Retry-After` on 429.
- **Fail-open**: a limiter outage allows traffic rather than hard-blocking.

```typescript
// Technology-free port; the Fastify preHandler adapts it to requests.
interface RateLimiterPort {
  tryConsume(
    key: string,
    opts?: { cost?: number; capacity?: number; refillWindowMs?: number }
  ): Promise<{ allowed: boolean; remaining: number; resetAtMs: number; retryAfterMs?: number }>;
}
```

> Auth-abuse defence (account lockout, IP block, CAPTCHA, exponential backoff
> per NIST SP 800-63B-4) is handled separately by the `BruteForceProtectionPort`
> on the login flows — not by this throttle. Progressive blocking and
> suspicious-pattern detection live there, by design.

### Circuit Breakers ✅ IMPLEMENTED

Robust circuit breaker pattern for external API protection:

- **Opossum Integration**: Production-grade circuit breaker implementation
- **Adaptive Thresholds**: 50% error threshold with 30-second reset timeout
- **Fallback Strategies**: Cached responses and degraded functionality
- **Retry Logic**: Exponential backoff with jitter (1s → 30s max)
- **Dead Letter Queue**: Failed operations queued for later retry
- **Comprehensive Metrics**: Circuit state, request duration, and failure tracking

```typescript
// Circuit breaker with fallback
class ExternalApiCircuitBreaker {
  async call<T>(
    service: string,
    operation: string,
    apiCall: Function,
    args: T[],
    options?: {
      cacheEnabled?: boolean;
      fallback?: Function;
    }
  ): Promise<T>;
}
```

### Request Validation ✅ IMPLEMENTED

- **Multi-Layer Validation**: Zod schemas + security threat detection + business rules
- **Content-Type Validation**: Strict content-type checking and enforcement
- **Payload Size Limits**: Configurable maximum request body size enforcement
- **Parameter Validation**: Query, path, and body parameter validation with security checks
- **Malicious Pattern Detection**: Real-time scanning for attack patterns in URLs and headers

### Error Handling ✅ IMPLEMENTED

- **Secure Error Messages**: No sensitive data exposure with sanitized error responses
- **Structured Logging**: Comprehensive error logging with correlation IDs
- **Error Classification**: Proper HTTP status codes and detailed error categorization
- **Result Pattern**: Consistent error handling with typed Result<T, E> pattern
- **Security Incident Logging**: Automatic logging of security-related errors and threats

## Infrastructure Security

### Security Headers ✅ IMPLEMENTED

Comprehensive security header management with configurable policies:

- **Content Security Policy**: Configurable CSP with environment-specific directives
- **HSTS**: HTTP Strict Transport Security with subdomain inclusion and preload
- **CORS**: Advanced CORS handling with origin validation and wildcard subdomain support
- **Frame Protection**: X-Frame-Options and frame-ancestors CSP directive
- **Additional Headers**: X-Content-Type-Options, X-Download-Options, Cross-Origin policies

```typescript
// Security manager with configurable policies
class SecurityManager {
  private config: SecurityConfig = {
    contentSecurityPolicy: {
      enabled: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "https:"],
        "connect-src": ["'self'", "https:", "wss:", "ws:"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        "upgrade-insecure-requests": [],
      },
    },
    cors: {
      allowedOrigins: ["http://localhost:3100", "http://localhost:3200", "http://localhost:3000"],
      allowedMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
      allowCredentials: true,
      maxAge: 86400,
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    permissionsPolicy: {
      geolocation: ["self"],
      microphone: ["none"],
      camera: ["none"],
      payment: ["self"],
    },
  };

  // Request validation for security threats
  validateRequest(request: FastifyRequest): {
    isValid: boolean;
    violations: string[];
  } {
    // Detects suspicious user agents, oversized headers, malicious URL patterns
  }
}
```

### Container Security 📋 PLANNED

- **Docker Security**: Secure container configuration
- **Image Scanning**: Vulnerability scanning of container images
- **Runtime Security**: Container runtime protection
- **Secrets in Containers**: Secure secret injection methods

### Deployment Security 📋 PLANNED

- **Environment Separation**: Clear separation between dev, staging, production
- **Secret Rotation**: Regular rotation of cryptographic keys and secrets
- **Update Management**: Regular security updates and patch management
- **Backup Security**: Encrypted backups with secure access controls

## Operational Security

### Audit Logging System ✅ IMPLEMENTED

Comprehensive audit trail with advanced filtering and analytics:

- **Structured Audit Logs**: Complete audit trail for all security-sensitive operations
- **Event Classification**: 25+ predefined audit actions across 7 resource categories
- **Advanced Filtering**: Multi-parameter filtering with date ranges and success/failure status
- **Statistical Analysis**: Top actions, resources, and users with aggregated metrics
- **Data Retention**: Configurable audit log retention with automated cleanup
- **Performance Optimized**: Async logging with proper error handling

```typescript
// Audit service with comprehensive logging
class AuditService {
  async log(params: {
    userId?: string;
    action: string;
    resource?: string;
    resourceId?: string;
    details?: any;
    ipAddress?: string;
    userAgent?: string;
    success?: boolean;
    error?: string;
  }): Promise<Result<AuditLogEntry, "DATABASE_ERROR">>;

  async getStats(): Promise<{
    total: number;
    successful: number;
    failed: number;
    topActions: Array<{ action: string; count: number }>;
    topResources: Array<{ resource: string; count: number }>;
    topUsers: Array<{ user: string; email: string; count: number }>;
  }>;
}

// Audit action constants
const AuditActions = {
  // Authentication
  LOGIN: "LOGIN",
  LOGIN_FAILED: "LOGIN_FAILED",
  MFA_ENABLED: "MFA_ENABLED",

  // User Management
  USER_CREATED: "USER_CREATED",
  ROLE_CHANGED: "ROLE_CHANGED",

  // Security
  PERMISSION_DENIED: "PERMISSION_DENIED",
  SUSPICIOUS_ACTIVITY: "SUSPICIOUS_ACTIVITY",
};
```

### Session Management ✅ IMPLEMENTED

- **Database-Backed Sessions**: Persistent session storage with metadata tracking
- **Session Security**: Secure session tokens with proper expiration and rotation
- **Multi-Session Support**: Multiple concurrent sessions per user with individual revocation,
  capped: an admin login at `AdminUser.maxConcurrentSessions` (default 3) revokes the least
  recently active sessions as `MAX_SESSIONS_EXCEEDED` (`SessionManager.enforceMaxSessions`),
  and a login through `apps/api/src/auth/authServiceCore.ts` with 5 active sessions is refused
  as `TOO_MANY_SESSIONS` (counted in Redis, so the cap applies only when Redis is configured)
- **Session Monitoring**: IP address and user agent tracking for suspicious activity
- **Bulk Revocation**: Admin capability to revoke all sessions for security incidents
- **Session Analytics**: Active session tracking and usage patterns

### Monitoring & Metrics ✅ IMPLEMENTED

- **Prometheus Integration**: Comprehensive metrics collection for security events
- **Performance Monitoring**: Response times, request rates, and error tracking
- **Security Metrics**: Rate limiting violations, authentication failures, threat detection
- **Circuit Breaker Monitoring**: External API health and failure tracking
- **Correlation IDs**: Request tracing across the entire system for debugging

### Data Privacy ✅ IMPLEMENTED

- **Data Minimization**: Only collect and store necessary data with explicit purpose
- **Sensitive Data Handling**: Proper encryption and access controls for PII
- **Audit Trail Privacy**: Comprehensive logging while protecting sensitive information
- **Data Retention**: Automated cleanup with configurable retention periods (90 days default)
- **GDPR Considerations**: Privacy by design with data subject rights support

## Security Configuration

### Environment Variables

Every variable is declared and validated once, in the typed env module
[`apps/api/src/config/env.ts`](../../apps/api/src/config/env.ts); the API refuses to boot when a
required one is missing or malformed, and no secret has a fallback. The rules for reading and
adding a variable are in
[SECURITY_CANON.md §Secrets and Environment](../security/SECURITY_CANON.md#secrets-and-environment).
The security-relevant names it declares:

| Concern                     | Variables                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Token signing (required)    | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CUSTOMER_JWT_SECRET`, `ADMIN_JWT_ACCESS_SECRET`, `ADMIN_JWT_REFRESH_SECRET`                                                                                                                                                        |
| Cookie signing (required)   | `COOKIE_SECRET`                                                                                                                                                                                                                                                                |
| Encryption keys             | `PLATFORM_ENCRYPTION_KEY`, `OAUTH_ENCRYPTION_KEY`, `DELETION_NAME_DIGEST_KEY_RING` (required); `PLATFORM_ENCRYPTION_KEY_VERSION` (default 1) and `PLATFORM_ENCRYPTION_KEY_V1` to `_V3` (optional prior keys), spread in from `packages/shared/src/platformEncryptionKeyEnv.ts` |
| Data stores (required)      | `DATABASE_URL`, `REDIS_URL` (the rate limiter, the brute-force counters and the cache run on Redis)                                                                                                                                                                            |
| Client-IP trust             | `TRUSTED_PROXY_MODE`, `TRUSTED_PROXY_RANGES` (SECURITY_CANON.md, Rate Limiting)                                                                                                                                                                                                |
| Frontends and media origins | `ADMIN_URL`, `CLIENT_URL`, `ALLOWED_MEDIA_HOSTS`                                                                                                                                                                                                                               |
| Logging and metrics         | `LOG_LEVEL`, `METRICS_PORT`                                                                                                                                                                                                                                                    |

## Security Testing & Validation

### Automated Security Testing ✅ IMPLEMENTED

- **Security Unit Tests**: Comprehensive test suite for authentication, authorization, and input validation
- **Integration Testing**: End-to-end security flow testing including MFA and session management
- **Threat Detection Testing**: Validation of security pattern detection and response mechanisms
- **Rate Limiting Tests**: token-bucket behaviour, the preset each route gets and the
  coverage of every rule over the registered routes (`apps/api/tests/unit/security/`), and
  login backoff and lockout (`RedisBruteForceAdapter.test.ts`)
- **Circuit Breaker Testing**: External API failure simulation and fallback mechanism validation

### Security Monitoring Metrics

```typescript
// Key security metrics tracked
interface SecurityMetrics {
  // Authentication & Authorization
  authenticationAttempts: Counter;
  authenticationFailures: Counter;
  mfaVerifications: Counter;
  sessionCreations: Counter;

  // Rate Limiting & Threat Detection
  rateLimitBlocked: Counter;
  securityThreats: Counter;
  suspiciousActivity: Counter;

  // Input Validation
  inputValidationErrors: Counter;
  inputValidationDuration: Histogram;

  // Circuit Breaker
  circuitBreakerStateChanges: Counter;
  circuitBreakerFallbacks: Counter;
  externalApiFailures: Counter;
}
```

## Security Incident Response

### Automated Threat Response ✅ IMPLEMENTED

1. **Real-time Detection**: Automatic security threat detection in input validation
2. **Login Throttling**: exponential backoff, account lockout and IP blocking on repeated login
   failures (`BruteForceProtectionPort`); the HTTP rate limiter applies a fixed preset and does
   not escalate
3. **Session Revocation**: Immediate session termination for compromised accounts
4. **Audit Logging**: Comprehensive security event logging for forensic analysis
5. **Alert Generation**: Prometheus metrics triggering monitoring alerts

### Incident Classification

1. **Critical**: Authentication bypass, privilege escalation, data breach
2. **High**: Unauthorized access, MFA bypass, session hijacking
3. **Medium**: Rate limit violations, input validation failures, suspicious patterns
4. **Low**: Authentication failures, expired tokens, configuration issues

## Security Roadmap

### Current Implementation Status ✅

- ✅ JWT Authentication with refresh token rotation
- ✅ Multi-Factor Authentication (TOTP + backup codes)
- ✅ Role-Based Access Control (47 permissions, 3 roles)
- ✅ Token-bucket rate limiting over Redis, plus login backoff and lockout
- ✅ Circuit Breakers with fallback strategies
- ✅ Advanced Input Validation with threat detection
- ✅ SQL injection protection via Prisma ORM
- ✅ XSS protection with CSP and input sanitization
- ✅ CORS configuration with origin validation
- ✅ Comprehensive security headers
- ✅ Complete audit logging system
- ✅ Session management with tracking
- ✅ API key management with encryption
- ✅ Credential encryption (AES-256-GCM)

### Future Enhancements 📋 PLANNED

- **Zero Trust Architecture**: Implementation of zero trust principles
- **Advanced Threat Detection**: Rule-based anomaly detection for user behavior patterns
- **Security Automation**: Automated threat response and remediation
- **Compliance Automation**: Automated compliance checking and reporting
- **Penetration Testing**: Regular automated security assessments

## Security Contact

### Reporting Security Issues

- **Internal**: Report to development team immediately
- **External**: Security contact for responsible disclosure
- **Process**: Defined process for security vulnerability reporting
- **Timeline**: Commitment to security issue response times

This security architecture provides enterprise-grade protection for the SaaS platform with defense-in-depth strategies, comprehensive monitoring, and automated threat response. The implementation balances security, usability, and performance while maintaining auditability and compliance readiness.
