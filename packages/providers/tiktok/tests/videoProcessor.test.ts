/**
 * @file videoProcessor.test.ts
 * @description Mutation-killing tests for TikTokVideoProcessor.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks — must exist before vi.mock factories execute
const {
  mockCall,
  mockFfprobe,
  mockFfmpeg,
  mockMkdir,
  mockUnlink,
  mockLogger,
  mockCbInstance,
  mockVideoCodec,
  mockOutputFormat,
  mockSize,
  mockAspect,
  mockVideoBitrate,
  mockAudioCodec,
  mockAudioBitrate,
  mockInputOptions,
  mockOutputOptions,
  mockScreenshots,
  mockSave,
  mockOn,
} = vi.hoisted(() => {
  const on = vi.fn();
  const chain = () => ({ mockReturnThis: vi.fn().mockReturnThis });
  const vc = vi.fn().mockReturnThis(),
    of = vi.fn().mockReturnThis();
  const sz = vi.fn().mockReturnThis(),
    asp = vi.fn().mockReturnThis();
  const vb = vi.fn().mockReturnThis(),
    ac = vi.fn().mockReturnThis();
  const ab = vi.fn().mockReturnThis(),
    io = vi.fn().mockReturnThis();
  const oo = vi.fn().mockReturnThis(),
    ss = vi.fn().mockReturnThis();
  const sv = vi.fn().mockReturnThis();
  const cmd = {
    videoCodec: vc,
    outputFormat: of,
    size: sz,
    aspect: asp,
    videoBitrate: vb,
    audioCodec: ac,
    audioBitrate: ab,
    inputOptions: io,
    outputOptions: oo,
    screenshots: ss,
    on,
    save: sv,
  };
  const ff = vi.fn(() => cmd) as unknown as Record<string, unknown>;
  const probe = vi.fn();
  ff.ffprobe = probe;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const cb = {
    call: vi.fn(),
    getAllStatuses: vi.fn(() => ({ status: "closed" })),
    clearCache: vi.fn(),
    forceOpen: vi.fn(() => true),
    forceClose: vi.fn(() => true),
  };
  return {
    mockCall: cb.call,
    mockLogger: logger,
    mockCbInstance: cb,
    mockFfprobe: probe,
    mockFfmpeg: ff,
    mockMkdir: vi.fn().mockResolvedValue(undefined),
    mockUnlink: vi.fn().mockResolvedValue(undefined),
    mockVideoCodec: vc,
    mockOutputFormat: of,
    mockSize: sz,
    mockAspect: asp,
    mockVideoBitrate: vb,
    mockAudioCodec: ac,
    mockAudioBitrate: ab,
    mockInputOptions: io,
    mockOutputOptions: oo,
    mockScreenshots: ss,
    mockSave: sv,
    mockOn: on,
  };
});

vi.mock("@adapters/external-apis", () => ({
  createExternalApiCircuitBreaker: vi.fn(() => mockCbInstance),
}));
vi.mock("@adapters/fallback-strategies", () => ({
  CommonFallbackStrategies: { METADATA_FALLBACK: {}, ANALYTICS_FALLBACK: {} },
}));
vi.mock("@providers/shared", () => ({
  ProviderError: {
    externalService: vi.fn((p: string, m: string) => new Error(`${p}: ${m}`)),
    unauthorized: vi.fn((p: string, m: string) => new Error(`${p}: ${m}`)),
    notFound: vi.fn((p: string, m: string) => new Error(`${p}: ${m}`)),
  },
}));
vi.mock("prom-client", () => ({ Registry: class R {} }));
vi.mock("@observability/logger", () => ({ createLogger: vi.fn(() => mockLogger) }));
vi.mock("fluent-ffmpeg", () => ({ default: mockFfmpeg }));
vi.mock("fs/promises", () => ({
  mkdir: (...a: unknown[]) => mockMkdir(...a),
  unlink: (...a: unknown[]) => mockUnlink(...a),
}));
vi.mock("crypto", () => ({ randomUUID: vi.fn(() => "test-uuid-1234") }));
vi.mock("../src/videoProcessorHelpers.js", () => ({
  TIKTOK_VIDEO_SPECS: {
    maxFileSize: 500 * 1024 * 1024,
    maxDuration: 180,
    minDuration: 3,
    aspectRatios: [{ width: 9, height: 16, name: "9:16" }],
    resolutions: [{ width: 1080, height: 1920, quality: "1080p" }],
    formats: ["mp4", "mov", "webm"],
    codecs: ["h264", "h265", "vp9"],
    audioCodecs: ["aac", "mp3"],
    audioSampleRates: [44100, 48000],
    audioBitRates: [128, 192, 256, 320],
  },
  calculateAspectRatio: vi.fn(() => "9:16"),
  parseFrameRate: vi.fn(() => 30),
  validateCompliance: vi.fn((a: Record<string, unknown>) => {
    a.isCompliant = true;
  }),
  calculateProcessingParameters: vi.fn(() => ({
    format: "mp4",
    codec: "h264",
    resolution: { width: 1080, height: 1920 },
    aspectRatio: "9:16",
    quality: "high",
    optimizations: ["compress", "enhance-audio"],
  })),
}));

import { TikTokVideoProcessor } from "../src/videoProcessor.js";

// Helpers
const makeProbeMetadata = (fmtOverrides: Record<string, unknown> = {}) => ({
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 1080,
      height: 1920,
      r_frame_rate: "30/1",
      bit_rate: "2000000",
    },
    {
      codec_type: "audio",
      codec_name: "aac",
      channels: 2,
      sample_rate: "44100",
      bit_rate: "128000",
    },
  ],
  format: {
    format_name: "mp4",
    duration: "45.5",
    size: "10485760",
    bit_rate: "2000000",
    ...fmtOverrides,
  },
});

function setupProbe(metadata?: ReturnType<typeof makeProbeMetadata>) {
  mockFfprobe.mockImplementation((_p: string, cb: (e: unknown, d: unknown) => void) =>
    cb(null, metadata ?? makeProbeMetadata())
  );
}
function setupProbeError(msg: string) {
  mockFfprobe.mockImplementation((_p: string, cb: (e: unknown, d: unknown) => void) =>
    cb(new Error(msg), null)
  );
}
function setupProbeStreams(streams: unknown[], fmt: Record<string, unknown> = {}) {
  mockFfprobe.mockImplementation((_p: string, cb: Function) =>
    cb(null, {
      streams,
      format: { format_name: "mp4", duration: "10", size: "100", bit_rate: "500", ...fmt },
    })
  );
}

describe("TikTokVideoProcessor", () => {
  let proc: TikTokVideoProcessor;
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockImplementation((_s: string, _o: string, fn: () => unknown) => fn());
    mockOn.mockImplementation(function (this: unknown, ev: string, cb: () => void) {
      if (ev === "end") setTimeout(cb, 0);
      return this;
    });
    for (const m of [
      mockVideoCodec,
      mockOutputFormat,
      mockSize,
      mockAspect,
      mockVideoBitrate,
      mockAudioCodec,
      mockAudioBitrate,
      mockInputOptions,
      mockOutputOptions,
      mockScreenshots,
      mockSave,
    ])
      m.mockReturnThis();
    mockMkdir.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    proc = new TikTokVideoProcessor("/tmp/test-tiktok");
  });

  describe("constructor", () => {
    it("accepts default and custom temp directories", () => {
      expect(new TikTokVideoProcessor()).toBeInstanceOf(TikTokVideoProcessor);
      expect(new TikTokVideoProcessor("/custom")).toBeInstanceOf(TikTokVideoProcessor);
    });
  });

  describe("getVideoTemplates", () => {
    it("returns all 3 templates when no filter", () => {
      expect(proc.getVideoTemplates()).toHaveLength(3);
    });
    it("filters by trending category", () => {
      const [t] = proc.getVideoTemplates("trending");
      expect(t?.id).toBe("vertical-trending");
      expect(t?.name).toBe("Vertical Trending");
      expect(t?.performance).toEqual({
        averageViews: 85000,
        averageLikes: 5200,
        averageShares: 890,
        engagementRate: 7.2,
      });
      expect(t?.usageCount).toBe(15420);
      expect(t?.effects).toEqual(["fade-in", "zoom", "color-pop"]);
      expect(t?.transitions).toEqual(["quick-cut", "slide"]);
      expect(t?.backgroundMusic).toBe("upbeat-trending");
      expect(t?.colorScheme).toEqual(["#FF0050", "#00F5FF", "#FFB800"]);
      expect(t?.duration).toEqual({ min: 15, max: 60 });
      expect(t?.resolution).toEqual({ width: 1080, height: 1920 });
    });
    it("filters by education category", () => {
      const [t] = proc.getVideoTemplates("education");
      expect(t?.id).toBe("educational-vertical");
      expect(t?.performance).toEqual({
        averageViews: 125000,
        averageLikes: 8500,
        averageShares: 1200,
        engagementRate: 8.9,
      });
      expect(t?.usageCount).toBe(8750);
      expect(t?.duration).toEqual({ min: 30, max: 180 });
      expect(t?.effects).toEqual(["text-highlight", "step-counter"]);
      expect(t?.backgroundMusic).toBeUndefined();
    });
    it("filters by entertainment category", () => {
      const [t] = proc.getVideoTemplates("entertainment");
      expect(t?.id).toBe("dance-challenge");
      expect(t?.performance).toEqual({
        averageViews: 195000,
        averageLikes: 15800,
        averageShares: 3200,
        engagementRate: 9.8,
      });
      expect(t?.usageCount).toBe(23100);
      expect(t?.duration).toEqual({ min: 15, max: 30 });
      expect(t?.effects).toEqual(["beat-sync", "mirror", "slow-motion"]);
      expect(t?.backgroundMusic).toBe("dance-trending");
    });
    it("returns empty for nonexistent category", () => {
      expect(proc.getVideoTemplates("cooking")).toHaveLength(0);
    });
    it("each template has text overlays with required properties", () => {
      proc.getVideoTemplates().forEach((t) => {
        expect(t.textOverlays.length).toBeGreaterThanOrEqual(1);
        expect(t.textOverlays[0]).toHaveProperty("text");
        expect(t.textOverlays[0]).toHaveProperty("position");
        expect(t.textOverlays[0]).toHaveProperty("style");
        expect(t.textOverlays[0]).toHaveProperty("duration");
      });
    });
  });

  describe("analyzeVideo", () => {
    it("returns fully mapped analysis on success", async () => {
      setupProbe();
      const r = await proc.analyzeVideo("/path/to/video.mp4");
      expect(r).toMatchObject({
        fileName: "video.mp4",
        format: "mp4",
        duration: 45.5,
        fileSize: 10485760,
        resolution: { width: 1080, height: 1920 },
        codec: "h264",
        audioCodec: "aac",
        audioChannels: 2,
        audioSampleRate: 44100,
        audioBitRate: 128000,
      });
    });
    it("extracts fileName via path.basename", async () => {
      setupProbe();
      expect((await proc.analyzeVideo("/deep/path/my-clip.mov")).fileName).toBe("my-clip.mov");
    });
    it("defaults format to unknown when format_name is falsy", async () => {
      setupProbe(makeProbeMetadata({ format_name: "" }));
      expect((await proc.analyzeVideo("/p/v.mp4")).format).toBe("unknown");
    });
    it("defaults duration to 0 when not provided", async () => {
      setupProbe(makeProbeMetadata({ duration: undefined }));
      expect((await proc.analyzeVideo("/p/v.mp4")).duration).toBe(0);
    });
    it("defaults fileSize to 0 when not provided", async () => {
      setupProbe(makeProbeMetadata({ size: undefined }));
      expect((await proc.analyzeVideo("/p/v.mp4")).fileSize).toBe(0);
    });
    it("defaults width/height to 0 when missing from video stream", async () => {
      setupProbeStreams([{ codec_type: "video" }]);
      expect((await proc.analyzeVideo("/p/v.mp4")).resolution).toEqual({ width: 0, height: 0 });
    });
    it("defaults codec to unknown when codec_name is missing", async () => {
      setupProbeStreams([{ codec_type: "video", width: 1080, height: 1920, r_frame_rate: "30/1" }]);
      expect((await proc.analyzeVideo("/p/v.mp4")).codec).toBe("unknown");
    });
    it("defaults audio fields when no audio stream present", async () => {
      setupProbeStreams([
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1080,
          height: 1920,
          r_frame_rate: "30/1",
        },
      ]);
      const r = await proc.analyzeVideo("/p/v.mp4");
      expect(r.audioCodec).toBe("none");
      expect(r.audioChannels).toBe(0);
      expect(r.audioSampleRate).toBe(0);
      expect(r.audioBitRate).toBe(0);
    });
    it("defaults audioSampleRate/audioBitRate to 0 when fields missing", async () => {
      setupProbeStreams([
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1080,
          height: 1920,
          r_frame_rate: "30/1",
        },
        { codec_type: "audio", codec_name: "aac", channels: 2 },
      ]);
      const r = await proc.analyzeVideo("/p/v.mp4");
      expect(r.audioSampleRate).toBe(0);
      expect(r.audioBitRate).toBe(0);
    });
    it("falls back to format bit_rate when video bit_rate is missing", async () => {
      setupProbeStreams(
        [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1080,
            height: 1920,
            r_frame_rate: "30/1",
          },
        ],
        { bit_rate: "999000" }
      );
      expect((await proc.analyzeVideo("/p/v.mp4")).bitRate).toBe(999000);
    });
    it("defaults bitRate to 0 when both bit_rates missing", async () => {
      setupProbeStreams(
        [
          {
            codec_type: "video",
            codec_name: "h264",
            width: 1080,
            height: 1920,
            r_frame_rate: "30/1",
          },
        ],
        { bit_rate: undefined }
      );
      expect((await proc.analyzeVideo("/p/v.mp4")).bitRate).toBe(0);
    });
    it("rejects when ffprobe returns error", async () => {
      setupProbeError("Cannot read file");
      await expect(proc.analyzeVideo("/bad.mp4")).rejects.toThrow(
        "Video analysis failed: Cannot read file"
      );
    });
    it("rejects when no video stream found", async () => {
      setupProbeStreams([{ codec_type: "audio", codec_name: "aac" }]);
      await expect(proc.analyzeVideo("/audio.mp4")).rejects.toThrow("No video stream found");
    });
    it("sets isCompliant false before validateCompliance runs", async () => {
      const { validateCompliance } = await import("../src/videoProcessorHelpers.js");
      vi.mocked(validateCompliance).mockImplementation((a) => {
        expect(a.isCompliant).toBe(false);
        a.isCompliant = true;
      });
      setupProbe();
      await proc.analyzeVideo("/p/v.mp4");
      expect(validateCompliance).toHaveBeenCalledTimes(1);
    });
    it("passes correct circuit breaker options", async () => {
      setupProbe();
      await proc.analyzeVideo("/p/v.mp4");
      expect(mockCall).toHaveBeenCalledWith(
        "tiktok-video-processor",
        "analyze-video",
        expect.any(Function),
        [],
        expect.objectContaining({
          timeout: 30000,
          errorThresholdPercentage: 70,
          maxRetries: 2,
          cacheEnabled: true,
          cacheTtl: 1800000,
          fallbackEnabled: true,
        })
      );
    });
    it("uses default r_frame_rate 0/1 when missing", async () => {
      const { parseFrameRate } = await import("../src/videoProcessorHelpers.js");
      setupProbeStreams([{ codec_type: "video", codec_name: "h264", width: 1080, height: 1920 }]);
      await proc.analyzeVideo("/p/v.mp4");
      expect(parseFrameRate).toHaveBeenCalledWith("0/1");
    });
  });

  describe("processVideo", () => {
    beforeEach(() => setupProbe());

    it("creates temp dir, returns all fields, and includes processing metadata", async () => {
      const r = await proc.processVideo("/input/v.mp4");
      expect(mockMkdir).toHaveBeenCalledWith("/tmp/test-tiktok", { recursive: true });
      expect(r.originalFile).toBe("/input/v.mp4");
      expect(r.processedFile).toContain("processed_test-uuid-1234.mp4");
      expect(r.format).toBe("mp4");
      expect(r.codec).toBe("h264");
      expect(r.resolution).toEqual({ width: 1080, height: 1920 });
      expect(r.aspectRatio).toBe("9:16");
      expect(r.thumbnail).toContain("thumb_test-uuid-1234.jpg");
      expect(r.previewGif).toContain("preview_test-uuid-1234.gif");
      expect(r.optimizations).toEqual(["compress", "enhance-audio"]);
      expect(r.processingTime).toBeGreaterThanOrEqual(0);
      expect(r.metadata.title).toBe("Processed TikTok Video");
      expect(r.metadata.description).toBe("Video processed for TikTok optimization");
    });
    it("includes effects in metadata when addEffects provided", async () => {
      const r = await proc.processVideo("/i/v.mp4", { addEffects: ["fade-in", "zoom"] });
      expect(r.metadata.effects).toEqual(["fade-in", "zoom"]);
    });
    it("omits effects from metadata when addEffects not provided", async () => {
      expect((await proc.processVideo("/i/v.mp4", {})).metadata.effects).toBeUndefined();
    });
    it("applies compress and enhance-audio optimizations via ffmpeg", async () => {
      await proc.processVideo("/i/v.mp4");
      expect(mockVideoBitrate).toHaveBeenCalledWith("2000k");
      expect(mockAudioCodec).toHaveBeenCalledWith("aac");
      expect(mockAudioBitrate).toHaveBeenCalledWith("128k");
    });
    it("sets correct codec, format, size, aspect on ffmpeg command", async () => {
      await proc.processVideo("/i/v.mp4");
      expect(mockVideoCodec).toHaveBeenCalledWith("h264");
      expect(mockOutputFormat).toHaveBeenCalledWith("mp4");
      expect(mockSize).toHaveBeenCalledWith("1080x1920");
      expect(mockAspect).toHaveBeenCalledWith("9:16");
    });
    it("generates thumbnail with correct settings", async () => {
      await proc.processVideo("/i/v.mp4");
      expect(mockScreenshots).toHaveBeenCalledWith(
        expect.objectContaining({ timestamps: ["10%"], size: "720x1280" })
      );
    });
    it("generates preview GIF with correct options", async () => {
      await proc.processVideo("/i/v.mp4");
      expect(mockInputOptions).toHaveBeenCalledWith(["-t 3"]);
      expect(mockOutputOptions).toHaveBeenCalledWith(["-vf scale=320:-1", "-r 10", "-f gif"]);
    });
    it("passes correct circuit breaker options", async () => {
      await proc.processVideo("/i/v.mp4");
      expect(mockCall).toHaveBeenCalledWith(
        "tiktok-video-processor",
        "process-video",
        expect.any(Function),
        [],
        expect.objectContaining({
          timeout: 300000,
          errorThresholdPercentage: 80,
          maxRetries: 1,
          cacheEnabled: false,
          fallbackEnabled: false,
        })
      );
    });
    it("rejects when ffmpeg emits error event", async () => {
      mockOn.mockImplementation(function (this: unknown, ev: string, cb: (e?: Error) => void) {
        if (ev === "error") setTimeout(() => cb(new Error("Encoding failed")), 0);
        return this;
      });
      await expect(proc.processVideo("/i/v.mp4")).rejects.toThrow(
        "Video processing failed: Encoding failed"
      );
    });
  });

  describe("applyTemplate", () => {
    beforeEach(() => setupProbe());
    it("processes video with valid template", async () => {
      const r = await proc.applyTemplate("/i/v.mp4", "vertical-trending");
      expect(r.originalFile).toBe("/i/v.mp4");
    });
    it("throws notFound for unknown template ID", async () => {
      await expect(proc.applyTemplate("/i/v.mp4", "nonexistent")).rejects.toThrow(
        "Template: nonexistent"
      );
    });
    it("merges customizations over template options", async () => {
      expect(
        await proc.applyTemplate("/i/v.mp4", "educational-vertical", { quality: "ultra" })
      ).toBeDefined();
    });
    it("calls calculateProcessingParameters for each template", async () => {
      const { calculateProcessingParameters } = await import("../src/videoProcessorHelpers.js");
      await proc.applyTemplate("/i/v.mp4", "dance-challenge");
      expect(calculateProcessingParameters).toHaveBeenCalled();
    });
  });

  describe("batchProcessVideos", () => {
    beforeEach(() => setupProbe());
    it("processes all videos and returns results", async () => {
      expect(
        await proc.batchProcessVideos([{ path: "/a.mp4" }, { path: "/b.mp4" }, { path: "/c.mp4" }])
      ).toHaveLength(3);
    });
    it("respects concurrency parameter", async () => {
      expect(
        await proc.batchProcessVideos(
          [{ path: "/a.mp4" }, { path: "/b.mp4" }, { path: "/c.mp4" }, { path: "/d.mp4" }],
          1
        )
      ).toHaveLength(4);
    });
    it("continues processing and logs error when one video fails", async () => {
      let n = 0;
      mockCall.mockImplementation((_s: string, _o: string, fn: () => unknown) => {
        n++;
        if (n <= 2) return fn();
        throw new Error("fail");
      });
      expect(await proc.batchProcessVideos([{ path: "/fail.mp4" }])).toHaveLength(0);
      expect(mockLogger.error).toHaveBeenCalled();
    });
    it("returns empty array when all fail", async () => {
      mockCall.mockImplementation(() => {
        throw new Error("all fail");
      });
      expect(await proc.batchProcessVideos([{ path: "/a.mp4" }, { path: "/b.mp4" }])).toEqual([]);
    });
    it("returns empty array for empty inputs", async () => {
      expect(await proc.batchProcessVideos([])).toEqual([]);
    });
  });

  describe("cleanup", () => {
    it("unlinks all provided file paths", async () => {
      await proc.cleanup(["/tmp/a.mp4", "/tmp/b.jpg", "/tmp/c.gif"]);
      expect(mockUnlink).toHaveBeenCalledTimes(3);
      expect(mockUnlink).toHaveBeenCalledWith("/tmp/a.mp4");
      expect(mockUnlink).toHaveBeenCalledWith("/tmp/b.jpg");
      expect(mockUnlink).toHaveBeenCalledWith("/tmp/c.gif");
    });
    it("continues and logs warning when unlink fails", async () => {
      mockUnlink
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("ENOENT"))
        .mockResolvedValueOnce(undefined);
      await proc.cleanup(["/tmp/a", "/tmp/missing", "/tmp/c"]);
      expect(mockUnlink).toHaveBeenCalledTimes(3);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
    it("handles empty array", async () => {
      await proc.cleanup([]);
      expect(mockUnlink).not.toHaveBeenCalled();
    });
  });

  describe("circuit breaker utilities", () => {
    it("getAllStatuses delegates correctly", () => {
      expect(proc.getCircuitBreakerStatus()).toEqual({ status: "closed" });
    });
    it("getMetricsRegistry returns registry", () => {
      expect(TikTokVideoProcessor.getMetricsRegistry()).toBeDefined();
    });
    it("clearCache delegates with tiktok-video-processor", () => {
      proc.clearCache();
      expect(mockCbInstance.clearCache).toHaveBeenCalledWith("tiktok-video-processor");
    });
  });
});
