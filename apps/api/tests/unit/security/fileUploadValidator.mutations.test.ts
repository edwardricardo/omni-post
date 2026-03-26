/**
 * @file fileUploadValidator.mutations.test.ts
 * @description Mutation-killing tests for FileUploadValidator.
 *              Targets survived mutants from Stryker: boundary conditions, each
 *              code branch, risk escalation, entropy, magic bytes, content patterns.
 * @layer testing
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  FileUploadValidator,
  createFileUploadValidator,
} from "../../../src/security/fileUploadValidator.js";

// ============================================================================
// Shared helpers
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

function makeMockMetrics() {
  return {
    metrics: {
      inputValidationDuration: { observe: vi.fn() },
      securityThreats: { inc: vi.fn() },
    },
  } as any;
}

/** Build a minimal valid PNG buffer with specified dimensions. */
function makePng(width: number, height: number, bodySize = 100): Buffer {
  // PNG signature: 89504E47 0D0A1A0A
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR chunk starts at byte 8; width at offset 16, height at offset 20
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(width, 8); // byte 16 in full buffer
  ihdr.writeUInt32BE(height, 12); // byte 20 in full buffer
  return Buffer.concat([sig, ihdr, Buffer.alloc(bodySize)]);
}

/** Build a minimal valid JPEG buffer. */
function makeJpeg(bodySize = 500): Buffer {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  return Buffer.concat([header, Buffer.alloc(bodySize)]);
}

/** Build a JPEG buffer with SOF0 marker encoding dimensions. */
function makeJpegWithDimensions(width: number, height: number): Buffer {
  const header = Buffer.from([0xff, 0xd8, 0xff]);
  // padding before SOF marker
  const padding = Buffer.alloc(20, 0x00);
  // SOF0 marker
  const sof = Buffer.alloc(10);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([header, padding, sof, Buffer.alloc(500)]);
}

/** Build a buffer starting with the given hex signature. */
function makeBufferFromHex(hexSignature: string, totalSize = 500): Buffer {
  const sigBytes = Buffer.from(hexSignature, "hex");
  const rest = Buffer.alloc(Math.max(0, totalSize - sigBytes.length));
  return Buffer.concat([sigBytes, rest]);
}

/** Build a low-entropy buffer (all same byte). */
function makeLowEntropyBuffer(size: number, byte = 0x41): Buffer {
  return Buffer.alloc(size, byte);
}

/** Build a high-entropy buffer (uniformly distributed bytes). */
function makeHighEntropyBuffer(size: number): Buffer {
  const buf = Buffer.alloc(size);
  for (let i = 0; i < size; i++) {
    buf[i] = i % 256;
  }
  // Shuffle to raise entropy
  for (let i = size - 1; i > 0; i--) {
    const j = (i * 7 + 13) % (i + 1);
    const tmp = buf[i]!;
    buf[i] = buf[j]!;
    buf[j] = tmp;
  }
  return buf;
}

// Default config that disables all optional checks for isolated testing
const MINIMAL_CONFIG = {
  enableMagicNumberValidation: false,
  enableContentAnalysis: false,
  enableMetadataValidation: false,
  enableVirusScanning: false,
};

// ============================================================================
// File size validation — boundary values
// ============================================================================

describe("FileUploadValidator — file size boundaries", () => {
  it("accepts file at exactly maxFileSize", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator({ ...MINIMAL_CONFIG, maxFileSize: 100 }, metrics);
    const buf = Buffer.alloc(100, 0x41);

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).not.toContain("FILE_TOO_LARGE");
  });

  it("rejects file at maxFileSize + 1", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator({ ...MINIMAL_CONFIG, maxFileSize: 100 }, metrics);
    const buf = Buffer.alloc(101, 0x41);

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).toContain("FILE_TOO_LARGE");
    expect(result.risk).toBe("medium");
  });

  it("accepts file of size 1 (not empty, not too large)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(1, 0x41);

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).not.toContain("EMPTY_FILE");
    expect(result.threats).not.toContain("FILE_TOO_LARGE");
  });

  it("uses default maxFileSize of 10MB", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const defaultMax = 10 * 1024 * 1024;
    const buf = Buffer.alloc(defaultMax, 0x41);

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).not.toContain("FILE_TOO_LARGE");
  });
});

