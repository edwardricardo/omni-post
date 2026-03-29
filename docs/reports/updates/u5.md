# Update Session U5 — fluent-ffmpeg Replacement

Date: 2026-03-26

## Replacement Strategy

**Approach chosen:** Option A — Full replacement with `child_process.execFile` (promisified)

**Reason:** fluent-ffmpeg is archived (May 2025) and deprecated on npm. Both Instagram and TikTok providers use heavy transcoding (Class B), not just metadata. Direct ffmpeg/ffprobe CLI calls via `execFileAsync` are more maintainable, have zero deprecated dependencies, and produce identical output.

## Usage Found

| File                                      | Operations Used                                                            | Class |
| ----------------------------------------- | -------------------------------------------------------------------------- | ----- |
| providers/instagram/src/mediaProcessor.ts | ffprobe (metadata), transcode (H.264/AAC), thumbnail, reels optimization   | A+B+C |
| providers/tiktok/src/videoProcessor.ts    | ffprobe (analysis), transcode (configurable codec), thumbnail, preview GIF | A+B+C |

## Packages Removed

| Package              | Version | Removed From                  |
| -------------------- | ------- | ----------------------------- |
| fluent-ffmpeg        | 2.1.2   | @providers/instagram          |
| fluent-ffmpeg        | 2.1.3   | @providers/tiktok             |
| @types/fluent-ffmpeg | 2.1.24  | @providers/instagram (devDep) |
| @types/fluent-ffmpeg | 2.1.24  | @providers/tiktok (devDep)    |

## Packages Added

None. Uses Node.js built-in `child_process.execFile` + `util.promisify`. Requires `ffmpeg` and `ffprobe` binaries on system PATH (same requirement as before — fluent-ffmpeg also required system binaries).

## Code Changes

| File                                                           | Change                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| providers/instagram/src/mediaProcessor.ts                      | Replaced fluent-ffmpeg import with node:child_process execFile. Rewrote getVideoMetadata(), processVideoSegment(), optimizeForReels(), createThumbnail() to use execFileAsync. Simplified Promise/callback nesting to flat async/await. |
| providers/tiktok/src/videoProcessor.ts                         | Same pattern. analyzeVideo(), executeVideoProcessing(), generateThumbnail() (added duration param), generatePreviewGif() all rewritten.                                                                                                 |
| providers/instagram/tests/mediaProcessor.test-helpers.ts       | Replaced createMockFfmpegInstance() with createExecFileMock() and DEFAULT_PROBE_DATA                                                                                                                                                    |
| providers/instagram/tests/mediaProcessor.test.ts               | Replaced vi.mock("fluent-ffmpeg") with vi.mock("node:child_process")                                                                                                                                                                    |
| providers/instagram/tests/mediaProcessor.validation.test.ts    | Same mock migration                                                                                                                                                                                                                     |
| providers/instagram/tests/schedulingService.scheduling.test.ts | Same mock migration                                                                                                                                                                                                                     |
| providers/instagram/tests/schedulingService.management.test.ts | Same mock migration                                                                                                                                                                                                                     |
| providers/tiktok/tests/videoProcessor.test.ts                  | Complete mock rewrite — replaced 12+ chainable method mocks with single mockExecFile dispatcher                                                                                                                                         |
| providers/instagram/package.json                               | Removed fluent-ffmpeg + @types/fluent-ffmpeg                                                                                                                                                                                            |
| providers/tiktok/package.json                                  | Removed fluent-ffmpeg + @types/fluent-ffmpeg                                                                                                                                                                                            |

## Video Processing Behavior

| Feature                   | Before (fluent-ffmpeg)         | After (execFileAsync)        | Identical? |
| ------------------------- | ------------------------------ | ---------------------------- | ---------- |
| Duration detection        | ffmpeg.ffprobe callback        | ffprobe -print_format json   | Yes        |
| Dimension detection       | ffprobe streams[].width/height | Same JSON structure          | Yes        |
| Codec detection           | ffprobe streams[].codec_name   | Same JSON structure          | Yes        |
| Video transcoding (H.264) | fluent-ffmpeg chain            | ffmpeg -c:v libx264 CLI args | Yes        |
| Audio encoding (AAC)      | .audioCodec("aac")             | -c:a aac                     | Yes        |
| Aspect ratio scaling      | .videoFilters([...])           | -vf "scale=...,crop=..."     | Yes        |
| Thumbnail extraction      | .frames(1) .seekInput(t)       | -frames:v 1 -ss t            | Yes        |
| Preview GIF               | .inputOptions(["-t 3"])        | -t 3 -vf scale=320:-1 -r 10  | Yes        |
| Quality control (CRF)     | .addOption("-crf", val)        | -crf val                     | Yes        |
| Reels optimization        | Chain + .duration(90)          | -t 90 + full arg list        | Yes        |

## Build and Test Status

| Check                    | Result                                         |
| ------------------------ | ---------------------------------------------- |
| TypeScript build         | 0 errors, 9/9 tasks successful                 |
| API unit tests           | 305 files passed, 6,478 tests passed, 0 failed |
| Instagram provider tests | 147 tests passed                               |
| TikTok provider tests    | 48 tests passed (598 total in tiktok suite)    |
| ESLint                   | 0 errors, 0 warnings                           |

## Decisions Made

Option A (full replacement) was chosen over Option B (keep deprecated) and Option C (update + tech debt). The rewrite eliminated ~200 lines of Promise/callback nesting per provider by converting to flat async/await, improving code clarity.

## Packages That Could Not Be Updated

Carried forward:

| Package           | Reason                                     | Session |
| ----------------- | ------------------------------------------ | ------- |
| @opentelemetry/\* | Suite update — needs comprehensive testing | U6      |
