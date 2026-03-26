/**
 * @file videoProcessorHelpers.test.ts
 * @description Mutation-killing tests for TikTok video processing helper functions.
 * All functions under test are pure (no external dependencies to mock).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  TIKTOK_VIDEO_SPECS,
  calculateAspectRatio,
  parseFrameRate,
  validateCompliance,
  calculateProcessingParameters,
  determineOptimizations,
} from "../src/videoProcessorHelpers.js";
import type {
  TikTokVideoAnalysis,
  TikTokVideoProcessingOptions,
} from "../src/videoProcessorTypes.js";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeAnalysis(overrides?: Partial<TikTokVideoAnalysis>): TikTokVideoAnalysis {
  return {
    fileName: "test.mp4",
    format: "mp4",
    duration: 30,
    fileSize: 10 * 1024 * 1024, // 10 MB
    resolution: { width: 1080, height: 1920 },
    aspectRatio: "9:16",
    frameRate: 30,
    bitRate: 5000,
    codec: "h264",
    audioCodec: "aac",
    audioChannels: 2,
    audioSampleRate: 48000,
    audioBitRate: 128,
    isCompliant: true,
    issues: [],
    recommendations: [],
    ...overrides,
  };
}

function makeOptions(
  overrides?: Partial<TikTokVideoProcessingOptions>
): TikTokVideoProcessingOptions {
  return { ...overrides };
}

// ---------------------------------------------------------------------------
// TIKTOK_VIDEO_SPECS constant
// ---------------------------------------------------------------------------

describe("TIKTOK_VIDEO_SPECS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 500MB for maxFileSize", () => {
    assert.strictEqual(TIKTOK_VIDEO_SPECS.maxFileSize, 500 * 1024 * 1024);
  });

  it("returns 180 for maxDuration", () => {
    assert.strictEqual(TIKTOK_VIDEO_SPECS.maxDuration, 180);
  });

  it("returns 3 for minDuration", () => {
    assert.strictEqual(TIKTOK_VIDEO_SPECS.minDuration, 3);
  });

  it("includes 9:16 1:1 and 16:9 aspect ratios", () => {
    const names = TIKTOK_VIDEO_SPECS.aspectRatios.map((r) => r.name);
    expect(names).toEqual(["9:16", "1:1", "16:9"]);
  });

  it("includes mp4 mov and webm formats", () => {
    expect(TIKTOK_VIDEO_SPECS.formats).toEqual(["mp4", "mov", "webm"]);
  });

  it("includes h264 h265 and vp9 codecs", () => {
    expect(TIKTOK_VIDEO_SPECS.codecs).toEqual(["h264", "h265", "vp9"]);
  });

  it("includes aac and mp3 audio codecs", () => {
    expect(TIKTOK_VIDEO_SPECS.audioCodecs).toEqual(["aac", "mp3"]);
  });

  it("includes expected audio sample rates", () => {
    expect(TIKTOK_VIDEO_SPECS.audioSampleRates).toEqual([44100, 48000]);
  });

  it("includes expected audio bit rates", () => {
    expect(TIKTOK_VIDEO_SPECS.audioBitRates).toEqual([128, 192, 256, 320]);
  });

  it("includes 4 resolution entries", () => {
    assert.strictEqual(TIKTOK_VIDEO_SPECS.resolutions.length, 4);
  });

  it("has 720p as first resolution entry", () => {
    expect(TIKTOK_VIDEO_SPECS.resolutions[0]).toEqual({
      width: 720,
      height: 1280,
      quality: "720p",
    });
  });
});

// ---------------------------------------------------------------------------
// calculateAspectRatio
// ---------------------------------------------------------------------------

describe("calculateAspectRatio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 9:16 for 1080x1920", () => {
    assert.strictEqual(calculateAspectRatio(1080, 1920), "9:16");
  });

  it("returns 16:9 for 1920x1080", () => {
    assert.strictEqual(calculateAspectRatio(1920, 1080), "16:9");
  });

  it("returns 1:1 for 1080x1080", () => {
    assert.strictEqual(calculateAspectRatio(1080, 1080), "1:1");
  });

  it("returns 4:3 for 640x480", () => {
    assert.strictEqual(calculateAspectRatio(640, 480), "4:3");
  });

  it("returns 3:4 for 480x640", () => {
    assert.strictEqual(calculateAspectRatio(480, 640), "3:4");
  });

  it("returns 16:9 for 3840x2160 (4K)", () => {
    assert.strictEqual(calculateAspectRatio(3840, 2160), "16:9");
  });

  it("returns 9:16 for 720x1280", () => {
    assert.strictEqual(calculateAspectRatio(720, 1280), "9:16");
  });

  it("returns 2:1 for 200x100", () => {
    assert.strictEqual(calculateAspectRatio(200, 100), "2:1");
  });

  it("returns 1:2 for 100x200", () => {
    assert.strictEqual(calculateAspectRatio(100, 200), "1:2");
  });

  it("returns n:1 when height is 1", () => {
    assert.strictEqual(calculateAspectRatio(7, 1), "7:1");
  });
});

// ---------------------------------------------------------------------------
// parseFrameRate
// ---------------------------------------------------------------------------

describe("parseFrameRate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 30 for fractional string 30/1", () => {
    assert.strictEqual(parseFrameRate("30/1"), 30);
  });

  it("returns 29.97 for fractional string 30000/1001", () => {
    const result = parseFrameRate("30000/1001");
    expect(result).toBeCloseTo(29.97, 1);
  });

  it("returns 24 for fractional string 24/1", () => {
    assert.strictEqual(parseFrameRate("24/1"), 24);
  });

  it("returns 23.976 for fractional string 24000/1001", () => {
    const result = parseFrameRate("24000/1001");
    expect(result).toBeCloseTo(23.976, 2);
  });

  it("returns 60 for plain string 60", () => {
    assert.strictEqual(parseFrameRate("60"), 60);
  });

  it("returns 29.97 for plain decimal string 29.97", () => {
    assert.strictEqual(parseFrameRate("29.97"), 29.97);
  });

  it("returns NaN for empty string", () => {
    expect(parseFrameRate("")).toBeNaN();
  });

  it("returns 15 for fractional string 15/1", () => {
    assert.strictEqual(parseFrameRate("15/1"), 15);
  });

  it("handles single-part non-numeric as NaN", () => {
    expect(parseFrameRate("abc")).toBeNaN();
  });
});

// ---------------------------------------------------------------------------
// validateCompliance
// ---------------------------------------------------------------------------

describe("validateCompliance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets isCompliant true when all specs are met", () => {
    const analysis = makeAnalysis();
    validateCompliance(analysis);
    assert.strictEqual(analysis.isCompliant, true);
    assert.strictEqual(analysis.issues.length, 0);
    assert.strictEqual(analysis.recommendations.length, 0);
  });

  // --- File size ---

  it("pushes error issue when fileSize exceeds maxFileSize", () => {
    const analysis = makeAnalysis({ fileSize: 600 * 1024 * 1024 });
    validateCompliance(analysis);
    assert.strictEqual(analysis.isCompliant, false);
    const issue = analysis.issues.find((i) => i.code === "FILE_SIZE_TOO_LARGE");
    assert.ok(issue, "Expected FILE_SIZE_TOO_LARGE issue");
    assert.strictEqual(issue.type, "error");
    expect(issue.message).toContain("exceeds maximum");
    expect(issue.suggestion).toContain("Compress");
  });

  it("remains compliant when fileSize equals exactly maxFileSize", () => {
    const analysis = makeAnalysis({ fileSize: 500 * 1024 * 1024 });
    validateCompliance(analysis);
    const sizeIssue = analysis.issues.find((i) => i.code === "FILE_SIZE_TOO_LARGE");
    assert.strictEqual(sizeIssue, undefined);
  });

  it("pushes error when fileSize is 1 byte over maxFileSize", () => {
    const analysis = makeAnalysis({ fileSize: 500 * 1024 * 1024 + 1 });
    validateCompliance(analysis);
    assert.strictEqual(analysis.isCompliant, false);
    assert.ok(analysis.issues.some((i) => i.code === "FILE_SIZE_TOO_LARGE"));
  });

  // --- Duration too long ---

  it("pushes error issue when duration exceeds maxDuration", () => {
    const analysis = makeAnalysis({ duration: 200 });
    validateCompliance(analysis);
    assert.strictEqual(analysis.isCompliant, false);
    const issue = analysis.issues.find((i) => i.code === "DURATION_TOO_LONG");
    assert.ok(issue, "Expected DURATION_TOO_LONG issue");
    assert.strictEqual(issue.type, "error");
    expect(issue.message).toContain("200s exceeds maximum 180s");
  });

  it("remains compliant when duration equals exactly maxDuration", () => {
    const analysis = makeAnalysis({ duration: 180 });
    validateCompliance(analysis);
    const durIssue = analysis.issues.find((i) => i.code === "DURATION_TOO_LONG");
    assert.strictEqual(durIssue, undefined);
  });

  it("pushes error when duration is 181", () => {
    const analysis = makeAnalysis({ duration: 181 });
    validateCompliance(analysis);
    assert.ok(analysis.issues.some((i) => i.code === "DURATION_TOO_LONG"));
    assert.strictEqual(analysis.isCompliant, false);
  });

  // --- Duration too short ---

  it("pushes error issue when duration is below minDuration", () => {
    const analysis = makeAnalysis({ duration: 2 });
    validateCompliance(analysis);
    assert.strictEqual(analysis.isCompliant, false);
    const issue = analysis.issues.find((i) => i.code === "DURATION_TOO_SHORT");
    assert.ok(issue, "Expected DURATION_TOO_SHORT issue");
    assert.strictEqual(issue.type, "error");
    expect(issue.message).toContain("2s is below minimum 3s");
  });

  it("remains compliant when duration equals exactly minDuration", () => {
    const analysis = makeAnalysis({ duration: 3 });
    validateCompliance(analysis);
    const shortIssue = analysis.issues.find((i) => i.code === "DURATION_TOO_SHORT");
    assert.strictEqual(shortIssue, undefined);
  });

  // --- Aspect ratio ---

  it("pushes warning issue when aspect ratio is unsupported", () => {
    const analysis = makeAnalysis({ aspectRatio: "4:3" });
    validateCompliance(analysis);
    const issue = analysis.issues.find((i) => i.code === "UNSUPPORTED_ASPECT_RATIO");
    assert.ok(issue, "Expected UNSUPPORTED_ASPECT_RATIO issue");
    assert.strictEqual(issue.type, "warning");
    expect(issue.message).toContain("4:3");
  });

  it("does not push aspect ratio warning for 9:16", () => {
    const analysis = makeAnalysis({ aspectRatio: "9:16" });
    validateCompliance(analysis);
    const issue = analysis.issues.find((i) => i.code === "UNSUPPORTED_ASPECT_RATIO");
    assert.strictEqual(issue, undefined);
  });

  it("does not push aspect ratio warning for 1:1", () => {
    const analysis = makeAnalysis({ aspectRatio: "1:1" });
    validateCompliance(analysis);
    const issue = analysis.issues.find((i) => i.code === "UNSUPPORTED_ASPECT_RATIO");
    assert.strictEqual(issue, undefined);
  });

  it("does not push aspect ratio warning for 16:9", () => {
    const analysis = makeAnalysis({ aspectRatio: "16:9" });
    validateCompliance(analysis);
    const issue = analysis.issues.find((i) => i.code === "UNSUPPORTED_ASPECT_RATIO");
    assert.strictEqual(issue, undefined);
  });

  // --- Format ---

  it("pushes warning issue when format is unsupported", () => {
    const analysis = makeAnalysis({ format: "avi" });
    validateCompliance(analysis);
    const issue = analysis.issues.find((i) => i.code === "UNSUPPORTED_FORMAT");
    assert.ok(issue, "Expected UNSUPPORTED_FORMAT issue");
    assert.strictEqual(issue.type, "warning");
    expect(issue.message).toContain("avi");
  });

  it("does not push format warning for mp4", () => {
    const analysis = makeAnalysis({ format: "mp4" });
    validateCompliance(analysis);
    assert.strictEqual(
      analysis.issues.find((i) => i.code === "UNSUPPORTED_FORMAT"),
      undefined
    );
  });

  it("does not push format warning for mov", () => {
    const analysis = makeAnalysis({ format: "mov" });
    validateCompliance(analysis);
    assert.strictEqual(
      analysis.issues.find((i) => i.code === "UNSUPPORTED_FORMAT"),
      undefined
    );
  });

  it("does not push format warning for webm", () => {
    const analysis = makeAnalysis({ format: "webm" });
    validateCompliance(analysis);
    assert.strictEqual(
      analysis.issues.find((i) => i.code === "UNSUPPORTED_FORMAT"),
      undefined
    );
  });

  it("handles format comparison case-insensitively", () => {
    const analysis = makeAnalysis({ format: "MP4" });
    validateCompliance(analysis);
    assert.strictEqual(
      analysis.issues.find((i) => i.code === "UNSUPPORTED_FORMAT"),
      undefined
    );
  });

  // --- Recommendations ---

  it("recommends vertical format when aspectRatio is not 9:16", () => {
    const analysis = makeAnalysis({ aspectRatio: "1:1" });
    validateCompliance(analysis);
    const rec = analysis.recommendations.find(
      (r) => r.optimization === "Convert to vertical format"
    );
    assert.ok(rec, "Expected vertical format recommendation");
    assert.strictEqual(rec.impact, "high");
  });

  it("does not recommend vertical format when aspectRatio is 9:16", () => {
    const analysis = makeAnalysis({ aspectRatio: "9:16" });
    validateCompliance(analysis);
    const rec = analysis.recommendations.find(
      (r) => r.optimization === "Convert to vertical format"
    );
    assert.strictEqual(rec, undefined);
  });

  it("recommends upscale when resolution height is below 1080", () => {
    const analysis = makeAnalysis({ resolution: { width: 720, height: 1079 } });
    validateCompliance(analysis);
    const rec = analysis.recommendations.find((r) => r.optimization === "Upscale to 1080p");
    assert.ok(rec, "Expected upscale recommendation");
    assert.strictEqual(rec.impact, "medium");
  });

  it("does not recommend upscale when resolution height is exactly 1080", () => {
    const analysis = makeAnalysis({ resolution: { width: 1080, height: 1080 } });
    validateCompliance(analysis);
    const rec = analysis.recommendations.find((r) => r.optimization === "Upscale to 1080p");
    assert.strictEqual(rec, undefined);
  });

  it("recommends frame rate increase when frameRate is below 30", () => {
    const analysis = makeAnalysis({ frameRate: 29 });
    validateCompliance(analysis);
    const rec = analysis.recommendations.find((r) => r.optimization === "Increase frame rate");
    assert.ok(rec, "Expected frame rate recommendation");
    assert.strictEqual(rec.impact, "low");
  });

  it("does not recommend frame rate increase when frameRate is exactly 30", () => {
    const analysis = makeAnalysis({ frameRate: 30 });
    validateCompliance(analysis);
    const rec = analysis.recommendations.find((r) => r.optimization === "Increase frame rate");
    assert.strictEqual(rec, undefined);
  });

  // --- Multiple issues ---

  it("accumulates multiple issues and sets isCompliant false", () => {
    const analysis = makeAnalysis({
      fileSize: 600 * 1024 * 1024,
      duration: 200,
      aspectRatio: "4:3",
      format: "avi",
      resolution: { width: 640, height: 480 },
      frameRate: 24,
    });
    validateCompliance(analysis);
    assert.strictEqual(analysis.isCompliant, false);
    // 2 errors + 2 warnings
    const errors = analysis.issues.filter((i) => i.type === "error");
    const warnings = analysis.issues.filter((i) => i.type === "warning");
    assert.strictEqual(errors.length, 2);
    assert.strictEqual(warnings.length, 2);
    // 3 recommendations
    assert.strictEqual(analysis.recommendations.length, 3);
  });

  it("sets isCompliant true when only warnings exist (no errors)", () => {
    const analysis = makeAnalysis({ aspectRatio: "4:3", format: "avi" });
    validateCompliance(analysis);
    // Warnings do not make isCompliant false
    assert.strictEqual(analysis.isCompliant, true);
    assert.ok(analysis.issues.length > 0);
  });

  it("sets isCompliant false with duration too short and too large file", () => {
    const analysis = makeAnalysis({
      fileSize: 600 * 1024 * 1024,
      duration: 1,
    });
    validateCompliance(analysis);
    assert.strictEqual(analysis.isCompliant, false);
    const codes = analysis.issues.map((i) => i.code);
    expect(codes).toContain("FILE_SIZE_TOO_LARGE");
    expect(codes).toContain("DURATION_TOO_SHORT");
  });
});

// ---------------------------------------------------------------------------
// determineOptimizations
// ---------------------------------------------------------------------------

describe("determineOptimizations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no optimizations needed", () => {
    const analysis = makeAnalysis();
    const result = determineOptimizations(analysis, makeOptions());
    expect(result).toEqual([]);
  });

  it("includes compress when fileSize exceeds 80% of maxFileSize", () => {
    const threshold = TIKTOK_VIDEO_SPECS.maxFileSize * 0.8;
    const analysis = makeAnalysis({ fileSize: threshold + 1 });
    const result = determineOptimizations(analysis, makeOptions());
    expect(result).toContain("compress");
  });

  it("does not include compress when fileSize equals exactly 80% of maxFileSize", () => {
    const threshold = TIKTOK_VIDEO_SPECS.maxFileSize * 0.8;
    const analysis = makeAnalysis({ fileSize: threshold });
    const result = determineOptimizations(analysis, makeOptions());
    expect(result).not.toContain("compress");
  });

  it("includes crop when aspectRatio differs from target", () => {
    const analysis = makeAnalysis({ aspectRatio: "1:1" });
    const result = determineOptimizations(analysis, makeOptions({ targetAspectRatio: "9:16" }));
    expect(result).toContain("crop");
  });

  it("does not include crop when aspectRatio matches target", () => {
    const analysis = makeAnalysis({ aspectRatio: "9:16" });
    const result = determineOptimizations(analysis, makeOptions({ targetAspectRatio: "9:16" }));
    expect(result).not.toContain("crop");
  });

  it("includes crop when aspectRatio differs from default 9:16 and no target specified", () => {
    const analysis = makeAnalysis({ aspectRatio: "16:9" });
    const result = determineOptimizations(analysis, makeOptions());
    expect(result).toContain("crop");
  });

  it("does not include crop when aspectRatio is 9:16 and no target specified", () => {
    const analysis = makeAnalysis({ aspectRatio: "9:16" });
    const result = determineOptimizations(analysis, makeOptions());
    expect(result).not.toContain("crop");
  });

  it("includes upscale when resolution height is below 1080", () => {
    const analysis = makeAnalysis({ resolution: { width: 720, height: 1079 } });
    const result = determineOptimizations(analysis, makeOptions());
    expect(result).toContain("upscale");
  });

  it("does not include upscale when resolution height is exactly 1080", () => {
    const analysis = makeAnalysis({ resolution: { width: 1080, height: 1080 } });
    const result = determineOptimizations(analysis, makeOptions());
    expect(result).not.toContain("upscale");
  });

  it("includes interpolate when frameRate is below 30", () => {
    const analysis = makeAnalysis({ frameRate: 29 });
    const result = determineOptimizations(analysis, makeOptions());
    expect(result).toContain("interpolate");
  });

  it("does not include interpolate when frameRate is exactly 30", () => {
    const analysis = makeAnalysis({ frameRate: 30 });
    const result = determineOptimizations(analysis, makeOptions());
    expect(result).not.toContain("interpolate");
  });

  it("includes enhance-audio when enhanceAudio option is true", () => {
    const analysis = makeAnalysis();
    const result = determineOptimizations(analysis, makeOptions({ enhanceAudio: true }));
    expect(result).toContain("enhance-audio");
  });

  it("does not include enhance-audio when enhanceAudio option is false", () => {
    const analysis = makeAnalysis();
    const result = determineOptimizations(analysis, makeOptions({ enhanceAudio: false }));
    expect(result).not.toContain("enhance-audio");
  });

  it("does not include enhance-audio when enhanceAudio option is undefined", () => {
    const analysis = makeAnalysis();
    const result = determineOptimizations(analysis, makeOptions());
    expect(result).not.toContain("enhance-audio");
  });

  it("includes color-correction when colorCorrection option is truthy", () => {
    const analysis = makeAnalysis();
    const result = determineOptimizations(
      analysis,
      makeOptions({ colorCorrection: { brightness: 1.0 } })
    );
    expect(result).toContain("color-correction");
  });

  it("does not include color-correction when colorCorrection option is undefined", () => {
    const analysis = makeAnalysis();
    const result = determineOptimizations(analysis, makeOptions());
    expect(result).not.toContain("color-correction");
  });

  it("returns all optimizations when all conditions are met", () => {
    const analysis = makeAnalysis({
      fileSize: TIKTOK_VIDEO_SPECS.maxFileSize * 0.9,
      aspectRatio: "4:3",
      resolution: { width: 640, height: 480 },
      frameRate: 24,
    });
    const options = makeOptions({
      targetAspectRatio: "9:16",
      enhanceAudio: true,
      colorCorrection: { brightness: 1.2 },
    });
    const result = determineOptimizations(analysis, options);
    expect(result).toEqual([
      "compress",
      "crop",
      "upscale",
      "interpolate",
      "enhance-audio",
      "color-correction",
    ]);
  });
});

// ---------------------------------------------------------------------------
// calculateProcessingParameters
// ---------------------------------------------------------------------------

describe("calculateProcessingParameters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns default 9:16 1080p resolution when no target specified", () => {
    const analysis = makeAnalysis();
    const result = calculateProcessingParameters(analysis, makeOptions());
    expect(result.resolution).toEqual({ width: 1080, height: 1920 });
    assert.strictEqual(result.aspectRatio, "9:16");
  });

  it("returns 1080x1080 when targetAspectRatio is 1:1", () => {
    const analysis = makeAnalysis();
    const result = calculateProcessingParameters(
      analysis,
      makeOptions({ targetAspectRatio: "1:1" })
    );
    expect(result.resolution).toEqual({ width: 1080, height: 1080 });
    assert.strictEqual(result.aspectRatio, "1:1");
  });

  it("returns 1920x1080 when targetAspectRatio is 16:9", () => {
    const analysis = makeAnalysis();
    const result = calculateProcessingParameters(
      analysis,
      makeOptions({ targetAspectRatio: "16:9" })
    );
    expect(result.resolution).toEqual({ width: 1920, height: 1080 });
    assert.strictEqual(result.aspectRatio, "16:9");
  });

  it("returns 9:16 1080p when targetAspectRatio is 9:16", () => {
    const analysis = makeAnalysis();
    const result = calculateProcessingParameters(
      analysis,
      makeOptions({ targetAspectRatio: "9:16" })
    );
    expect(result.resolution).toEqual({ width: 1080, height: 1920 });
    assert.strictEqual(result.aspectRatio, "9:16");
  });

  it("scales default 9:16 resolution to 720p", () => {
    const analysis = makeAnalysis();
    const result = calculateProcessingParameters(
      analysis,
      makeOptions({ targetResolution: "720p" })
    );
    // 1080 * 0.75 = 810, 1920 * 0.75 = 1440
    expect(result.resolution).toEqual({ width: 810, height: 1440 });
  });

  it("scales 1:1 resolution to 720p", () => {
    const analysis = makeAnalysis();
    const result = calculateProcessingParameters(
      analysis,
      makeOptions({ targetAspectRatio: "1:1", targetResolution: "720p" })
    );
    // 1080 * 0.75 = 810
    expect(result.resolution).toEqual({ width: 810, height: 810 });
  });

  it("scales 16:9 resolution to 720p", () => {
    const analysis = makeAnalysis();
    const result = calculateProcessingParameters(
      analysis,
      makeOptions({ targetAspectRatio: "16:9", targetResolution: "720p" })
    );
    // 1920 * 0.75 = 1440, 1080 * 0.75 = 810
    expect(result.resolution).toEqual({ width: 1440, height: 810 });
  });

  it("returns mp4 format by default when no targetFormat specified", () => {
    const analysis = makeAnalysis();
    const result = calculateProcessingParameters(analysis, makeOptions());
    assert.strictEqual(result.format, "mp4");
  });

  it("returns specified targetFormat", () => {
    const analysis = makeAnalysis();
    const result = calculateProcessingParameters(analysis, makeOptions({ targetFormat: "webm" }));
    assert.strictEqual(result.format, "webm");
  });

  it("returns h264 codec by default when no targetCodec specified", () => {
    const analysis = makeAnalysis();
    const result = calculateProcessingParameters(analysis, makeOptions());
    assert.strictEqual(result.codec, "h264");
  });

  it("returns specified targetCodec", () => {
    const analysis = makeAnalysis();
    const result = calculateProcessingParameters(analysis, makeOptions({ targetCodec: "vp9" }));
    assert.strictEqual(result.codec, "vp9");
  });

  it("returns high quality by default when no quality specified", () => {
    const analysis = makeAnalysis();
    const result = calculateProcessingParameters(analysis, makeOptions());
    assert.strictEqual(result.quality, "high");
  });

  it("returns specified quality", () => {
    const analysis = makeAnalysis();
    const result = calculateProcessingParameters(analysis, makeOptions({ quality: "low" }));
    assert.strictEqual(result.quality, "low");
  });

  it("includes optimizations array from determineOptimizations", () => {
    const analysis = makeAnalysis({ frameRate: 20 });
    const result = calculateProcessingParameters(analysis, makeOptions());
    expect(result.optimizations).toContain("interpolate");
  });

  it("returns empty optimizations when analysis is optimal", () => {
    const analysis = makeAnalysis();
    const result = calculateProcessingParameters(analysis, makeOptions());
    expect(result.optimizations).toEqual([]);
  });
});
