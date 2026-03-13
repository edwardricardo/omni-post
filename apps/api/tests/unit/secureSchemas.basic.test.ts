import { describe, it, expect } from "vitest";
import { SecurityValidatedSchemas } from "../../src/validation/secureSchemas.js";

describe("SecurityValidatedSchemas - Email Validation", () => {
  it("should accept valid email addresses", () => {
    const validEmails = [
      "user@example.com",
      "test.user@example.co.uk",
      "user+tag@example.com",
      "user_name@example-domain.com",
    ];

    validEmails.forEach((email) => {
      const result = SecurityValidatedSchemas.email.safeParse(email);
      expect(result.success).toBe(true);
    });
  });

  it("should reject invalid email formats", () => {
    const invalidEmails = [
      "not-an-email",
      "@example.com",
      "user@",
      "user@.com",
      "user@domain",
      "user..name@example.com",
    ];

    invalidEmails.forEach((email) => {
      const result = SecurityValidatedSchemas.email.safeParse(email);
      expect(result.success).toBe(false);
    });
  });

  it("should block emails with XSS attempts", () => {
    const maliciousEmails = [
      "user<script>alert(1)</script>@example.com",
      "user@example.com<script>",
      'user"onerror="alert(1)"@example.com',
      "user@example.com/malicious",
      "javascript:alert(1)@example.com",
    ];

    maliciousEmails.forEach((email) => {
      const result = SecurityValidatedSchemas.email.safeParse(email);
      expect(result.success).toBe(false);
    });
  });

  it("should normalize email addresses", () => {
    const result = SecurityValidatedSchemas.email.safeParse("User@Example.COM");
    if (result.success) {
      expect(result.data).toMatch(/@example\.com$/);
    }
  });

  it("should enforce length limits", () => {
    const tooShort = "a@b.c";
    const tooLong = "a".repeat(300) + "@example.com";

    expect(SecurityValidatedSchemas.email.safeParse(tooShort).success).toBe(false);
    expect(SecurityValidatedSchemas.email.safeParse(tooLong).success).toBe(false);
  });
});

describe("SecurityValidatedSchemas - Password Validation", () => {
  it("should accept strong passwords", () => {
    const strongPasswords = [
      "StrongP@ssw0rd123",
      "C0mpl3x!P@ssword",
      "MyS3cur3P@ss2024",
      "Tr0ng!P@ssw0rd99",
    ];

    strongPasswords.forEach((password) => {
      const result = SecurityValidatedSchemas.password.safeParse(password);
      expect(result.success).toBe(true);
    });
  });

  it("should reject passwords without uppercase letters", () => {
    const result = SecurityValidatedSchemas.password.safeParse("weakpassword123!");
    expect(result.success).toBe(false);
  });

  it("should reject passwords without lowercase letters", () => {
    const result = SecurityValidatedSchemas.password.safeParse("WEAKPASSWORD123!");
    expect(result.success).toBe(false);
  });

  it("should reject passwords without numbers", () => {
    const result = SecurityValidatedSchemas.password.safeParse("WeakPassword!");
    expect(result.success).toBe(false);
  });

  it("should reject passwords without special characters", () => {
    const result = SecurityValidatedSchemas.password.safeParse("WeakPassword123");
    expect(result.success).toBe(false);
  });

  it("should reject passwords shorter than 12 characters", () => {
    const result = SecurityValidatedSchemas.password.safeParse("Short1!");
    expect(result.success).toBe(false);
  });

  it("should reject passwords longer than 128 characters", () => {
    const tooLong = "A1!a" + "x".repeat(130);
    const result = SecurityValidatedSchemas.password.safeParse(tooLong);
    expect(result.success).toBe(false);
  });

  it("should reject common weak patterns", () => {
    const weakPasswords = [
      "Password123456!",
      "Admin123456!@#",
      "Qwerty123456!@#",
      "Welcome123!@#$",
      "Letmein123!@#$",
    ];

    weakPasswords.forEach((password) => {
      const result = SecurityValidatedSchemas.password.safeParse(password);
      expect(result.success).toBe(false);
    });
  });
});

describe("SecurityValidatedSchemas - Username Validation", () => {
  it("should accept valid usernames", () => {
    const validUsernames = ["john_doe", "user123", "test-user", "alice_bob-123"];

    validUsernames.forEach((username) => {
      const result = SecurityValidatedSchemas.username.safeParse(username);
      expect(result.success).toBe(true);
    });
  });

  it("should reject usernames with invalid characters", () => {
    const invalidUsernames = [
      "user@name",
      "user name",
      "user!name",
      "user#name",
      "user$name",
      "user%name",
    ];

    invalidUsernames.forEach((username) => {
      const result = SecurityValidatedSchemas.username.safeParse(username);
      expect(result.success).toBe(false);
    });
  });

  it("should reject reserved system usernames", () => {
    const reservedNames = [
      "admin",
      "administrator",
      "root",
      "system",
      "api",
      "null",
      "undefined",
      "console",
      "eval",
    ];

    reservedNames.forEach((username) => {
      const result = SecurityValidatedSchemas.username.safeParse(username);
      expect(result.success).toBe(false);
    });
  });

  it("should enforce length limits", () => {
    const tooShort = "ab";
    const tooLong = "a".repeat(31);

    expect(SecurityValidatedSchemas.username.safeParse(tooShort).success).toBe(false);
    expect(SecurityValidatedSchemas.username.safeParse(tooLong).success).toBe(false);
  });
});