// ============================================================================
// Empty file detection
// ============================================================================

describe("FileUploadValidator — empty file", () => {
  it("returns early with EMPTY_FILE and isValid=false", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator({}, metrics);
    const buf = Buffer.alloc(0);

    const result = await validator.validateFile(buf, "empty.txt", "text/plain");

    expect(result.isValid).toBe(false);
    expect(result.threats).toContain("EMPTY_FILE");
    expect(result.risk).toBe("medium");
    // Should not contain threats from later stages (early return)
    expect(result.threats).not.toContain("INVALID_EXTENSION");
  });
});

// ============================================================================
// Extension validation — each allowed extension
// ============================================================================

describe("FileUploadValidator — extension validation", () => {
  const allowedExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".webp",
    ".pdf",
    ".txt",
    ".csv",
    ".mp4",
    ".mp3",
  ];

  for (const ext of allowedExtensions) {
    it(`accepts ${ext} extension`, async () => {
      const metrics = makeMockMetrics();
      const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
      const buf = Buffer.alloc(10, 0x41);

      const result = await validator.validateFile(buf, `file${ext}`, "text/plain");

      expect(result.threats).not.toContain("INVALID_EXTENSION");
    });
  }

  it("rejects .exe extension", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(10, 0x41);

    const result = await validator.validateFile(buf, "file.exe", "text/plain");

    expect(result.threats).toContain("INVALID_EXTENSION");
    expect(result.risk).toBe("high");
  });

  it("rejects .bat extension", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(10, 0x41);

    const result = await validator.validateFile(buf, "file.bat", "text/plain");

    expect(result.threats).toContain("INVALID_EXTENSION");
  });

  it("extracts extension from last dot in filename", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(10, 0x41);

    const result = await validator.validateFile(buf, "file.backup.jpg", "image/jpeg");

    expect(result.threats).not.toContain("INVALID_EXTENSION");
    expect(result.fileInfo.extension).toBe(".jpg");
  });
});

// ============================================================================
// MIME type validation — each allowed MIME type
// ============================================================================

describe("FileUploadValidator — MIME type validation", () => {
  const allowedMimes = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "application/pdf",
    "text/plain",
    "text/csv",
    "video/mp4",
    "audio/mpeg",
  ];

  for (const mime of allowedMimes) {
    it(`accepts ${mime}`, async () => {
      const metrics = makeMockMetrics();
      const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
      const buf = Buffer.alloc(10, 0x41);

      const result = await validator.validateFile(buf, "file.txt", mime);

      expect(result.threats).not.toContain("INVALID_MIME_TYPE");
    });
  }

  it("rejects application/x-executable", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(10, 0x41);

    const result = await validator.validateFile(buf, "file.txt", "application/x-executable");

    expect(result.threats).toContain("INVALID_MIME_TYPE");
    expect(result.risk).toBe("medium");
  });

  it("rejects application/x-msdownload", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(10, 0x41);

    const result = await validator.validateFile(buf, "file.txt", "application/x-msdownload");

    expect(result.threats).toContain("INVALID_MIME_TYPE");
  });
});

// ============================================================================
// Magic number validation — each dangerous executable signature
// ============================================================================

