import { promises as fs } from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { createLogger } from "../lib/logger.js";

const videoLogger = createLogger("video");

interface UploadChunk {
  index: number;
  start: number;
  end: number;
  size: number;
  checksum: string;
  uploaded: boolean;
  retries: number;
}

export interface UploadSession {
  sessionId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  totalChunks: number;
  chunkSize: number;
  uploadedChunks: number;
  chunks: UploadChunk[];
  status: "created" | "uploading" | "processing" | "completed" | "failed" | "cancelled";
  progress: number;
  createdAt: Date;
  updatedAt: Date;
  uploadUrl?: string;
  finalUrl?: string;
  error?: string;
  metadata?: {
    duration?: number;
    resolution?: string;
    codec?: string;
    bitrate?: number;
  };
}

export interface UploadOptions {
  chunkSize?: number; // bytes, default 5MB
  maxRetries?: number; // per chunk, default 3
  timeout?: number; // milliseconds, default 30s
  checksumValidation?: boolean; // default true
  resumable?: boolean; // default true
  encryption?: {
    enabled: boolean;
    algorithm?: "aes-256-gcm";
    key?: string;
  };
  compression?: {
    enabled: boolean;
    level?: number; // 1-9
  };
  webhook?: {
    url: string;
    events: ("progress" | "completed" | "failed")[];
    headers?: Record<string, string>;
  };
}

export interface UploadProgress {
  sessionId: string;
  totalBytes: number;
  uploadedBytes: number;
  progress: number; // 0-100
  speed: number; // bytes per second
  eta: number; // seconds remaining
  currentChunk: number;
  totalChunks: number;
  status: UploadSession["status"];
  error?: string;
}

export interface UploadDestination {
  type: "local" | "s3" | "gcs" | "azure" | "youtube";
  config: {
    // Local storage
    directory?: string;

    // S3
    bucket?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;

    // Google Cloud Storage
    projectId?: string;
    keyFilename?: string;

    // Azure Blob Storage
    storageAccount?: string;
    storageKey?: string;
    containerName?: string;

    // YouTube
    credentials?: {
      clientId: string;
      clientSecret: string;
      refreshToken: string;
      accessToken?: string;
    };
  };
}

export class VideoUploadPipeline {
  private sessions: Map<string, UploadSession> = new Map();
  private progressCallbacks: Map<string, (progress: UploadProgress) => void> = new Map();
  private tempDir: string;
  /** Delay in ms used by simulated cloud-destination chunk uploads. Overridable for tests. */
  private readonly simulatedChunkDelayMs: number;

  constructor(simulatedChunkDelayMs?: number) {
    this.tempDir = process.env.VIDEO_TEMP_DIR || "/tmp/claude/video-uploads";
    this.simulatedChunkDelayMs = simulatedChunkDelayMs ?? 100;
    this.ensureTempDir();
  }

  /**
   * Create a new upload session
   */
  async createUploadSession(
    fileName: string,
    fileSize: number,
    mimeType: string,
    options: UploadOptions = {}
  ): Promise<UploadSession> {
    const sessionId = crypto.randomUUID();
    const chunkSize = options.chunkSize || 5 * 1024 * 1024; // 5MB default
    const totalChunks = Math.ceil(fileSize / chunkSize);

    const chunks: UploadChunk[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize - 1, fileSize - 1);
      const size = end - start + 1;

      chunks.push({
        index: i,
        start,
        end,
        size,
        checksum: "", // Will be calculated during upload
        uploaded: false,
        retries: 0,
      });
    }

