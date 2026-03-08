/**
 * Comprehensive File Upload Validation System
 * Phase 1 Sprint 1.2 Day 2 - Input Validation & Security Headers
 *
 * Provides advanced file upload validation including:
 * - File type validation beyond MIME type checking
 * - Magic number (file signature) verification
 * - Malware detection integration
 * - Size and dimension limits
 * - Content analysis for suspicious patterns
 */

import { createHash } from "crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { ApiMetrics } from "../metrics/apiMetrics.js";
import { logger } from "../lib/logger.js";

// File signature patterns for magic number validation
const FILE_SIGNATURES: Record<string, { signatures: string[]; extensions: string[] }> = {
  jpeg: {
    signatures: ["FFD8FF"],
    extensions: [".jpg", ".jpeg"],
  },
  png: {
    signatures: ["89504E47"],
    extensions: [".png"],
  },
  gif: {
    signatures: ["474946383761", "474946383961"], // GIF87a, GIF89a
    extensions: [".gif"],
  },
  webp: {
    signatures: ["52494646"],
    extensions: [".webp"],
  },
  pdf: {
    signatures: ["255044462D"],
    extensions: [".pdf"],
  },
  zip: {
    signatures: ["504B0304", "504B0506", "504B0708"],
    extensions: [".zip"],
  },
  mp4: {
    signatures: ["00000018667479706D703432", "00000020667479706D703432"],
    extensions: [".mp4"],
  },
  mp3: {
    signatures: ["494433", "FFFB"],
    extensions: [".mp3"],
  },
};