describe("FileUploadValidator — executable detection via magic numbers", () => {
  const executableSignatures = [
    { name: "PE/EXE (4D5A)", hex: "4D5A" },
    { name: "ELF (7F454C46)", hex: "7F454C46" },
    { name: "Java class (CAFEBABE)", hex: "CAFEBABE" },
    { name: "Mach-O (FEEDFACE)", hex: "FEEDFACE" },
  ];

  for (const { name, hex } of executableSignatures) {
    it(`detects ${name} executable signature`, async () => {
      const metrics = makeMockMetrics();
      const validator = new FileUploadValidator(
        { ...MINIMAL_CONFIG, enableMagicNumberValidation: true },
        metrics
      );
      const buf = makeBufferFromHex(hex);

      const result = await validator.validateFile(buf, "file.txt", "text/plain");

      expect(result.threats).toContain("EXECUTABLE_FILE_DETECTED");
    });
  }

  it("does not flag non-executable magic number", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMagicNumberValidation: true },
      metrics
    );
    // PNG signature is NOT in EXECUTABLES list
    const buf = makePng(100, 100);

    const result = await validator.validateFile(buf, "file.png", "image/png");

    expect(result.threats).not.toContain("EXECUTABLE_FILE_DETECTED");
  });
});

// ============================================================================
// Magic number validation — file signature matching
// ============================================================================

describe("FileUploadValidator — magic number signature matching", () => {
  it("validates JPEG magic bytes FFD8FF against .jpg extension", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMagicNumberValidation: true },
      metrics
    );
    const buf = makeJpeg();

    const result = await validator.validateFile(buf, "file.jpg", "image/jpeg");

    expect(result.threats).not.toContain("MAGIC_NUMBER_MISMATCH");
    expect(result.fileInfo.magicNumber).toBeDefined();
  });

  it("validates PNG magic bytes 89504E47 against .png extension", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMagicNumberValidation: true },
      metrics
    );
    const buf = makePng(100, 100);

    const result = await validator.validateFile(buf, "file.png", "image/png");

    expect(result.threats).not.toContain("MAGIC_NUMBER_MISMATCH");
  });

  it("validates GIF87a magic bytes", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMagicNumberValidation: true },
      metrics
    );
    // GIF87a = 474946383761
    const buf = makeBufferFromHex("474946383761");

    const result = await validator.validateFile(buf, "file.gif", "image/gif");

    expect(result.threats).not.toContain("MAGIC_NUMBER_MISMATCH");
  });

  it("validates GIF89a magic bytes", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMagicNumberValidation: true },
      metrics
    );
    const buf = makeBufferFromHex("474946383961");

    const result = await validator.validateFile(buf, "file.gif", "image/gif");

    expect(result.threats).not.toContain("MAGIC_NUMBER_MISMATCH");
  });

  it("validates WebP magic bytes (RIFF)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMagicNumberValidation: true },
      metrics
    );
    const buf = makeBufferFromHex("52494646");

    const result = await validator.validateFile(buf, "file.webp", "image/webp");

    expect(result.threats).not.toContain("MAGIC_NUMBER_MISMATCH");
  });

  it("validates PDF magic bytes", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMagicNumberValidation: true },
      metrics
    );
    const buf = makeBufferFromHex("255044462D");

    const result = await validator.validateFile(buf, "file.pdf", "application/pdf");

    expect(result.threats).not.toContain("MAGIC_NUMBER_MISMATCH");
  });

  it("validates ZIP magic bytes (504B0304)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMagicNumberValidation: true },
      metrics
    );
    const buf = makeBufferFromHex("504B0304");

    const result = await validator.validateFile(buf, "file.zip", "application/zip");

    expect(result.threats).not.toContain("MAGIC_NUMBER_MISMATCH");
  });

  it("validates MP3 magic bytes (ID3 = 494433)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMagicNumberValidation: true },
      metrics
    );
    const buf = makeBufferFromHex("494433");

    const result = await validator.validateFile(buf, "file.mp3", "audio/mpeg");

    expect(result.threats).not.toContain("MAGIC_NUMBER_MISMATCH");
  });

  it("validates MP3 magic bytes (FFFB sync word)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMagicNumberValidation: true },
      metrics
    );
    const buf = makeBufferFromHex("FFFB");

    const result = await validator.validateFile(buf, "file.mp3", "audio/mpeg");

    expect(result.threats).not.toContain("MAGIC_NUMBER_MISMATCH");
  });

  it("detects mismatch when JPEG bytes are in .png file", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMagicNumberValidation: true },
      metrics
    );
    const buf = makeJpeg();

    const result = await validator.validateFile(buf, "file.png", "image/png");

    expect(result.threats).toContain("MAGIC_NUMBER_MISMATCH");
  });

  it("skips signature check for unknown extension (no mismatch)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMagicNumberValidation: true },
      metrics
    );
    const buf = Buffer.alloc(50, 0x41);

    const result = await validator.validateFile(buf, "file.xyz", "text/plain");

    expect(result.threats).not.toContain("MAGIC_NUMBER_MISMATCH");
  });

  it("skips magic number validation when disabled", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMagicNumberValidation: false },
      metrics
    );
    // JPEG bytes in .png — would normally fail
    const buf = makeJpeg();

    const result = await validator.validateFile(buf, "file.png", "image/png");

    expect(result.threats).not.toContain("MAGIC_NUMBER_MISMATCH");
    expect(result.fileInfo.magicNumber).toBeUndefined();
  });
});

