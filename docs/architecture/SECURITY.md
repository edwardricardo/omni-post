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
- **Validation**: Strong password requirements (minimum 8 characters)
- **No Plain Text**: Passwords never stored or logged in plain text
- **Rate Limiting**: Authentication endpoint protection with progressive blocking
- **Secret Management**: Automatic JWT secret generation with environment variable support

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
  ADMIN: [
    /* Selected admin permissions */
  ],
  SUPPORT: [
    /* Limited support permissions */
  ],
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

Comprehensive credential management system:

- **AES-256-GCM Encryption**: Strong encryption for sensitive data with authentication
- **Key Derivation**: Secure key derivation from environment secrets
- **API Key Management**: Cryptographically secure API key generation and rotation
- **Hash Storage**: API keys stored as SHA-256 hashes, never in plaintext
- **Automatic Rotation**: Configurable automatic key rotation with grace periods
- **Redis Caching**: Fast credential validation with encrypted cache

```typescript
// Credential encryption implementation
class CredentialManager {
  encrypt(data: string): { encrypted: string; iv: string; tag: string } {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.secretKey, iv);
    cipher.setAAD(Buffer.from("api-credentials"));
    // ... encryption logic
  }

  async generateApiKey(accountId: string): Promise<{ apiKey: string; keyId: string }> {
    const keyBytes = crypto.randomBytes(32);
    const keyString = keyBytes.toString("base64url");
    const prefix = "sk_" + crypto.randomBytes(4).toString("hex");
    // ... secure key generation
  }
}
```

## API Security

### Rate Limiting ✅ IMPLEMENTED

Advanced sliding window rate limiting with behavioral analysis:

- **Sliding Window Algorithm**: True sliding window implementation using Redis sorted sets
- **Progressive Blocking**: Escalating block durations for repeated violations (5min → 24hr)
- **Multi-Factor Key Generation**: IP + User Agent fingerprinting + User ID
- **Suspicious Activity Detection**: Pattern recognition for potential attacks
- **Configurable Policies**: Different limits for AUTH (5/15min), API (60/min), UPLOAD (10/5min)
- **Comprehensive Headers**: Rate limit information in response headers

```typescript
// Sliding window rate limiter
class SlidingWindowRateLimit {
  async checkRateLimit(req: FastifyRequest): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: number;
    windowInfo: {
      requestsInWindow: number;
      oldestRequest: number;
      newestRequest: number;
    };
  }>;
}

// Rate limit configurations
const SlidingWindowConfigs = {
  AUTH: { windowMs: 15 * 60 * 1000, maxRequests: 5 },
  API: { windowMs: 60 * 1000, maxRequests: 60 },
  UPLOAD: { windowMs: 5 * 60 * 1000, maxRequests: 10 },
};
```

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
      enableProgressiveBlocking?: boolean;
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
- **Multi-Session Support**: Multiple concurrent sessions per user with individual revocation
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

```env
# Authentication & Session Management
JWT_SECRET=<cryptographically-secure-256-bit-key>
JWT_REFRESH_SECRET=<separate-refresh-token-key>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# Multi-Factor Authentication
MFA_SERVICE_NAME=SaaS-Prototype
MFA_ISSUER=YourCompany

# Credential Management
CREDENTIAL_SECRET_KEY=<aes-256-key-for-encryption>
KEY_ROTATION_DAYS=90
MAX_ACTIVE_KEYS=10
ENABLE_AUTO_ROTATION=true

# Rate Limiting (Sliding Window)
RATE_LIMIT_AUTH_REQUESTS=5
RATE_LIMIT_AUTH_WINDOW=900000  # 15 minutes
RATE_LIMIT_API_REQUESTS=60
RATE_LIMIT_API_WINDOW=60000    # 1 minute

# Circuit Breaker Configuration
CIRCUIT_BREAKER_TIMEOUT=10000
CIRCUIT_BREAKER_ERROR_THRESHOLD=50
CIRCUIT_BREAKER_RESET_TIMEOUT=30000

# Database & Redis
DATABASE_URL=<postgresql-connection-with-tls>
REDIS_URL=<redis-connection-for-rate-limiting>

# Security Headers & CORS
CORS_ORIGIN=https://your-domain.com,https://admin.your-domain.com
ALLOWED_HOSTS=your-domain.com,*.your-domain.com
CLIENT_URL=https://app.yourapp.com
ADMIN_URL=https://admin.yourapp.com
ALLOWED_MEDIA_HOSTS=cdn.yourapp.com,media.yourapp.com

# Audit & Monitoring
AUDIT_RETENTION_DAYS=90
LOG_LEVEL=info
ENABLE_METRICS=true
METRICS_PORT=9090
```

## Security Testing & Validation

### Automated Security Testing ✅ IMPLEMENTED

- **Security Unit Tests**: Comprehensive test suite for authentication, authorization, and input validation
- **Integration Testing**: End-to-end security flow testing including MFA and session management
- **Threat Detection Testing**: Validation of security pattern detection and response mechanisms
- **Rate Limiting Tests**: Sliding window algorithm validation and progressive blocking verification
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
2. **Progressive Blocking**: Escalating rate limit enforcement for repeated violations
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
- ✅ Sliding Window Rate Limiting with progressive blocking
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
