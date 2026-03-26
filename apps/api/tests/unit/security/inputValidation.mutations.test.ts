/**
 * @file inputValidation.mutations.test.ts
 * @description Mutation-killing tests for SecurityValidator, createSecureSchema, and SecureSchemas.
 *              Each test targets a specific mutant survivor from Stryker analysis.
 * @layer testing
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  SecurityValidator,
  SecureSchemas,
  createSecureSchema,
} from "../../../src/security/inputValidation.js";
import { z } from "zod";

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// SQL_INJECTION_PATTERNS — individual pattern coverage
// ============================================================================

describe("SecurityValidator.validateString — SQL injection patterns individually", () => {
  it("detects SELECT keyword", () => {
    const result = SecurityValidator.validateString("SELECT id FROM users", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects INSERT keyword", () => {
    const result = SecurityValidator.validateString("INSERT INTO users VALUES(1)", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects UPDATE keyword", () => {
    const result = SecurityValidator.validateString("UPDATE users SET name=x", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects DELETE keyword", () => {
    const result = SecurityValidator.validateString("DELETE FROM users", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects DROP keyword", () => {
    const result = SecurityValidator.validateString("DROP database prod", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects CREATE keyword", () => {
    const result = SecurityValidator.validateString("CREATE TABLE hack", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects ALTER keyword", () => {
    const result = SecurityValidator.validateString("ALTER TABLE users ADD col", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects EXEC keyword", () => {
    const result = SecurityValidator.validateString("EXEC sp_configure", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects UNION keyword", () => {
    const result = SecurityValidator.validateString("1 UNION ALL", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects SCRIPT keyword via SQL pattern", () => {
    const result = SecurityValidator.validateString("SCRIPT injection", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects double dash comment --", () => {
    const result = SecurityValidator.validateString("admin--", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects block comment open /*", () => {
    const result = SecurityValidator.validateString("test /* comment", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects block comment close */", () => {
    const result = SecurityValidator.validateString("comment */ end", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects OR 1=1 pattern", () => {
    const result = SecurityValidator.validateString("x OR 1=1", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects AND 1=1 pattern", () => {
    const result = SecurityValidator.validateString("x AND 1=1", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects single quote character", () => {
    const result = SecurityValidator.validateString("it's a test", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects double quote character", () => {
    const result = SecurityValidator.validateString('say "hello"', "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects semicolon character", () => {
    const result = SecurityValidator.validateString("test; DROP", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects xp_ prefix (SQL Server)", () => {
    const result = SecurityValidator.validateString("xp_cmdshell", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects DROP TABLE pattern", () => {
    const result = SecurityValidator.validateString("DROP TABLE users", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects ; DROP pattern", () => {
    const result = SecurityValidator.validateString(";  DROP something", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects ' ; DROP pattern", () => {
    const result = SecurityValidator.validateString("' ; DROP x", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });

  it("detects ' OR 'x'='x pattern", () => {
    const result = SecurityValidator.validateString("' OR 'a'='a", "default");
    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("SQL_INJECTION");
  });
});

// ============================================================================
// XSS_PATTERNS — individual pattern coverage
// ============================================================================

describe("SecurityValidator.validateString — XSS patterns individually", () => {
  it("detects <script>...</script> full tag", () => {
    const result = SecurityValidator.validateString("<script>x</script>", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects <script> open tag alone", () => {
    const result = SecurityValidator.validateString("<script>", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects </script> close tag alone", () => {
    const result = SecurityValidator.validateString("</script>", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects <iframe> tag", () => {
    const result = SecurityValidator.validateString("<iframe src=x></iframe>", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects <object> tag", () => {
    const result = SecurityValidator.validateString("<object data=x></object>", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects <embed> tag", () => {
    const result = SecurityValidator.validateString("<embed src=x>", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects <link> tag", () => {
    const result = SecurityValidator.validateString("<link rel=stylesheet>", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects javascript: protocol", () => {
    const result = SecurityValidator.validateString("javascript:void(0)", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects vbscript: protocol", () => {
    const result = SecurityValidator.validateString("vbscript:msgbox", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects onload= event handler", () => {
    const result = SecurityValidator.validateString("onload=doStuff", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects onclick= event handler", () => {
    const result = SecurityValidator.validateString("onclick=doStuff", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects onerror= event handler", () => {
    const result = SecurityValidator.validateString("onerror=doStuff", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects onmouseover= event handler", () => {
    const result = SecurityValidator.validateString("onmouseover=doStuff", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects onfocus= event handler", () => {
    const result = SecurityValidator.validateString("onfocus=doStuff", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects onblur= event handler", () => {
    const result = SecurityValidator.validateString("onblur=doStuff", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects alert( pattern", () => {
    const result = SecurityValidator.validateString("alert(1)", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects generic <tag onXxx= pattern", () => {
    const result = SecurityValidator.validateString("<div onkeyup=x>", "default");
    expect(result.threats).toContain("XSS");
  });

  it("detects case-insensitive XSS patterns", () => {
    const result = SecurityValidator.validateString("JAVASCRIPT:void(0)", "default");
    expect(result.threats).toContain("XSS");
  });
});

// ============================================================================
// PATH_TRAVERSAL_PATTERNS — individual pattern coverage
// ============================================================================

describe("SecurityValidator.validateString — path traversal patterns individually", () => {
  it("detects simple ..", () => {
    const result = SecurityValidator.validateString("..", "default");
    expect(result.threats).toContain("PATH_TRAVERSAL");
  });

  it("detects /../ pattern", () => {
    const result = SecurityValidator.validateString("/foo/../bar", "default");
    expect(result.threats).toContain("PATH_TRAVERSAL");
  });

  it("detects backslash ..\\", () => {
    const result = SecurityValidator.validateString("foo\\..\\bar", "default");
    expect(result.threats).toContain("PATH_TRAVERSAL");
  });

  it("detects URL-encoded %2e%2e", () => {
    const result = SecurityValidator.validateString("%2e%2e", "default");
    expect(result.threats).toContain("PATH_TRAVERSAL");
  });

  it("detects double URL-encoded %252e%252e", () => {
    const result = SecurityValidator.validateString("%252e%252e", "default");
    expect(result.threats).toContain("PATH_TRAVERSAL");
  });

  it("detects ..%2f mixed encoding", () => {
    const result = SecurityValidator.validateString("..%2f", "default");
    expect(result.threats).toContain("PATH_TRAVERSAL");
  });

  it("detects ..%5c mixed encoding", () => {
    const result = SecurityValidator.validateString("..%5c", "default");
    expect(result.threats).toContain("PATH_TRAVERSAL");
  });

  it("detects ../etc/passwd", () => {
    const result = SecurityValidator.validateString("../etc/passwd", "default");
    expect(result.threats).toContain("PATH_TRAVERSAL");
  });

  it("detects ..\\etc\\passwd", () => {
    const result = SecurityValidator.validateString("..\\etc\\passwd", "default");
    expect(result.threats).toContain("PATH_TRAVERSAL");
  });

  it("detects ../ followed by anything", () => {
    const result = SecurityValidator.validateString("../anything", "default");
    expect(result.threats).toContain("PATH_TRAVERSAL");
  });
});

// ============================================================================
// COMMAND_INJECTION_PATTERNS — individual pattern coverage
// ============================================================================

describe("SecurityValidator.validateString — command injection patterns individually", () => {
  it("detects semicolon", () => {
    const r = SecurityValidator.validateString("x;y", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects ampersand &", () => {
    const r = SecurityValidator.validateString("x&y", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects pipe |", () => {
    const r = SecurityValidator.validateString("x|y", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects backtick", () => {
    const r = SecurityValidator.validateString("x`y`z", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects dollar-paren $()", () => {
    const r = SecurityValidator.validateString("$(cmd)", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects parentheses", () => {
    const r = SecurityValidator.validateString("(cmd)", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects curly braces", () => {
    const r = SecurityValidator.validateString("{cmd}", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects square brackets", () => {
    const r = SecurityValidator.validateString("[cmd]", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects cat command", () => {
    const r = SecurityValidator.validateString("cat file", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects ls command", () => {
    const r = SecurityValidator.validateString("ls dir", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects pwd command", () => {
    const r = SecurityValidator.validateString("pwd here", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects whoami command", () => {
    const r = SecurityValidator.validateString("whoami now", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects id command", () => {
    const r = SecurityValidator.validateString("id user", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects uname command", () => {
    const r = SecurityValidator.validateString("uname host", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects wget command", () => {
    const r = SecurityValidator.validateString("wget url", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects curl command", () => {
    const r = SecurityValidator.validateString("curl url", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects nc command", () => {
    const r = SecurityValidator.validateString("nc host", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects telnet command", () => {
    const r = SecurityValidator.validateString("telnet host", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects ssh command", () => {
    const r = SecurityValidator.validateString("ssh host", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects redirect operators > >>", () => {
    const r = SecurityValidator.validateString("x>y", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects append redirect >>", () => {
    const r = SecurityValidator.validateString("x>>y", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects input redirect <", () => {
    const r = SecurityValidator.validateString("x<y", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects '; ls ' pattern", () => {
    const r = SecurityValidator.validateString("; ls /", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects 'test; ls' pattern", () => {
    const r = SecurityValidator.validateString("test; ls", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects ls -la pattern", () => {
    const r = SecurityValidator.validateString("ls -la", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects ps command", () => {
    const r = SecurityValidator.validateString("ps aux", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects netstat command", () => {
    const r = SecurityValidator.validateString("netstat ports", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects ifconfig command", () => {
    const r = SecurityValidator.validateString("ifconfig eth0", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects ncat command", () => {
    const r = SecurityValidator.validateString("ncat host", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects scp command", () => {
    const r = SecurityValidator.validateString("scp file host", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });

  it("detects rsync command", () => {
    const r = SecurityValidator.validateString("rsync source dest", "default");
    expect(r.threats).toContain("COMMAND_INJECTION");
  });
});

// ============================================================================
// Length validation — boundary values per context
// ============================================================================

describe("SecurityValidator.validateString — length boundaries", () => {
  it("accepts email at exactly 320 chars", () => {
    const value = "a".repeat(320);
    const result = SecurityValidator.validateString(value, "email");
    expect(result.threats).not.toContain("EXCESSIVE_LENGTH");
  });

  it("rejects email at 321 chars", () => {
    const value = "a".repeat(321);
    const result = SecurityValidator.validateString(value, "email");
    expect(result.threats).toContain("EXCESSIVE_LENGTH");
  });

  it("accepts name at exactly 256 chars", () => {
    const value = "a".repeat(256);
    const result = SecurityValidator.validateString(value, "name");
    expect(result.threats).not.toContain("EXCESSIVE_LENGTH");
  });

  it("rejects name at 257 chars", () => {
    const value = "a".repeat(257);
    const result = SecurityValidator.validateString(value, "name");
    expect(result.threats).toContain("EXCESSIVE_LENGTH");
  });

  it("accepts title at exactly 512 chars", () => {
    const value = "a".repeat(512);
    const result = SecurityValidator.validateString(value, "title");
    expect(result.threats).not.toContain("EXCESSIVE_LENGTH");
  });

  it("rejects title at 513 chars", () => {
    const value = "a".repeat(513);
    const result = SecurityValidator.validateString(value, "title");
    expect(result.threats).toContain("EXCESSIVE_LENGTH");
  });

  it("accepts body at exactly 10000 chars", () => {
    const value = "a".repeat(10000);
    const result = SecurityValidator.validateString(value, "body");
    expect(result.threats).not.toContain("EXCESSIVE_LENGTH");
  });

  it("rejects body at 10001 chars", () => {
    const value = "a".repeat(10001);
    const result = SecurityValidator.validateString(value, "body");
    expect(result.threats).toContain("EXCESSIVE_LENGTH");
  });

  it("accepts url at exactly 2048 chars", () => {
    const value = "a".repeat(2048);
    const result = SecurityValidator.validateString(value, "url");
    expect(result.threats).not.toContain("EXCESSIVE_LENGTH");
  });

  it("rejects url at 2049 chars", () => {
    const value = "a".repeat(2049);
    const result = SecurityValidator.validateString(value, "url");
    expect(result.threats).toContain("EXCESSIVE_LENGTH");
  });

  it("accepts uuid at exactly 36 chars", () => {
    const value = "a".repeat(36);
    const result = SecurityValidator.validateString(value, "uuid");
    expect(result.threats).not.toContain("EXCESSIVE_LENGTH");
  });

  it("rejects uuid at 37 chars", () => {
    const value = "a".repeat(37);
    const result = SecurityValidator.validateString(value, "uuid");
    expect(result.threats).toContain("EXCESSIVE_LENGTH");
  });

  it("accepts channelId at exactly 100 chars", () => {
    const value = "a".repeat(100);
    const result = SecurityValidator.validateString(value, "channelId");
    expect(result.threats).not.toContain("EXCESSIVE_LENGTH");
  });

  it("rejects channelId at 101 chars", () => {
    const value = "a".repeat(101);
    const result = SecurityValidator.validateString(value, "channelId");
    expect(result.threats).toContain("EXCESSIVE_LENGTH");
  });

  it("uses default limit of 1000 for unknown context", () => {
    const atLimit = "a".repeat(1000);
    const overLimit = "a".repeat(1001);
    const r1 = SecurityValidator.validateString(atLimit, "unknownContext");
    const r2 = SecurityValidator.validateString(overLimit, "unknownContext");
    expect(r1.threats).not.toContain("EXCESSIVE_LENGTH");
    expect(r2.threats).toContain("EXCESSIVE_LENGTH");
  });
});

// ============================================================================
// Null byte and control character edge cases
// ============================================================================

describe("SecurityValidator.validateString — null byte and control chars", () => {
  it("detects null byte in middle of string", () => {
    const result = SecurityValidator.validateString("abc\0def", "default");
    expect(result.threats).toContain("NULL_BYTE");
  });

  it("detects null byte at start", () => {
    const result = SecurityValidator.validateString("\0start", "default");
    expect(result.threats).toContain("NULL_BYTE");
  });

  it("detects null byte at end", () => {
    const result = SecurityValidator.validateString("end\0", "default");
    expect(result.threats).toContain("NULL_BYTE");
  });

  it("does NOT detect control characters for body context", () => {
    const result = SecurityValidator.validateString("line\n\ttab", "body");
    expect(result.threats).not.toContain("CONTROL_CHARACTERS");
  });

  it("detects control characters for non-body context like name", () => {
    const result = SecurityValidator.validateString("name\n", "name");
    expect(result.threats).toContain("CONTROL_CHARACTERS");
  });

  it("detects control characters for default context", () => {
    const result = SecurityValidator.validateString("test\t", "default");
    expect(result.threats).toContain("CONTROL_CHARACTERS");
  });

  it("does NOT detect control characters for context containing body substring", () => {
    // context.includes("body") is case-sensitive — "body" must be lowercase
    const result = SecurityValidator.validateString("line\n", "body");
    expect(result.threats).not.toContain("CONTROL_CHARACTERS");
  });

  it("detects DEL character (0x7f)", () => {
    const result = SecurityValidator.validateString("test\x7fdata", "name");
    expect(result.threats).toContain("CONTROL_CHARACTERS");
  });

  it("detects high control character (0x9f)", () => {
    const result = SecurityValidator.validateString("test\x9fdata", "name");
    expect(result.threats).toContain("CONTROL_CHARACTERS");
  });
});

// ============================================================================
// sanitizeString
// ============================================================================

describe("SecurityValidator.sanitizeString — mutation-killing", () => {
  it("removes control char \\x01", () => {
    expect(SecurityValidator.sanitizeString("a\x01b")).toBe("ab");
  });

  it("removes control char \\x1f", () => {
    expect(SecurityValidator.sanitizeString("a\x1fb")).toBe("ab");
  });

  it("removes DEL char \\x7f", () => {
    expect(SecurityValidator.sanitizeString("a\x7fb")).toBe("ab");
  });

  it("removes high control chars \\x80-\\x9f", () => {
    expect(SecurityValidator.sanitizeString("a\x80\x9fb")).toBe("ab");
  });

  it("removes null bytes specifically", () => {
    expect(SecurityValidator.sanitizeString("a\0b\0c")).toBe("abc");
  });

  it("trims leading whitespace", () => {
    expect(SecurityValidator.sanitizeString("  hello")).toBe("hello");
  });

  it("trims trailing whitespace", () => {
    expect(SecurityValidator.sanitizeString("hello  ")).toBe("hello");
  });

  it("returns empty string when input is only control chars", () => {
    expect(SecurityValidator.sanitizeString("\x00\x01\x02")).toBe("");
  });

  it("preserves normal text unchanged", () => {
    expect(SecurityValidator.sanitizeString("Hello World 123")).toBe("Hello World 123");
  });

  it("handles combined: control chars + null + whitespace", () => {
    expect(SecurityValidator.sanitizeString("  \x00\x01hello\x7f  ")).toBe("hello");
  });
});

// ============================================================================
// createSecureSchema — recursive validation
// ============================================================================

describe("createSecureSchema — recursive validation edge cases", () => {
  it("validates string at root level using last path segment as context", () => {
    const schema = createSecureSchema(z.string());
    const result = schema.safeParse("clean text");
    expect(result.success).toBe(true);
  });

  it("rejects XSS at root string level", () => {
    const schema = createSecureSchema(z.string());
    const result = schema.safeParse("<script>alert(1)</script>");
    expect(result.success).toBe(false);
  });

  it("uses field name as context key for nested fields", () => {
    const schema = createSecureSchema(z.object({ email: z.string() }));
    // 321 chars in email field should trigger EXCESSIVE_LENGTH (email max=320)
    const result = schema.safeParse({ email: "a".repeat(321) });
    expect(result.success).toBe(false);
  });

  it("validates arrays recursively at each index", () => {
    const schema = createSecureSchema(z.object({ items: z.array(z.string()) }));
    const result = schema.safeParse({
      items: ["safe", "<script>x</script>", "safe2"],
    });
    expect(result.success).toBe(false);
  });

  it("validates deeply nested objects", () => {
    const schema = createSecureSchema(
      z.object({
        level1: z.object({
          level2: z.object({
            name: z.string(),
          }),
        }),
      })
    );
    const result = schema.safeParse({
      level1: { level2: { name: "<script>x</script>" } },
    });
    expect(result.success).toBe(false);
  });

  it("ignores non-string, non-object, non-array values", () => {
    const schema = createSecureSchema(z.object({ count: z.number(), active: z.boolean() }));
    const result = schema.safeParse({ count: 42, active: true });
    expect(result.success).toBe(true);
  });

  it("uses default context when path is empty for root string", () => {
    const schema = createSecureSchema(z.string());
    // default max = 1000
    const result = schema.safeParse("a".repeat(1001));
    expect(result.success).toBe(false);
  });

  it("passes validation for clean nested data with arrays", () => {
    const schema = createSecureSchema(
      z.object({
        tags: z.array(z.string()),
        meta: z.object({ key: z.string() }),
      })
    );
    const result = schema.safeParse({
      tags: ["hello", "world"],
      meta: { key: "value" },
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// SecureSchemas — detailed edge cases
// ============================================================================

describe("SecureSchemas.userEmail — edge cases", () => {
  it("rejects email longer than 320 chars", () => {
    const longEmail = "a".repeat(310) + "@example.com";
    const result = SecureSchemas.userEmail.safeParse(longEmail);
    expect(result.success).toBe(false);
  });

  it("accepts valid email within length", () => {
    const result = SecureSchemas.userEmail.safeParse("test@valid.com");
    expect(result.success).toBe(true);
  });

  it("rejects non-string input", () => {
    const result = SecureSchemas.userEmail.safeParse(12345);
    expect(result.success).toBe(false);
  });
});

describe("SecureSchemas.userName — edge cases", () => {
  it("rejects name longer than 256 chars", () => {
    const result = SecureSchemas.userName.safeParse("a".repeat(257));
    expect(result.success).toBe(false);
  });

  it("accepts single character name", () => {
    const result = SecureSchemas.userName.safeParse("A");
    expect(result.success).toBe(true);
  });

  it("rejects name with command injection chars", () => {
    const result = SecureSchemas.userName.safeParse("user;ls");
    expect(result.success).toBe(false);
  });
});

describe("SecureSchemas.postBody — edge cases", () => {
  it("rejects body exceeding 10000 chars", () => {
    const result = SecureSchemas.postBody.safeParse("a".repeat(10001));
    expect(result.success).toBe(false);
  });

  it("accepts body at exactly 10000 chars", () => {
    const result = SecureSchemas.postBody.safeParse("a".repeat(10000));
    expect(result.success).toBe(true);
  });

  it("rejects body with SQL injection", () => {
    const result = SecureSchemas.postBody.safeParse("normal text SELECT * FROM users");
    expect(result.success).toBe(false);
  });

  it("rejects empty body (min=1)", () => {
    const result = SecureSchemas.postBody.safeParse("");
    expect(result.success).toBe(false);
  });
});

describe("SecureSchemas.url — protocol validation", () => {
  it("rejects ftp protocol", () => {
    const result = SecureSchemas.url.safeParse("ftp://example.com/file");
    expect(result.success).toBe(false);
  });

  it("rejects data protocol", () => {
    const result = SecureSchemas.url.safeParse("data:text/html,<h1>hi</h1>");
    expect(result.success).toBe(false);
  });

  it("accepts https with path and query", () => {
    const result = SecureSchemas.url.safeParse("https://example.com/path?q=1");
    expect(result.success).toBe(true);
  });

  it("returns the url string on success", () => {
    const result = SecureSchemas.url.safeParse("https://example.com");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("https://example.com");
    }
  });

  it("rejects non-URL strings", () => {
    const result = SecureSchemas.url.safeParse("not a url at all");
    expect(result.success).toBe(false);
  });

  it("rejects URL exceeding 2048 chars", () => {
    const result = SecureSchemas.url.safeParse("https://example.com/" + "a".repeat(2030));
    expect(result.success).toBe(false);
  });
});

describe("SecureSchemas.mediaUrl — host validation", () => {
  it("rejects disallowed host when ALLOWED_MEDIA_HOSTS is set", () => {
    const originalEnv = process.env.ALLOWED_MEDIA_HOSTS;
    process.env.ALLOWED_MEDIA_HOSTS = "cdn.example.com,storage.example.com";

    const result = SecureSchemas.mediaUrl.safeParse("https://evil.com/image.jpg");

    process.env.ALLOWED_MEDIA_HOSTS = originalEnv;
    expect(result.success).toBe(false);
  });

  it("accepts allowed host when ALLOWED_MEDIA_HOSTS is set", () => {
    const originalEnv = process.env.ALLOWED_MEDIA_HOSTS;
    process.env.ALLOWED_MEDIA_HOSTS = "cdn.example.com,storage.example.com";

    const result = SecureSchemas.mediaUrl.safeParse("https://cdn.example.com/img.png");

    process.env.ALLOWED_MEDIA_HOSTS = originalEnv;
    expect(result.success).toBe(true);
  });

  it("accepts any host when ALLOWED_MEDIA_HOSTS is not set", () => {
    const originalEnv = process.env.ALLOWED_MEDIA_HOSTS;
    delete process.env.ALLOWED_MEDIA_HOSTS;

    const result = SecureSchemas.mediaUrl.safeParse("https://any-host.com/file.mp4");

    process.env.ALLOWED_MEDIA_HOSTS = originalEnv;
    expect(result.success).toBe(true);
  });

  it("rejects ftp protocol for media URLs", () => {
    const result = SecureSchemas.mediaUrl.safeParse("ftp://cdn.example.com/file.jpg");
    expect(result.success).toBe(false);
  });

  it("returns the url string on success", () => {
    const originalEnv = process.env.ALLOWED_MEDIA_HOSTS;
    delete process.env.ALLOWED_MEDIA_HOSTS;

    const result = SecureSchemas.mediaUrl.safeParse("https://media.example.com/vid.mp4");

    process.env.ALLOWED_MEDIA_HOSTS = originalEnv;
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("https://media.example.com/vid.mp4");
    }
  });

  it("rejects non-URL input for media URL", () => {
    const result = SecureSchemas.mediaUrl.safeParse("not-a-url");
    expect(result.success).toBe(false);
  });

  it("checks hostname endsWith for host matching", () => {
    const originalEnv = process.env.ALLOWED_MEDIA_HOSTS;
    process.env.ALLOWED_MEDIA_HOSTS = "example.com";

    const r1 = SecureSchemas.mediaUrl.safeParse("https://sub.example.com/file.jpg");
    const r2 = SecureSchemas.mediaUrl.safeParse("https://other.org/file.jpg");

    process.env.ALLOWED_MEDIA_HOSTS = originalEnv;
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(false);
  });
});

describe("SecureSchemas.filePath — edge cases", () => {
  it("rejects path with explicit .. even if validator misses", () => {
    // filePath checks both SecurityValidator AND path.includes("..")
    const result = SecureSchemas.filePath.safeParse("foo/../bar");
    expect(result.success).toBe(false);
  });

  it("rejects path exceeding 255 chars", () => {
    const result = SecureSchemas.filePath.safeParse("a".repeat(256));
    expect(result.success).toBe(false);
  });

  it("accepts path at exactly 255 chars", () => {
    const result = SecureSchemas.filePath.safeParse("a".repeat(255));
    expect(result.success).toBe(true);
  });

  it("rejects path with command injection", () => {
    const result = SecureSchemas.filePath.safeParse("file;rm -rf");
    expect(result.success).toBe(false);
  });

  it("accepts simple safe path", () => {
    const result = SecureSchemas.filePath.safeParse("uploads/photos/pic.jpg");
    expect(result.success).toBe(true);
  });
});

describe("SecureSchemas.channelId — edge cases", () => {
  it("rejects empty channel ID", () => {
    const result = SecureSchemas.channelId.safeParse("");
    expect(result.success).toBe(false);
  });

  it("accepts channel ID at max length 100", () => {
    const result = SecureSchemas.channelId.safeParse("a".repeat(100));
    expect(result.success).toBe(true);
  });

  it("rejects channel ID at 101 chars", () => {
    const result = SecureSchemas.channelId.safeParse("a".repeat(101));
    expect(result.success).toBe(false);
  });

  it("rejects channel ID with path traversal", () => {
    const result = SecureSchemas.channelId.safeParse("../etc/passwd");
    expect(result.success).toBe(false);
  });

  it("rejects channel ID with null byte", () => {
    const result = SecureSchemas.channelId.safeParse("channel\0id");
    expect(result.success).toBe(false);
  });

  it("accepts simple alphanumeric-dash-underscore channel ID", () => {
    const result = SecureSchemas.channelId.safeParse("my-channel_123");
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// validateString — isValid reflects threats correctly
// ============================================================================

describe("SecurityValidator.validateString — isValid correctness", () => {
  it("returns isValid=true when threats array is empty", () => {
    const result = SecurityValidator.validateString("clean text", "default");
    expect(result.threats).toHaveLength(0);
    expect(result.isValid).toBe(true);
  });

  it("returns isValid=false when any threat is present", () => {
    const result = SecurityValidator.validateString("SELECT * FROM x", "default");
    expect(result.threats.length).toBeGreaterThan(0);
    expect(result.isValid).toBe(false);
  });

  it("reports multiple threats simultaneously for combined attack", () => {
    // SQL + XSS + PATH + COMMAND + NULL + CONTROL + LENGTH
    const attack = "SELECT <script>x</script> ../etc ; cmd\0" + "a".repeat(1000);
    const result = SecurityValidator.validateString(attack, "name");
    expect(result.threats).toContain("SQL_INJECTION");
    expect(result.threats).toContain("XSS");
    expect(result.threats).toContain("PATH_TRAVERSAL");
    expect(result.threats).toContain("COMMAND_INJECTION");
    expect(result.threats).toContain("NULL_BYTE");
    expect(result.isValid).toBe(false);
  });
});