// ============================================================================
// Content analysis — embedded scripts and metadata exploits
// ============================================================================

describe("FileUploadValidator — content analysis patterns", () => {
  it("detects <script> in content", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableContentAnalysis: true },
      metrics
    );
    const buf = Buffer.from("<script>alert(1)</script>" + "X".repeat(200));

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).toContain("EMBEDDED_SCRIPT_DETECTED");
    expect(result.risk).toBe("high");
  });

  it("detects javascript: in content", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableContentAnalysis: true },
      metrics
    );
    const buf = Buffer.from("javascript:void(0)" + "X".repeat(200));

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).toContain("EMBEDDED_SCRIPT_DETECTED");
  });

  it("detects vbscript: in content", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableContentAnalysis: true },
      metrics
    );
    const buf = Buffer.from("vbscript:msgbox" + "X".repeat(200));

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).toContain("EMBEDDED_SCRIPT_DETECTED");
  });

  it("detects data:text/html in content", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableContentAnalysis: true },
      metrics
    );
    const buf = Buffer.from("data:text/html,<h1>hi</h1>" + "X".repeat(200));

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).toContain("EMBEDDED_SCRIPT_DETECTED");
  });

  it("detects on-event handler pattern in content", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableContentAnalysis: true },
      metrics
    );
    const buf = Buffer.from("onerror =doEvil" + "X".repeat(200));

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).toContain("EMBEDDED_SCRIPT_DETECTED");
  });

  it("detects ASP/JSP code (<% %>)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableContentAnalysis: true },
      metrics
    );
    const buf = Buffer.from("<% Response.Write(1) %>" + "X".repeat(200));

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).toContain("METADATA_EXPLOIT_DETECTED");
  });

  it("detects PHP code (<?php ?>)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableContentAnalysis: true },
      metrics
    );
    const buf = Buffer.from('<?php system("ls"); ?>' + "X".repeat(200));

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).toContain("METADATA_EXPLOIT_DETECTED");
  });

  it("detects eval() in content", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableContentAnalysis: true },
      metrics
    );
    const buf = Buffer.from('eval("malicious")' + "X".repeat(200));

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).toContain("METADATA_EXPLOIT_DETECTED");
  });

  it("detects exec() in content", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableContentAnalysis: true },
      metrics
    );
    const buf = Buffer.from('exec("cmd")' + "X".repeat(200));

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).toContain("METADATA_EXPLOIT_DETECTED");
  });

  it("detects null bytes in text/plain content", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableContentAnalysis: true },
      metrics
    );
    const buf = Buffer.from("hello\0world" + "X".repeat(200));

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).toContain("NULL_BYTE_DETECTED");
  });

  it("does NOT flag null bytes in image/ MIME type", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableContentAnalysis: true },
      metrics
    );
    // Binary images naturally contain null bytes
    const buf = makePng(100, 100);

    const result = await validator.validateFile(buf, "file.png", "image/png");

    expect(result.threats).not.toContain("NULL_BYTE_DETECTED");
  });

  it("does NOT flag null bytes in video/ MIME type", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableContentAnalysis: true },
      metrics
    );
    const buf = Buffer.alloc(100);
    buf[50] = 0x00; // null byte

    const result = await validator.validateFile(buf, "file.mp4", "video/mp4");

    expect(result.threats).not.toContain("NULL_BYTE_DETECTED");
  });

  it("analyzes only first 10KB of content", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableContentAnalysis: true },
      metrics
    );
    // Place script tag beyond 10KB boundary
    const prefix = Buffer.alloc(11000, 0x41);
    const suffix = Buffer.from("<script>alert(1)</script>");
    const buf = Buffer.concat([prefix, suffix]);

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    // Script is beyond the 10KB analysis window
    expect(result.threats).not.toContain("EMBEDDED_SCRIPT_DETECTED");
  });
});