    const session: UploadSession = {
      sessionId,
      fileName,
      fileSize,
      mimeType,
      totalChunks,
      chunkSize,
      uploadedChunks: 0,
      chunks,
      status: "created",
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Upload file with resumable upload support
   */
  async uploadFile(
    filePath: string,
    destination: UploadDestination,
    options: UploadOptions = {},
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadSession> {
    const stats = await fs.stat(filePath);
    const fileName = path.basename(filePath);
    const mimeType = this.getMimeType(fileName);

    // Create upload session
    const session = await this.createUploadSession(fileName, stats.size, mimeType, options);

    if (onProgress) {
      this.progressCallbacks.set(session.sessionId, onProgress);
    }

    try {
      session.status = "uploading";
      session.updatedAt = new Date();

      // Start upload process
      await this.processUpload(session, filePath, destination, options);

      session.status = "completed";
      session.progress = 100;
      session.updatedAt = new Date();

      this.updateProgress(session);
      return session;
    } catch (error) {
      session.status = "failed";
      session.error = error instanceof Error ? error.message : "Upload failed";
      session.updatedAt = new Date();

      this.updateProgress(session);
      throw error;
    } finally {
      this.progressCallbacks.delete(session.sessionId);
    }
  }

  /**
   * Resume an existing upload session
   */
  async resumeUpload(
    sessionId: string,
    filePath: string,
    destination: UploadDestination,
    options: UploadOptions = {},
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error("Upload session not found");
    }

    if (session.status === "completed") {
      return session;
    }

    if (onProgress) {
      this.progressCallbacks.set(sessionId, onProgress);
    }

    try {
      session.status = "uploading";
      session.updatedAt = new Date();

      await this.processUpload(session, filePath, destination, options);

      session.status = "completed";
      session.progress = 100;
      session.updatedAt = new Date();

      this.updateProgress(session);
      return session;
    } catch (error) {
      session.status = "failed";
      session.error = error instanceof Error ? error.message : "Upload failed";
      session.updatedAt = new Date();

      this.updateProgress(session);
      throw error;
    } finally {
      this.progressCallbacks.delete(sessionId);
    }
  }

  /**
   * Cancel an upload session
   */
  async cancelUpload(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.status = "cancelled";
    session.updatedAt = new Date();

    // Clean up any temporary files
    try {
      const tempPath = path.join(this.tempDir, sessionId);
      await fs.rm(tempPath, { recursive: true, force: true });
    } catch (error) {
      videoLogger.warn({ err: error }, "Failed to clean up temp files");
    }

    this.progressCallbacks.delete(sessionId);
    return true;
  }

  /**
   * Get upload session status
   */
  getUploadSession(sessionId: string): UploadSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * List all upload sessions
   */
  listUploadSessions(): UploadSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Clean up completed sessions older than specified time
   */
  async cleanupSessions(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoffTime = Date.now() - olderThanMs;
    let cleaned = 0;

    for (const [sessionId, session] of Array.from(this.sessions.entries())) {
      if (
        (session.status === "completed" || session.status === "failed") &&
        session.updatedAt.getTime() < cutoffTime
      ) {
        // Clean up temp files
        try {
          const tempPath = path.join(this.tempDir, sessionId);
          await fs.rm(tempPath, { recursive: true, force: true });
        } catch (error) {
          videoLogger.warn({ err: error, sessionId }, "Failed to clean up temp files for session");
        }

        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    return cleaned;
  }

  private async processUpload(
    session: UploadSession,
    filePath: string,
    destination: UploadDestination,
    options: UploadOptions
  ): Promise<void> {
    const fileHandle = await fs.open(filePath, "r");
    const startTime = Date.now();
    let uploadedBytes = session.chunks
      .filter((c) => c.uploaded)
      .reduce((sum, c) => sum + c.size, 0);

    try {
      const maxConcurrent = destination.type === "youtube" ? 1 : 3;
      const pendingChunks = session.chunks.filter((c) => !c.uploaded);
      const inFlight = new Set<Promise<void>>();

      const uploadChunkWithTracking = (chunk: UploadChunk): Promise<void> => {
        const promise = this.uploadChunk(fileHandle, chunk, session, destination, options).then(
          () => {
            uploadedBytes += chunk.size;
            session.uploadedChunks++;
            session.progress = Math.floor((uploadedBytes / session.fileSize) * 100);

            const elapsed = (Date.now() - startTime) / 1000;
            const speed = elapsed > 0 ? uploadedBytes / elapsed : 0;
            const remaining = session.fileSize - uploadedBytes;
            const eta = speed > 0 ? remaining / speed : 0;

            this.updateProgress(session, speed, eta);
          }
        );
        const trackedPromise = promise.finally(() => {
          inFlight.delete(trackedPromise);
        });
        inFlight.add(trackedPromise);
        return trackedPromise;
      };

      for (const chunk of pendingChunks) {
        // Wait until a slot is available
        if (inFlight.size >= maxConcurrent) {
          await Promise.race(Array.from(inFlight));
        }
        uploadChunkWithTracking(chunk);
      }

      // Wait for all remaining in-flight uploads
      await Promise.all(Array.from(inFlight));

      // Finalize upload based on destination
      await this.finalizeUpload(session, destination, options);
    } finally {
      await fileHandle.close();
    }
  }

  private async uploadChunk(
    fileHandle: fs.FileHandle,
    chunk: UploadChunk,
    session: UploadSession,
    destination: UploadDestination,
    options: UploadOptions
  ): Promise<void> {
    const maxRetries = options.maxRetries || 3;

    while (chunk.retries < maxRetries) {
      try {
        // Read chunk data
        const buffer = Buffer.allocUnsafe(chunk.size);
        await fileHandle.read(buffer, 0, chunk.size, chunk.start);

        // Calculate checksum if validation enabled
        if (options.checksumValidation !== false) {
          chunk.checksum = crypto.createHash("md5").update(buffer).digest("hex");
        }

        // Apply encryption if enabled
        let uploadBuffer: Buffer = buffer;
        if (options.encryption?.enabled) {
          uploadBuffer = await this.encryptChunk(buffer, options.encryption);
        }

        // Apply compression if enabled
        if (options.compression?.enabled) {
          uploadBuffer = await this.compressChunk(uploadBuffer, options.compression);
        }

        // Upload chunk based on destination type
        await this.uploadChunkToDestination(uploadBuffer, chunk, session, destination, options);

        chunk.uploaded = true;
        return;
      } catch (error) {
        chunk.retries++;
        videoLogger.warn(
          { err: error, chunkIndex: chunk.index, attempt: chunk.retries },
          "Chunk upload failed"
        );

        if (chunk.retries >= maxRetries) {
          throw new Error(`Chunk ${chunk.index} failed after ${maxRetries} retries: ${error}`);
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, chunk.retries), 30000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private async uploadChunkToDestination(
    buffer: Buffer,
    chunk: UploadChunk,
    session: UploadSession,
    destination: UploadDestination,
    options: UploadOptions
  ): Promise<void> {
    switch (destination.type) {
      case "local":
        await this.uploadChunkLocal(buffer, chunk, session, destination);
        break;

      case "s3":
        await this.uploadChunkS3(buffer, chunk, session, destination, options);
        break;

      case "gcs":
        await this.uploadChunkGCS(buffer, chunk, session, destination, options);
        break;

      case "azure":
        await this.uploadChunkAzure(buffer, chunk, session, destination, options);
        break;

      case "youtube":
        await this.uploadChunkYouTube(buffer, chunk, session, destination, options);
        break;

      default:
        throw new Error(`Unsupported destination type: ${destination.type}`);
    }
  }

  private async uploadChunkLocal(
    buffer: Buffer,
    chunk: UploadChunk,
    session: UploadSession,
    destination: UploadDestination
  ): Promise<void> {
    const dir = destination.config.directory || this.tempDir;
    const tempFile = path.join(dir, `${session.sessionId}_chunk_${chunk.index}`);

    await fs.writeFile(tempFile, buffer);
  }

  private async uploadChunkS3(
    _buffer: Buffer,
    _chunk: UploadChunk,
    _session: UploadSession,
    _destination: UploadDestination,
    _options: UploadOptions
  ): Promise<void> {
    // This would integrate with AWS SDK
    // For now, simulate the upload
    await new Promise((resolve) => setTimeout(resolve, this.simulatedChunkDelayMs));
  }

  private async uploadChunkGCS(
    _buffer: Buffer,
    _chunk: UploadChunk,
    _session: UploadSession,
    _destination: UploadDestination,
    _options: UploadOptions
  ): Promise<void> {
    // This would integrate with Google Cloud Storage SDK
    // For now, simulate the upload
    await new Promise((resolve) => setTimeout(resolve, this.simulatedChunkDelayMs));
  }

  private async uploadChunkAzure(
    _buffer: Buffer,
    _chunk: UploadChunk,
    _session: UploadSession,
    _destination: UploadDestination,
    _options: UploadOptions
  ): Promise<void> {
    // This would integrate with Azure Storage SDK
    // For now, simulate the upload
    await new Promise((resolve) => setTimeout(resolve, this.simulatedChunkDelayMs));
  }

  private async uploadChunkYouTube(
    _buffer: Buffer,
    _chunk: UploadChunk,
    _session: UploadSession,
    _destination: UploadDestination,
    _options: UploadOptions
  ): Promise<void> {
    // This would integrate with YouTube resumable upload API
    // For now, simulate the upload
    await new Promise((resolve) => setTimeout(resolve, this.simulatedChunkDelayMs));
  }

  private async finalizeUpload(
    session: UploadSession,
    destination: UploadDestination,
    options: UploadOptions
  ): Promise<void> {
    switch (destination.type) {
      case "local":
        await this.finalizeLocalUpload(session, destination);
        break;

      case "s3":
        await this.finalizeS3Upload(session, destination);
        break;

      case "gcs":
        await this.finalizeGCSUpload(session, destination);
        break;

      case "azure":
        await this.finalizeAzureUpload(session, destination);
        break;

      case "youtube":
        await this.finalizeYouTubeUpload(session, destination);
        break;
    }

    // Send webhook notification if configured
    if (options.webhook && options.webhook.events.includes("completed")) {
      await this.sendWebhookNotification(session, "completed", options.webhook);
    }
  }

  private async finalizeLocalUpload(
    session: UploadSession,
    destination: UploadDestination
  ): Promise<void> {
    const dir = destination.config.directory || this.tempDir;
    const finalPath = path.join(dir, session.fileName);

    // Combine all chunks in order into a single buffer
    const chunks: Buffer[] = [];
    for (let i = 0; i < session.totalChunks; i++) {
      const chunkPath = path.join(dir, `${session.sessionId}_chunk_${i}`);
      const chunkData = await fs.readFile(chunkPath);
      chunks.push(chunkData);

      // Clean up chunk file
      await fs.unlink(chunkPath);
    }

    await fs.writeFile(finalPath, Buffer.concat(chunks));
    session.finalUrl = finalPath;
  }

  private async finalizeS3Upload(
    session: UploadSession,
    destination: UploadDestination
  ): Promise<void> {
    // Complete S3 multipart upload
    session.finalUrl = `s3://${destination.config.bucket}/${session.fileName}`;
  }

  private async finalizeGCSUpload(
    session: UploadSession,
    destination: UploadDestination
  ): Promise<void> {
    // Complete GCS resumable upload
    session.finalUrl = `gs://${destination.config.bucket}/${session.fileName}`;
  }

  private async finalizeAzureUpload(
    session: UploadSession,
    destination: UploadDestination
  ): Promise<void> {
    // Complete Azure blob upload
    session.finalUrl = `https://${destination.config.storageAccount}.blob.core.windows.net/${destination.config.containerName}/${session.fileName}`;
  }

  private async finalizeYouTubeUpload(
    session: UploadSession,
    _destination: UploadDestination
  ): Promise<void> {
    // Complete YouTube video upload
    session.finalUrl = `https://www.youtube.com/watch?v=${session.sessionId}`;
  }

  private async encryptChunk(
    buffer: Buffer,
    encryption: UploadOptions["encryption"]
  ): Promise<Buffer> {
    if (!encryption?.enabled) return buffer;

    const algorithm = encryption.algorithm || "aes-256-gcm";
    const key = Buffer.isBuffer(encryption.key)
      ? encryption.key
      : Buffer.from(encryption.key || crypto.randomBytes(32).toString("hex"), "hex");
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv(algorithm, key, iv);
    const encrypted = Buffer.concat([iv, cipher.update(buffer), cipher.final()]);
    return encrypted;
  }

  private async compressChunk(
    buffer: Buffer,
    compression: UploadOptions["compression"]
  ): Promise<Buffer> {
    if (!compression?.enabled) return buffer;

    // This would use a compression library like zlib
    // For now, return the original buffer
    return buffer;
  }

  private updateProgress(session: UploadSession, speed?: number, eta?: number): void {
    const callback = this.progressCallbacks.get(session.sessionId);
    if (!callback) return;

    const progress: UploadProgress = {
      sessionId: session.sessionId,
      totalBytes: session.fileSize,
      uploadedBytes: session.uploadedChunks * session.chunkSize,
      progress: session.progress,
      speed: speed || 0,
      eta: eta || 0,
      currentChunk: session.uploadedChunks,
      totalChunks: session.totalChunks,
      status: session.status,
      ...(session.error && { error: session.error }),
    };

    callback(progress);
  }

  private async sendWebhookNotification(
    session: UploadSession,
    event: string,
    webhook: NonNullable<UploadOptions["webhook"]>
  ): Promise<void> {
    try {
      const payload = {
        event,
        sessionId: session.sessionId,
        fileName: session.fileName,
        fileSize: session.fileSize,
        status: session.status,
        progress: session.progress,
        finalUrl: session.finalUrl,
        error: session.error,
        timestamp: new Date().toISOString(),
      };

      await fetch(webhook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...webhook.headers,
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      videoLogger.warn({ err: error }, "Failed to send webhook notification");
    }
  }

  private getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".mp4": "video/mp4",
      ".avi": "video/x-msvideo",
      ".mov": "video/quicktime",
      ".wmv": "video/x-ms-wmv",
      ".flv": "video/x-flv",
      ".webm": "video/webm",
      ".mkv": "video/x-matroska",
      ".m4v": "video/x-m4v",
    };

    return mimeTypes[ext] || "application/octet-stream";
  }

  private async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      videoLogger.warn({ err: error }, "Failed to create temp directory");
    }
  }
}
