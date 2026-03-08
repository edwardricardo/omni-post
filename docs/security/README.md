# 🛡️ Security Testing Framework

This directory contains comprehensive security testing infrastructure for the Social Media CMS platform, implementing enterprise-grade security automation to achieve zero critical vulnerabilities.

## 📁 Directory Structure

```
security/
├── README.md                          # This documentation
├── config/
│   ├── security-policies.json         # Security policies and thresholds
│   └── scan-configurations.yml        # Scan configuration settings
├── scripts/
│   ├── security-scan.sh              # Main security scanning script
│   ├── vulnerability-report.ts        # Automated vulnerability reporting
│   └── remediation-guide.ts          # Security remediation guidance
├── tests/
│   ├── auth-security.test.ts          # Authentication security tests
│   ├── api-security.test.ts           # API security tests
│   ├── injection-tests.test.ts        # Injection attack prevention tests
│   └── infrastructure-security.test.ts # Infrastructure security tests
├── zap/
│   ├── zap-config.conf               # OWASP ZAP configuration
│   ├── authentication.js             # ZAP authentication script
│   └── scan-policies/                # ZAP scanning policies
└── reports/                          # Generated security reports (gitignored)
```

## 🔧 Quick Start

### Prerequisites

```bash
# Install required tools
npm install -g @lhci/cli
pip install semgrep
docker pull owasp/zap2docker-stable

# Optional but recommended
brew install trivy hadolint
```

### Running Security Tests

```bash
# Run comprehensive security scan
pnpm security:scan

# Run specific security test categories
pnpm test:auth-security              # Authentication security
pnpm test:api-security               # API security tests
pnpm test:injection-security         # Injection attack tests
pnpm test:infrastructure-security    # Infrastructure security

# Run all security tests
pnpm test:security-comprehensive

# Generate vulnerability report
pnpm security:report
```

### GitHub Actions Integration

Security tests run automatically on:

- Every push to main/develop branches
- Pull requests
- Daily scheduled scans (2 AM UTC)
- Manual workflow dispatch

## 🛡️ Security Test Categories

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

### 2. API Security Tests (`api-security.test.ts`)

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

**OWASP Top 10 Coverage**:

- A01:2021 – Broken Access Control ✅
- A02:2021 – Cryptographic Failures ✅
- A03:2021 – Injection ✅
- A04:2021 – Insecure Design ✅
- A05:2021 – Security Misconfiguration ✅
- A06:2021 – Vulnerable Components ✅
- A07:2021 – Identification and Authentication Failures ✅
- A08:2021 – Software and Data Integrity Failures ✅
- A09:2021 – Security Logging and Monitoring Failures ✅
- A10:2021 – Server-Side Request Forgery ✅

### 3. Injection Attack Tests (`injection-tests.test.ts`)

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

- **Custom Security Tests**
  - Authentication security validation
  - RBAC testing
  - Input validation testing

#### 2. Container Security (`container-security.yml`)

- Multi-service container scanning
- Dockerfile security analysis
- Runtime security validation
- Policy enforcement with OPA

### Security Scanning Script

The `security-scan.sh` script provides comprehensive automated security testing:

```bash
# Usage examples
./security/scripts/security-scan.sh                    # Full scan
./security/scripts/security-scan.sh -t dast           # DAST only
./security/scripts/security-scan.sh -s critical       # Critical issues only
./security/scripts/security-scan.sh -v                # Verbose output
```

**Scan Types**:

- `comprehensive`: All security scans (default)
- `sast`: Static analysis only
- `dast`: Dynamic analysis only
- `deps`: Dependency scanning only
- `container`: Container security only

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

Comprehensive security configuration including:

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

```bash
# Authentication security
pnpm test:auth-security

# API security (requires running API server)
pnpm dev:test &
pnpm test:api-security

# Injection tests
pnpm test:injection-security

# Infrastructure security
pnpm test:infrastructure-security
```

### Debugging Tests

```bash
# Verbose output
NODE_ENV=test DEBUG=* pnpm test:auth-security

# Coverage report
NODE_ENV=test pnpm test:coverage

# Specific test file
NODE_ENV=test tsx security/tests/auth-security.test.ts
```

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