// ============================================================================
// Entropy calculation
// ============================================================================

describe("FileUploadValidator — entropy detection", () => {
  it("flags high entropy content (> 7.5)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableContentAnalysis: true },
      metrics
    );
    const buf = makeHighEntropyBuffer(1000);

    const result = await validator.validateFile(buf, "file.bin", "application/octet-stream");

    expect(result.threats).toContain("HIGH_ENTROPY_CONTENT");
    expect(result.risk).toBe("medium");
  });

  it("does NOT flag low entropy content (<= 7.5)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableContentAnalysis: true },
      metrics
    );
    const buf = makeLowEntropyBuffer(1000);

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).not.toContain("HIGH_ENTROPY_CONTENT");
  });
});

// ============================================================================
// Metadata validation
// ============================================================================

describe("FileUploadValidator — metadata validation", () => {
  it("detects oversized EXIF when > 50% of file", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMetadataValidation: true },
      metrics
    );
    // Small header + large Exif section
    const header = Buffer.alloc(10, 0xff);
    const exif = Buffer.from("Exif" + "X".repeat(200));
    const buf = Buffer.concat([header, exif]);
    // exifSize = buf.length - exifMarker which is 210 out of 214 total > 50%

    const result = await validator.validateFile(buf, "file.jpg", "image/jpeg");

    expect(result.threats).toContain("OVERSIZED_METADATA");
    expect(result.risk).toBe("medium");
  });

  it("does NOT flag Exif when <= 50% of file", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMetadataValidation: true },
      metrics
    );
    const header = Buffer.alloc(500, 0xff);
    const exif = Buffer.from("Exif" + "X".repeat(100));
    const buf = Buffer.concat([header, exif]);

    const result = await validator.validateFile(buf, "file.jpg", "image/jpeg");

    expect(result.threats).not.toContain("OVERSIZED_METADATA");
  });

  it("skips metadata check for non-image MIME type", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMetadataValidation: true },
      metrics
    );
    const buf = Buffer.from("Exif" + "X".repeat(500));

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).not.toContain("OVERSIZED_METADATA");
  });

  it("handles file without Exif marker", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableMetadataValidation: true },
      metrics
    );
    const buf = makeJpeg();

    const result = await validator.validateFile(buf, "file.jpg", "image/jpeg");

    expect(result.threats).not.toContain("OVERSIZED_METADATA");
  });
});

// ============================================================================
// Image validation — PNG dimensions
// ============================================================================