// Dangerous file patterns and embedded content
const DANGEROUS_PATTERNS = {
  // Executable signatures
  EXECUTABLES: [
    "4D5A", // PE/EXE files
    "7F454C46", // ELF files
    "CAFEBABE", // Java class files
    "FEEDFACE", // Mach-O files
  ],

  // Script injection patterns
  EMBEDDED_SCRIPTS: [
    /<script[^>]*>/gi,
    /javascript:/gi,
    /vbscript:/gi,
    /data:text\/html/gi,
    /on\w+\s*=/gi,
  ],

  // Archive bombs indicators
  COMPRESSION_BOMB: {
    maxCompressionRatio: 100, // 100:1 ratio
    maxNestedArchives: 3,
    maxFileCount: 1000,
  },

  // Metadata exploitation patterns
  METADATA_EXPLOITS: [
    /<%[\s\S]*?%>/g, // ASP/JSP code
    /<\?php[\s\S]*?\?>/gi, // PHP code
    /eval\s*\(/gi, // JavaScript eval
    /exec\s*\(/gi, // Command execution
  ],
};

interface FileValidationConfig {
  maxFileSize: number;
  maxImageDimension: number;
  allowedMimeTypes: string[];
  allowedExtensions: string[];
  enableVirusScanning: boolean;
  enableMagicNumberValidation: boolean;
  enableMetadataValidation: boolean;
  enableContentAnalysis: boolean;
  quarantineDirectory: string;
  scanTimeout: number;
}

interface FileValidationResult {
  isValid: boolean;
  threats: string[];
  fileInfo: {
    originalName: string;
    size: number;
    mimeType: string;
    extension: string;
    hash: string;
    magicNumber?: string;
    dimensions?: { width: number; height: number };
  };
  risk: "low" | "medium" | "high" | "critical";
  scanResults?: {
    virusFound: boolean;
    engine: string;
    signature?: string;
    scanTime: number;
  };
}

export class FileUploadValidator {
  private config: FileValidationConfig;
  private metrics: ApiMetrics;
  private quarantinedFiles: Set<string> = new Set();

  constructor(config: Partial<FileValidationConfig>, metrics: ApiMetrics) {
    this.config = {
      maxFileSize: 10 * 1024 * 1024, // 10MB
      maxImageDimension: 4096, // 4096x4096 max
      allowedMimeTypes: [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
        "application/pdf",
        "text/plain",
        "text/csv",
        "video/mp4",
        "audio/mpeg",
      ],
      allowedExtensions: [
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
      ],
      enableVirusScanning: true,
      enableMagicNumberValidation: true,
      enableMetadataValidation: true,
      enableContentAnalysis: true,
      quarantineDirectory: "/tmp/quarantine",
      scanTimeout: 30000, // 30 seconds
      ...config,
    };
    this.metrics = metrics;
  }

  /**
   * Comprehensive file validation pipeline
   */
  async validateFile(
    fileBuffer: Buffer,
    originalName: string,
    mimeType: string
  ): Promise<FileValidationResult> {
    const startTime = Date.now();
    const threats: string[] = [];
    let risk: "low" | "medium" | "high" | "critical" = "low";

    // Generate file hash for tracking
    const hash = createHash("sha256").update(fileBuffer).digest("hex");

    // Extract file extension
    const extension = originalName.toLowerCase().substring(originalName.lastIndexOf("."));

    const fileInfo: FileValidationResult["fileInfo"] = {
      originalName,
      size: fileBuffer.length,
      mimeType,
      extension,
      hash,
    };

    try {
      // 1. Basic size validation
      if (fileBuffer.length > this.config.maxFileSize) {
        threats.push("FILE_TOO_LARGE");
        risk = "medium";
      }

      if (fileBuffer.length === 0) {
        threats.push("EMPTY_FILE");
        risk = "medium";
        return { isValid: false, threats, fileInfo, risk };
      }

      // 2. Extension validation
      if (!this.config.allowedExtensions.includes(extension)) {
        threats.push("INVALID_EXTENSION");
        risk = "high";
      }

      // 3. MIME type validation
      if (!this.config.allowedMimeTypes.includes(mimeType)) {
        threats.push("INVALID_MIME_TYPE");
        risk = "medium";
      }

      // 4. Magic number validation
      if (this.config.enableMagicNumberValidation) {
        const magicValidation = this.validateMagicNumber(fileBuffer, extension);
        if (!magicValidation.isValid) {
          threats.push(...magicValidation.threats);
          risk = this.getMaxRisk(risk, "high");
        }
        fileInfo.magicNumber = magicValidation.magicNumber;
      }

      // 5. Content analysis
      if (this.config.enableContentAnalysis) {
        const contentThreats = await this.analyzeFileContent(fileBuffer, mimeType);
        threats.push(...contentThreats.threats);
        risk = this.getMaxRisk(risk, contentThreats.risk);
      }

      // 6. Metadata validation
      if (this.config.enableMetadataValidation) {
        const metadataThreats = await this.validateMetadata(fileBuffer, mimeType);
        threats.push(...metadataThreats.threats);
        risk = this.getMaxRisk(risk, metadataThreats.risk);
      }

      // 7. Image-specific validation
      if (mimeType.startsWith("image/")) {
        const imageValidation = await this.validateImage(fileBuffer);
        threats.push(...imageValidation.threats);
        risk = this.getMaxRisk(risk, imageValidation.risk);
        if (imageValidation.dimensions) {
          fileInfo.dimensions = imageValidation.dimensions;
        }
      }

      // 8. Virus scanning (if enabled and configured)
      let scanResults;
      if (this.config.enableVirusScanning) {
        scanResults = await this.scanForMalware(fileBuffer, hash);
        if (scanResults.virusFound) {
          threats.push("MALWARE_DETECTED");
          risk = "critical";
          await this.quarantineFile(hash, fileBuffer);
        }
      }

      // Record metrics
      const validationTime = Date.now() - startTime;
      this.metrics.metrics.inputValidationDuration.observe(validationTime);

      if (threats.length > 0) {
        this.metrics.metrics.securityThreats.inc({
          threat_type: "file_upload",
          endpoint: "file_validation",
        });
      }

      return {
        isValid: threats.length === 0,
        threats,
        fileInfo,
        risk,
        ...(scanResults && { scanResults }),
      };
    } catch (error) {
      threats.push("VALIDATION_ERROR");
      risk = "high";

      logger.error({ err: error }, "File validation error");

      return {
        isValid: false,
        threats,
        fileInfo,
        risk,
      };
    }
  }

  /**
   * Validate file magic number (file signature)
   */
  private validateMagicNumber(
    buffer: Buffer,
    extension: string
  ): {
    isValid: boolean;
    threats: string[];
    magicNumber: string;
  } {
    const threats: string[] = [];
    const magicNumber = buffer.toString("hex", 0, 12).toUpperCase(); // First 12 bytes

    // Check for dangerous executable signatures
    for (const dangerousSignature of DANGEROUS_PATTERNS.EXECUTABLES) {
      if (magicNumber.startsWith(dangerousSignature)) {
        threats.push("EXECUTABLE_FILE_DETECTED");
        break;
      }
    }

    // Validate against expected file type
    const expectedType = Object.entries(FILE_SIGNATURES).find(([_, info]) =>
      info.extensions.includes(extension)
    );

    if (expectedType) {
      const [_typeName, typeInfo] = expectedType;
      const matchesExpectedSignature = typeInfo.signatures.some((sig) =>
        magicNumber.startsWith(sig)
      );

      if (!matchesExpectedSignature) {
        threats.push("MAGIC_NUMBER_MISMATCH");
      }
    }

    return {
      isValid: threats.length === 0,
      threats,
      magicNumber,
    };
  }

  /**
   * Analyze file content for suspicious patterns
   */
  private async analyzeFileContent(
    buffer: Buffer,
    mimeType: string
  ): Promise<{
    threats: string[];
    risk: "low" | "medium" | "high" | "critical";
  }> {
    const threats: string[] = [];
    let risk: "low" | "medium" | "high" | "critical" = "low";

    try {
      // Convert buffer to string for text analysis
      const content = buffer.toString("utf8", 0, Math.min(buffer.length, 10000)); // First 10KB

      // Check for embedded scripts
      for (const pattern of DANGEROUS_PATTERNS.EMBEDDED_SCRIPTS) {
        if (pattern.test(content)) {
          threats.push("EMBEDDED_SCRIPT_DETECTED");
          risk = "high";
          break;
        }
      }

      // Check for metadata exploits
      for (const pattern of DANGEROUS_PATTERNS.METADATA_EXPLOITS) {
        if (pattern.test(content)) {
          threats.push("METADATA_EXPLOIT_DETECTED");
          risk = "high";
          break;
        }
      }

      // Check for null bytes (potential binary exploit)
      if (
        content.includes("\0") &&
        !mimeType.startsWith("image/") &&
        !mimeType.startsWith("video/")
      ) {
        threats.push("NULL_BYTE_DETECTED");
        risk = "medium";
      }

      // Check for extremely high entropy (potential encryption/obfuscation)
      const entropy = this.calculateEntropy(buffer);
      if (entropy > 7.5) {
        // Very high entropy threshold
        threats.push("HIGH_ENTROPY_CONTENT");
        risk = "medium";
      }
    } catch {
      // Content analysis failed, treat as suspicious
      threats.push("CONTENT_ANALYSIS_FAILED");
      risk = "medium";
    }

    return { threats, risk };
  }

  /**
   * Validate file metadata for exploits
   */
  private async validateMetadata(
    buffer: Buffer,
    mimeType: string
  ): Promise<{
    threats: string[];
    risk: "low" | "medium" | "high" | "critical";
  }> {
    const threats: string[] = [];
    let risk: "low" | "medium" | "high" | "critical" = "low";

    // Check for oversized metadata sections
    if (mimeType.startsWith("image/")) {
      // Look for EXIF data that's suspiciously large
      const exifMarker = buffer.indexOf("Exif");
      if (exifMarker !== -1) {
        const exifSize = buffer.length - exifMarker;
        if (exifSize > buffer.length * 0.5) {
          // EXIF shouldn't be >50% of file
          threats.push("OVERSIZED_METADATA");
          risk = "medium";
        }
      }
    }

    return { threats, risk };
  }

  /**
   * Image-specific validation
   */
  private async validateImage(buffer: Buffer): Promise<{
    threats: string[];
    risk: "low" | "medium" | "high" | "critical";
    dimensions?: { width: number; height: number };
  }> {
    const threats: string[] = [];
    let risk: "low" | "medium" | "high" | "critical" = "low";

    try {
      // Basic image dimension extraction (PNG example)
      if (buffer.toString("hex", 0, 4).toUpperCase() === "89504E47") {
        // PNG format
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);

        if (width > this.config.maxImageDimension || height > this.config.maxImageDimension) {
          threats.push("IMAGE_DIMENSIONS_TOO_LARGE");
          risk = "medium";
        }

        if (width === 0 || height === 0) {
          threats.push("INVALID_IMAGE_DIMENSIONS");
          risk = "medium";
        }

        return { threats, risk, dimensions: { width, height } };
      }

      // JPEG format
      if (buffer.toString("hex", 0, 3).toUpperCase() === "FFD8FF") {
        // Basic JPEG validation - more complex parsing would be needed for full validation
        const dimensions = this.extractJpegDimensions(buffer);
        if (dimensions) {
          if (
            dimensions.width > this.config.maxImageDimension ||
            dimensions.height > this.config.maxImageDimension
          ) {
            threats.push("IMAGE_DIMENSIONS_TOO_LARGE");
            risk = "medium";
          }
          return { threats, risk, dimensions };
        }
      }
    } catch {
      threats.push("IMAGE_VALIDATION_FAILED");
      risk = "medium";
    }

    return { threats, risk };
  }

  /**
   * Simulate malware scanning (integrate with actual antivirus engine)
   */
  private async scanForMalware(
    buffer: Buffer,
    hash: string
  ): Promise<{
    virusFound: boolean;
    engine: string;
    signature?: string;
    scanTime: number;
  }> {
    const startTime = Date.now();

    try {
      // Simulate ClamAV or other antivirus integration
      // In production, this would call actual antivirus API

      // Check against known malicious hashes
      const knownMaliciousHashes = [
        "44d88612fea8a8f36de82e1278abb02f",
        "5d41402abc4b2a76b9719d911017c592",
        // Add more known bad hashes
      ];

      const virusFound = knownMaliciousHashes.includes(hash.substring(0, 32));

      return {
        virusFound,
        engine: "ClamAV-Simulator",
        ...(virusFound && { signature: "Test.EICAR.Signature" }),
        scanTime: Date.now() - startTime,
      };
    } catch {
      // If scanning fails, err on the side of caution
      return {
        virusFound: true,
        engine: "Scanner-Error",
        signature: "SCAN_FAILED",
        scanTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Quarantine suspicious files
   */
  private async quarantineFile(hash: string, _buffer: Buffer): Promise<void> {
    try {
      this.quarantinedFiles.add(hash);
      // In production, write to secure quarantine directory
      logger.warn({ fileHash: hash }, "File quarantined");

      // Log security incident
      this.metrics.metrics.securityThreats.inc({
        threat_type: "malware",
        endpoint: "file_upload",
      });
    } catch (error) {
      logger.error({ err: error, fileHash: hash }, "Failed to quarantine file");
    }
  }

  /**
   * Calculate Shannon entropy for content analysis
   */
  private calculateEntropy(buffer: Buffer): number {
    const freq: Record<number, number> = {};
    let entropy = 0;

    // Count byte frequencies
    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      if (byte !== undefined) {
        freq[byte] = (freq[byte] || 0) + 1;
      }
    }

    // Calculate entropy
    for (const count of Object.values(freq)) {
      const probability = count / buffer.length;
      entropy -= probability * Math.log2(probability);
    }

    return entropy;
  }

  /**
   * Extract JPEG dimensions (simplified)
   */
  private extractJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
    try {
      // Look for SOF (Start of Frame) marker
      for (let i = 0; i < buffer.length - 8; i++) {
        if (buffer[i] === 0xff && (buffer[i + 1] === 0xc0 || buffer[i + 1] === 0xc2)) {
          const height = buffer.readUInt16BE(i + 5);
          const width = buffer.readUInt16BE(i + 7);
          return { width, height };
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Failed to extract JPEG dimensions");
    }
    return null;
  }

  /**
   * Get maximum risk level
   */
  private getMaxRisk(
    current: "low" | "medium" | "high" | "critical",
    newRisk: "low" | "medium" | "high" | "critical"
  ): "low" | "medium" | "high" | "critical" {
    const riskLevels = { low: 1, medium: 2, high: 3, critical: 4 };
    const currentLevel = riskLevels[current];
    const newLevel = riskLevels[newRisk];
    const maxLevel = Math.max(currentLevel, newLevel);
    return Object.keys(riskLevels)[maxLevel - 1] as "low" | "medium" | "high" | "critical";
  }

  /**
   * Create Fastify plugin for file upload validation
   */
  getPlugin() {
    const _self = this;
    return async function fileUploadValidatorPlugin(fastify: any) {
      fastify.addContentTypeParser(
        ["multipart/form-data"],
        { parseAs: "buffer" },
        async function (request: FastifyRequest, body: Buffer) {
          // This would integrate with fastify-multipart or similar
          // For now, return the body as-is
          return body;
        }
      );

      // Add file validation hook
      fastify.addHook("preHandler", async (request: FastifyRequest, _reply: FastifyReply) => {
        // Skip non-file upload requests
        const contentType = request.headers["content-type"];
        if (!contentType?.includes("multipart/form-data")) {
          return;
        }

        // File validation would be handled by the multipart parser
        // This is a placeholder for the integration point
      });
    };
  }

  /**
   * Validate uploaded file (external API)
   */
  async validateUploadedFile(file: {
    buffer: Buffer;
    filename: string;
    mimetype: string;
  }): Promise<FileValidationResult> {
    return this.validateFile(file.buffer, file.filename, file.mimetype);
  }
}

/**
 * Factory function for creating file upload validator
 */
export function createFileUploadValidator(
  config?: Partial<FileValidationConfig>,
  metrics?: ApiMetrics
): FileUploadValidator {
  if (!metrics) {
    throw new Error("ApiMetrics instance is required for FileUploadValidator");
  }
  return new FileUploadValidator(config || {}, metrics);
}