describe("SecurityValidatedSchemas - UUID Validation", () => {
  it("should accept valid UUIDs", () => {
    const validUUIDs = [
      "123e4567-e89b-12d3-a456-426614174000",
      "550e8400-e29b-41d4-a716-446655440000",
      "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    ];

    validUUIDs.forEach((uuid) => {
      const result = SecurityValidatedSchemas.uuid.safeParse(uuid);
      expect(result.success).toBe(true);
    });
  });

  it("should reject invalid UUID formats", () => {
    const invalidUUIDs = [
      "not-a-uuid",
      "123e4567-e89b-12d3-a456",
      "123e4567-e89b-12d3-a456-42661417400",
      "123e4567e89b12d3a456426614174000",
      "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    ];

    invalidUUIDs.forEach((uuid) => {
      const result = SecurityValidatedSchemas.uuid.safeParse(uuid);
      expect(result.success).toBe(false);
    });
  });
});

describe("SecurityValidatedSchemas - URL Validation", () => {
  it("should accept valid HTTP/HTTPS URLs", () => {
    const validUrls = [
      "https://example.com",
      "http://example.com/path",
      "https://sub.example.com/path?query=value",
      "https://example.com:8080/path",
    ];

    validUrls.forEach((url) => {
      const result = SecurityValidatedSchemas.url.safeParse(url);
      expect(result.success).toBe(true);
    });
  });

  it("should reject URLs with blocked protocols", () => {
    const blockedUrls = [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "ftp://example.com",
    ];

    blockedUrls.forEach((url) => {
      const result = SecurityValidatedSchemas.url.safeParse(url);
      expect(result.success).toBe(false);
    });
  });

  it("should reject localhost URLs", () => {
    const localhostUrls = ["http://localhost:3000", "https://localhost"];

    localhostUrls.forEach((url) => {
      const result = SecurityValidatedSchemas.url.safeParse(url);
      expect(result.success).toBe(false);
    });
  });

  // NOTE: Current schema only blocks "localhost" string, not IP addresses like 127.0.0.1
  it("should accept IP addresses (current behavior - may need enhancement)", () => {
    const result = SecurityValidatedSchemas.url.safeParse("http://127.0.0.1");
    expect(result.success).toBe(true);
  });

  it("should enforce maximum URL length", () => {
    const tooLong = "https://example.com/" + "a".repeat(2050);
    const result = SecurityValidatedSchemas.url.safeParse(tooLong);
    expect(result.success).toBe(false);
  });
});

describe("SecurityValidatedSchemas - File Path Validation", () => {
  it("should accept safe file paths", () => {
    const safePaths = ["uploads/image.jpg", "documents/report.pdf", "media/video.mp4"];

    safePaths.forEach((path) => {
      const result = SecurityValidatedSchemas.filePath.safeParse(path);
      expect(result.success).toBe(true);
    });
  });

  it("should reject path traversal attempts", () => {
    const maliciousPaths = [
      "../../../etc/passwd",
      "uploads/../../../etc/passwd",
      "..\\..\\..\\windows\\system32",
      "%2e%2e%2f%2e%2e%2f",
      "/etc/passwd",
      "/proc/self/environ",
      "/sys/kernel",
      "/dev/null",
    ];

    maliciousPaths.forEach((path) => {
      const result = SecurityValidatedSchemas.filePath.safeParse(path);
      expect(result.success).toBe(false);
    });
  });

  it("should enforce length limits", () => {
    const tooLong = "path/" + "a".repeat(300) + ".txt";
    const result = SecurityValidatedSchemas.filePath.safeParse(tooLong);
    expect(result.success).toBe(false);
  });
});

describe("SecurityValidatedSchemas - Filename Validation", () => {
  it("should accept safe filenames", () => {
    const safeFilenames = ["image.jpg", "document.pdf", "video_123.mp4", "file-name.txt"];

    safeFilenames.forEach((filename) => {
      const result = SecurityValidatedSchemas.filename.safeParse(filename);
      expect(result.success).toBe(true);
    });
  });

  it("should reject filenames starting with dot", () => {
    const result = SecurityValidatedSchemas.filename.safeParse(".htaccess");
    expect(result.success).toBe(false);
  });

  it("should reject filenames with special characters", () => {
    const invalidFilenames = ["file name.txt", "file@name.jpg", "file#name.pdf", "file$name.doc"];

    invalidFilenames.forEach((filename) => {
      const result = SecurityValidatedSchemas.filename.safeParse(filename);
      expect(result.success).toBe(false);
    });
  });

  it("should reject dangerous file extensions", () => {
    const dangerousFiles = [
      "malware.exe",
      "script.bat",
      "virus.com",
      "trojan.scr",
      "backdoor.php",
      "shell.sh",
      "exploit.py",
      "malicious.js",
    ];

    dangerousFiles.forEach((filename) => {
      const result = SecurityValidatedSchemas.filename.safeParse(filename);
      expect(result.success).toBe(false);
    });
  });
});