describe("FileUploadValidator — PNG dimension validation", () => {
  it("accepts image at exactly maxImageDimension", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, maxImageDimension: 100 },
      metrics
    );
    const buf = makePng(100, 100);

    const result = await validator.validateFile(buf, "img.png", "image/png");

    expect(result.threats).not.toContain("IMAGE_DIMENSIONS_TOO_LARGE");
    expect(result.fileInfo.dimensions).toEqual({ width: 100, height: 100 });
  });

  it("rejects image with width at maxImageDimension + 1", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, maxImageDimension: 100 },
      metrics
    );
    const buf = makePng(101, 100);

    const result = await validator.validateFile(buf, "img.png", "image/png");

    expect(result.threats).toContain("IMAGE_DIMENSIONS_TOO_LARGE");
  });

  it("rejects image with height at maxImageDimension + 1", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, maxImageDimension: 100 },
      metrics
    );
    const buf = makePng(100, 101);

    const result = await validator.validateFile(buf, "img.png", "image/png");

    expect(result.threats).toContain("IMAGE_DIMENSIONS_TOO_LARGE");
  });

  it("detects zero width in PNG", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = makePng(0, 100);

    const result = await validator.validateFile(buf, "img.png", "image/png");

    expect(result.threats).toContain("INVALID_IMAGE_DIMENSIONS");
  });

  it("detects zero height in PNG", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = makePng(100, 0);

    const result = await validator.validateFile(buf, "img.png", "image/png");

    expect(result.threats).toContain("INVALID_IMAGE_DIMENSIONS");
  });

  it("detects both zero width and height", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = makePng(0, 0);

    const result = await validator.validateFile(buf, "img.png", "image/png");

    expect(result.threats).toContain("INVALID_IMAGE_DIMENSIONS");
  });
});

// ============================================================================
// Image validation — JPEG dimensions
// ============================================================================

describe("FileUploadValidator — JPEG dimension validation", () => {
  it("extracts JPEG dimensions from SOF0 marker (0xFFC0)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = makeJpegWithDimensions(300, 200);

    const result = await validator.validateFile(buf, "img.jpg", "image/jpeg");

    expect(result.fileInfo.dimensions).toEqual({ width: 300, height: 200 });
  });

  it("extracts JPEG dimensions from SOF2 marker (0xFFC2)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    // Build with SOF2 (0xC2) marker
    const header = Buffer.from([0xff, 0xd8, 0xff]);
    const padding = Buffer.alloc(20, 0x00);
    const sof = Buffer.alloc(10);
    sof[0] = 0xff;
    sof[1] = 0xc2; // SOF2
    sof.writeUInt16BE(150, 5); // height
    sof.writeUInt16BE(250, 7); // width
    const buf = Buffer.concat([header, padding, sof, Buffer.alloc(500)]);

    const result = await validator.validateFile(buf, "img.jpg", "image/jpeg");

    expect(result.fileInfo.dimensions).toEqual({ width: 250, height: 150 });
  });

  it("rejects JPEG with dimensions exceeding limit", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, maxImageDimension: 200 },
      metrics
    );
    const buf = makeJpegWithDimensions(300, 200);

    const result = await validator.validateFile(buf, "img.jpg", "image/jpeg");

    expect(result.threats).toContain("IMAGE_DIMENSIONS_TOO_LARGE");
  });

  it("handles JPEG without SOF marker (no dimensions)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = makeJpeg(); // No SOF marker

    const result = await validator.validateFile(buf, "img.jpg", "image/jpeg");

    expect(result.fileInfo.dimensions).toBeUndefined();
  });
});

// ============================================================================
// Image validation — non-image MIME skips image checks
// ============================================================================

describe("FileUploadValidator — image check skipping for non-images", () => {
  it("skips image dimension check for text/plain", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(50, 0x41);

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.fileInfo.dimensions).toBeUndefined();
    expect(result.threats).not.toContain("IMAGE_DIMENSIONS_TOO_LARGE");
    expect(result.threats).not.toContain("INVALID_IMAGE_DIMENSIONS");
  });
});

// ============================================================================
// Virus scanning
// ============================================================================

describe("FileUploadValidator — virus scanning", () => {
  it("returns scanResults when virus scanning is enabled", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableVirusScanning: true },
      metrics
    );
    const buf = Buffer.alloc(50, 0x41);

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.scanResults).toBeDefined();
    expect(result.scanResults!.engine).toBe("ClamAV-Simulator");
    expect(result.scanResults!.virusFound).toBe(false);
    expect(result.scanResults!.scanTime).toBeGreaterThanOrEqual(0);
  });

  it("does NOT include scanResults when virus scanning is disabled", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableVirusScanning: false },
      metrics
    );
    const buf = Buffer.alloc(50, 0x41);

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.scanResults).toBeUndefined();
  });

  it("does not include signature field for clean files", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(
      { ...MINIMAL_CONFIG, enableVirusScanning: true },
      metrics
    );
    const buf = Buffer.alloc(50, 0x41);

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.scanResults!.virusFound).toBe(false);
    expect(result.scanResults!.signature).toBeUndefined();
  });
});

