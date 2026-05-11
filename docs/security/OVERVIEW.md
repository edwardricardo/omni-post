# Security

Comprehensive security implementation with defense-in-depth strategies.

## Authentication

### JWT-Based Authentication

Dual-token system with session management:

- **Access Tokens**: 15 minutes, contains user claims
- **Refresh Tokens**: 7 days, stored with session metadata
- **Token Rotation**: Automatic rotation on refresh
- **Session Revocation**: Single and bulk termination

```typescript
interface TokenPayload {
  userId: string;
  email: string;
  role: AdminRole;
  sessionId: string;
}
```

### Multi-Factor Authentication (MFA)

TOTP-based MFA with fallback mechanisms:

- **TOTP**: Time-based One-Time Passwords
- **QR Code**: For authenticator app setup
- **Backup Codes**: 8 cryptographically secure recovery codes
- **Setup Verification**: Two-step activation

```typescript
class MfaService {
  async setupMfa(userId: string, email: string): Promise<MfaSetupData>;
  async verifyMfaSetup(userId: string, token: string): Promise<{ backupCodes: string[] }>;
  async verifyMfaToken(userId: string, token: string): Promise<MfaVerificationResult>;
  async disableMfa(userId: string, token: string): Promise<void>;
}
```

### Password Security

- **Hashing**: argon2id (via the `argon2` package)
- **Validation**: Minimum 8 characters
- **Rate Limiting**: Progressive blocking on failures
- **History**: Last 5 passwords stored (hashed)

## Authorization

### Role-Based Access Control (RBAC)

Granular permission-based access control:

**Roles**:

| Role          | Description               |
| ------------- | ------------------------- |
| `SUPER_ADMIN` | All permissions           |
| `ADMIN`       | Administrative operations |
| `MODERATOR`   | Limited moderation        |

**Permission Categories**:

- User Management
- Project Management
- Content Management
- Analytics
- System Administration
- Audit & Compliance
- Billing
- AI Features
- Support

```typescript
enum Permission {
  USER_CREATE = "user:create",
  USER_READ = "user:read",
  USER_UPDATE = "user:update",
  USER_DELETE = "user:delete",
  CONTENT_CREATE = "content:create",
  CONTENT_PUBLISH = "content:publish",
  SYSTEM_CONFIGURE = "system:configure",
  AUDIT_READ = "audit:read",
}
```

### Account Management

- **Lifecycle**: Create, suspend, delete with audit trails
- **Subscription Tiers**: BASIC, PRO, ENTERPRISE
- **Trial Management**: Auto-expiration handling
- **Usage Limits**: Per-tier project quotas

## Input Validation

Multi-layered validation and sanitization:

- **Zod Schemas**: Type-safe validation
- **Security Patterns**: SQL injection, XSS, path traversal detection
- **Context-Aware**: Different rules per input type
- **Length Limits**: Context-specific enforcement

```typescript
const threatPatterns = {
  sqlInjection: /(SELECT|INSERT|UPDATE|DELETE|DROP|UNION)/i,
  xss: /<script[^>]*>.*?<\/script>/gi,
  pathTraversal: /\.\.\//g,
};
```

## API Security

### Rate Limiting

Sliding window algorithm with Redis:

| Endpoint | Limit       | Window     |
| -------- | ----------- | ---------- |
| Auth     | 5 requests  | 15 minutes |
| API      | 60 requests | 1 minute   |
| Upload   | 10 requests | 5 minutes  |

**Features**:

- Progressive blocking (5min to 24hr)
- IP + User Agent fingerprinting
- Suspicious activity detection

### Circuit Breakers

Protection for external API calls:

```typescript
const circuitBreakerConfig = {
  timeout: 10000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
};
```

**Fallback Strategies**:

- Cached responses
- Degraded functionality
- Dead letter queue

### Security Headers

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; script-src 'self'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

## Credential Management

### Encryption

- **Algorithm**: AES-256-GCM
- **Key Derivation**: Secure derivation from environment secrets
- **API Keys**: Cryptographically secure generation
- **Storage**: SHA-256 hashes, never plaintext

```typescript
class CredentialManager {
  encrypt(data: string): { encrypted: string; iv: string; tag: string };
  decrypt(encrypted: string, iv: string, tag: string): string;
  generateApiKey(accountId: string): { apiKey: string; keyId: string };
}
```

## Audit Logging

Comprehensive audit trail:

```typescript
interface AuditLogEntry {
  id: string;
  userId?: string;
  action: string;
  resource?: string;
  resourceId?: string;
  details?: unknown;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  error?: string;
  createdAt: Date;
}

const AuditActions = {
  LOGIN: "LOGIN",
  LOGIN_FAILED: "LOGIN_FAILED",
  MFA_ENABLED: "MFA_ENABLED",
  USER_CREATED: "USER_CREATED",
  ROLE_CHANGED: "ROLE_CHANGED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  SUSPICIOUS_ACTIVITY: "SUSPICIOUS_ACTIVITY",
};
```

## Session Management

- **Database-Backed**: Persistent storage with metadata
- **Multi-Session**: Up to 5 concurrent sessions
- **Tracking**: IP address and user agent monitoring
- **Bulk Revocation**: Admin capability for incidents

## Environment Variables

```env
# Authentication
JWT_ACCESS_SECRET=<256-bit-key>
JWT_REFRESH_SECRET=<256-bit-key>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# MFA
MFA_SERVICE_NAME=OmniPost
MFA_ISSUER=YourCompany

# Credential Management
CREDENTIAL_SECRET_KEY=<aes-256-key>
KEY_ROTATION_DAYS=90

# Rate Limiting
RATE_LIMIT_AUTH_REQUESTS=5
RATE_LIMIT_AUTH_WINDOW=900000
RATE_LIMIT_API_REQUESTS=60
RATE_LIMIT_API_WINDOW=60000

# CORS
CORS_ORIGIN=https://your-domain.com
ALLOWED_HOSTS=your-domain.com

# Audit
AUDIT_RETENTION_DAYS=90
```

## Security Checklist

### Implemented

- [x] JWT authentication with refresh tokens
- [x] Multi-Factor Authentication (TOTP + backup codes)
- [x] Role-Based Access Control (47 permissions)
- [x] Sliding window rate limiting
- [x] Circuit breakers with fallbacks
- [x] Input validation with threat detection
- [x] SQL injection protection (Prisma ORM)
- [x] XSS protection (CSP + sanitization)
- [x] CORS configuration
- [x] Security headers
- [x] Audit logging system
- [x] Session management
- [x] API key management
- [x] Credential encryption (AES-256-GCM)

### Planned

- [ ] Zero Trust Architecture
- [ ] Rule-based anomaly detection
- [ ] Automated threat response
- [ ] Compliance automation
- [ ] Regular penetration testing

---

<!-- markdownlint-disable-next-line MD036 -->

_Last updated: March 2026_