// ============================================================================
// getMaxRisk — risk escalation logic
// ============================================================================

describe("FileUploadValidator — risk escalation", () => {
  it("escalates risk from low to medium (FILE_TOO_LARGE)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator({ ...MINIMAL_CONFIG, maxFileSize: 10 }, metrics);
    const buf = Buffer.alloc(20, 0x41);

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.risk).toBe("medium");
  });

  it("escalates risk from medium to high (INVALID_EXTENSION)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator({ ...MINIMAL_CONFIG, maxFileSize: 10 }, metrics);
    const buf = Buffer.alloc(20, 0x41);

    const result = await validator.validateFile(buf, "file.exe", "text/plain");

    // FILE_TOO_LARGE=medium, INVALID_EXTENSION=high -> max is high
    expect(result.risk).toBe("high");
  });

  it("risk is overwritten by later direct assignments (steps 1-3 do not use getMaxRisk)", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator({ ...MINIMAL_CONFIG, maxFileSize: 10 }, metrics);
    const buf = Buffer.alloc(20, 0x41);

    // Steps 1-3 assign risk directly: FILE_TOO_LARGE→medium, INVALID_EXTENSION→high, INVALID_MIME_TYPE→medium
    // MIME type check (step 3) overwrites risk="high" from step 2 with "medium"
    const result = await validator.validateFile(buf, "file.exe", "application/x-executable");

    expect(result.risk).toBe("medium");
  });

  it("does not downgrade risk level", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    // Extension invalid = high risk, but MIME valid = no additional threat
    const buf = Buffer.alloc(10, 0x41);

    const result = await validator.validateFile(buf, "file.exe", "text/plain");

    expect(result.risk).toBe("high");
  });
});

// ============================================================================
// Metrics recording
// ============================================================================

describe("FileUploadValidator — metrics recording", () => {
  it("records validation duration on every call", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(10, 0x41);

    await validator.validateFile(buf, "file.txt", "text/plain");

    expect(metrics.metrics.inputValidationDuration.observe).toHaveBeenCalledTimes(1);
    const duration = metrics.metrics.inputValidationDuration.observe.mock.calls[0][0];
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("increments security threat counter when threats found", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(10, 0x41);

    await validator.validateFile(buf, "file.exe", "text/plain");

    expect(metrics.metrics.securityThreats.inc).toHaveBeenCalledWith({
      threat_type: "file_upload",
      endpoint: "file_validation",
    });
  });

  it("does NOT increment threat counter for clean file", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(10, 0x41);

    await validator.validateFile(buf, "file.txt", "text/plain");

    expect(metrics.metrics.securityThreats.inc).not.toHaveBeenCalled();
  });
});

// ============================================================================
// isValid correctness
// ============================================================================

describe("FileUploadValidator — isValid reflects threats", () => {
  it("returns isValid=true when threats array is empty", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(10, 0x41);

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.threats).toHaveLength(0);
    expect(result.isValid).toBe(true);
  });

  it("returns isValid=false when threats array has entries", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(10, 0x41);

    const result = await validator.validateFile(buf, "file.exe", "text/plain");

    expect(result.threats.length).toBeGreaterThan(0);
    expect(result.isValid).toBe(false);
  });
});

// ============================================================================
// File info correctness
// ============================================================================

describe("FileUploadValidator — fileInfo population", () => {
  it("populates originalName from parameter", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(10, 0x41);

    const result = await validator.validateFile(buf, "my-photo.jpg", "image/jpeg");

    expect(result.fileInfo.originalName).toBe("my-photo.jpg");
  });

  it("populates size from buffer length", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(42, 0x41);

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.fileInfo.size).toBe(42);
  });

  it("populates mimeType from parameter", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(10, 0x41);

    const result = await validator.validateFile(buf, "file.txt", "text/csv");

    expect(result.fileInfo.mimeType).toBe("text/csv");
  });

  it("extracts lowercase extension", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(10, 0x41);

    const result = await validator.validateFile(buf, "FILE.TXT", "text/plain");

    expect(result.fileInfo.extension).toBe(".txt");
  });

  it("generates sha256 hash of 64 hex chars", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.from("test content for hash");

    const result = await validator.validateFile(buf, "file.txt", "text/plain");

    expect(result.fileInfo.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ============================================================================
// validateUploadedFile wrapper
// ============================================================================

describe("FileUploadValidator — validateUploadedFile", () => {
  it("delegates to validateFile with correct arguments", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator(MINIMAL_CONFIG, metrics);
    const buf = Buffer.alloc(10, 0x41);

    const result = await validator.validateUploadedFile({
      buffer: buf,
      filename: "upload.txt",
      mimetype: "text/plain",
    });

    expect(result.fileInfo.originalName).toBe("upload.txt");
    expect(result.fileInfo.mimeType).toBe("text/plain");
    expect(result.fileInfo.size).toBe(10);
  });
});

// ============================================================================
// createFileUploadValidator factory
// ============================================================================

describe("createFileUploadValidator — factory", () => {
  it("throws when metrics is undefined", () => {
    expect(() => createFileUploadValidator({}, undefined as any)).toThrow(
      "ApiMetrics instance is required"
    );
  });

  it("throws when metrics is null", () => {
    expect(() => createFileUploadValidator({}, null as any)).toThrow(
      "ApiMetrics instance is required"
    );
  });

  it("creates validator with empty config", () => {
    const metrics = makeMockMetrics();
    const validator = createFileUploadValidator({}, metrics);
    expect(validator).toBeInstanceOf(FileUploadValidator);
  });

  it("creates validator with custom config", () => {
    const metrics = makeMockMetrics();
    const validator = createFileUploadValidator(
      { maxFileSize: 5 * 1024 * 1024, enableVirusScanning: false },
      metrics
    );
    expect(validator).toBeInstanceOf(FileUploadValidator);
  });
});

// ============================================================================
// Fastify plugin
// ============================================================================

describe("FileUploadValidator — getPlugin", () => {
  it("returns an async function", () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator({}, metrics);
    const plugin = validator.getPlugin();

    expect(typeof plugin).toBe("function");
  });

  it("registers multipart/form-data content parser", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator({}, metrics);
    const registeredTypes: any[] = [];

    const mockFastify = {
      addContentTypeParser: (types: any, _opts: any, _handler: any) => {
        registeredTypes.push(types);
      },
      addHook: vi.fn(),
    };

    const plugin = validator.getPlugin();
    await plugin(mockFastify as any);

    expect(registeredTypes).toEqual([["multipart/form-data"]]);
  });

  it("registers preHandler hook", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator({}, metrics);
    const hookNames: string[] = [];

    const mockFastify = {
      addContentTypeParser: vi.fn(),
      addHook: (name: string, _handler: any) => {
        hookNames.push(name);
      },
    };

    const plugin = validator.getPlugin();
    await plugin(mockFastify as any);

    expect(hookNames).toContain("preHandler");
  });

  it("preHandler hook skips non-multipart requests", async () => {
    const metrics = makeMockMetrics();
    const validator = new FileUploadValidator({}, metrics);
    let preHandlerFn: any;

    const mockFastify = {
      addContentTypeParser: vi.fn(),
      addHook: (_name: string, handler: any) => {
        preHandlerFn = handler;
      },
    };

    const plugin = validator.getPlugin();
    await plugin(mockFastify as any);

    // Should not throw for non-multipart request
    const mockRequest = { headers: { "content-type": "application/json" } };
    const mockReply = {};
    await expect(preHandlerFn(mockRequest, mockReply)).resolves.toBeUndefined();
  });
});
