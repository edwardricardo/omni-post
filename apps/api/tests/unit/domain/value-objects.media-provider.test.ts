import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MediaAttachment, MediaId, ScheduledTime, Provider } from "./value-objects.test-helpers.js";

describe("Domain Value Objects - MediaAttachment", () => {
  it("should create image attachment", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/image.jpg",
      width: 1200,
      height: 800,
      altText: "A test image",
    });
    assert.ok(result.ok, "Should create image attachment");
    if (result.ok) {
      assert.ok(result.value.isImage());
      assert.equal(result.value.width, 1200);
      assert.equal(result.value.altText, "A test image");
    }
  });

  it("should create video attachment", () => {
    const result = MediaAttachment.create({
      type: "video",
      url: "https://example.com/video.mp4",
      durationMs: 30000,
    });
    assert.ok(result.ok, "Should create video attachment");
    if (result.ok) {
      assert.ok(result.value.isVideo());
      assert.equal(result.value.durationMs, 30000);
    }
  });

  it("should reject invalid URL", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "not-a-url",
    });
    assert.ok(!result.ok, "Should reject invalid URL");
  });

  it("should reject empty URL", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "",
    });
    assert.ok(!result.ok, "Should reject empty URL");
  });

  it("should reject invalid media type", () => {
    const result = MediaAttachment.create({
      type: "audio" as "image",
      url: "https://example.com/audio.mp3",
    });
    assert.ok(!result.ok, "Should reject invalid media type");
  });

  it("should calculate aspect ratio", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/image.jpg",
      width: 1600,
      height: 900,
    });
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(Math.abs(result.value.aspectRatio! - 16 / 9) < 0.001);
    }
  });

  it("should check platform compatibility", () => {
    const result = MediaAttachment.create({
      type: "gif",
      url: "https://example.com/animation.gif",
    });
    assert.ok(result.ok);
    if (result.ok) {
      const xCompatible = result.value.isCompatibleWithPlatform("X");
      assert.ok(xCompatible.ok, "GIF should be compatible with X");

      const instagramCompatible = result.value.isCompatibleWithPlatform("INSTAGRAM");
      assert.ok(!instagramCompatible.ok, "GIF should not be compatible with Instagram");
    }
  });

  it("should reject width of 0", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
      width: 0,
    });
    assert.ok(!result.ok, "Should reject width=0");
  });

  it("should reject negative width", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
      width: -1,
    });
    assert.ok(!result.ok, "Should reject negative width");
  });

  it("should reject height of 0", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
      height: 0,
    });
    assert.ok(!result.ok, "Should reject height=0");
  });

  it("should reject durationMs of 0 for video", () => {
    const result = MediaAttachment.create({
      type: "video",
      url: "https://example.com/vid.mp4",
      durationMs: 0,
    });
    assert.ok(!result.ok, "Should reject durationMs=0");
  });

  it("should reject negative durationMs", () => {
    const result = MediaAttachment.create({
      type: "video",
      url: "https://example.com/vid.mp4",
      durationMs: -1,
    });
    assert.ok(!result.ok, "Should reject negative durationMs");
  });

  it("should reject fileSizeBytes of 0", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
      fileSizeBytes: 0,
    });
    assert.ok(!result.ok, "Should reject fileSizeBytes=0");
  });

  it("isGif() should return true for gif type", () => {
    const result = MediaAttachment.create({
      type: "gif",
      url: "https://example.com/anim.gif",
    });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.isGif(), true);
    }
  });

  it("isGif() should return false for image type", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
    });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.isGif(), false);
    }
  });

  it("isVideo() should return false for image type", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
    });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.isVideo(), false);
    }
  });

  it("isImage() should return false for video type", () => {
    const result = MediaAttachment.create({
      type: "video",
      url: "https://example.com/vid.mp4",
    });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.isImage(), false);
    }
  });

  it("should return undefined aspectRatio when no dimensions provided", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
    });
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.aspectRatio, undefined);
    }
  });

  it("image should be compatible with Facebook platform", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
    });
    assert.ok(result.ok);
    if (result.ok) {
      const compat = result.value.isCompatibleWithPlatform("FACEBOOK");
      assert.ok(compat.ok, "Image should be compatible with Facebook");
    }
  });

  it("video should be compatible with YouTube platform", () => {
    const result = MediaAttachment.create({
      type: "video",
      url: "https://example.com/vid.mp4",
      durationMs: 5000,
    });
    assert.ok(result.ok);
    if (result.ok) {
      const compat = result.value.isCompatibleWithPlatform("YOUTUBE");
      assert.ok(compat.ok, "Video should be compatible with YouTube");
    }
  });

  it("image should be compatible with TikTok platform", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
    });
    assert.ok(result.ok);
    if (result.ok) {
      const compat = result.value.isCompatibleWithPlatform("TIKTOK");
      assert.ok(compat.ok, "Image should be compatible with TikTok");
    }
  });

  it("should create media with custom MediaId (preserved)", () => {
    const customId = MediaId.generate();
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
      id: customId,
    });
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(result.value.id.equals(customId), "Custom id should be preserved");
    }
  });

  it("withAltText should return a new immutable instance", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
      altText: "Original alt",
    });
    assert.ok(result.ok);
    if (result.ok) {
      const original = result.value;
      const updated = original.withAltText("New alt");
      assert.equal(original.altText, "Original alt", "Original should be unchanged");
      assert.equal(updated.altText, "New alt");
      assert.ok(original.equals(original), "Same instance equals itself");
      assert.ok(original.equals(updated), "Equality is by id, both should be equal");
    }
  });
});

describe("Domain Value Objects - ScheduledTime", () => {
  it("should create valid scheduled time", () => {
    const futureDate = new Date(Date.now() + 30 * 60 * 1000);
    const result = ScheduledTime.create({ dateTime: futureDate });
    assert.ok(result.ok, "Should create scheduled time");
    if (result.ok) {
      assert.ok(!result.value.hasPassed());
      assert.ok(result.value.minutesUntil > 0);
    }
  });

  it("should reject past date", () => {
    const pastDate = new Date(Date.now() - 1000);
    const result = ScheduledTime.create({ dateTime: pastDate });
    assert.ok(!result.ok, "Should reject past date");
  });

  it("should reject date less than 5 minutes in future", () => {
    const tooSoon = new Date(Date.now() + 2 * 60 * 1000);
    const result = ScheduledTime.create({ dateTime: tooSoon });
    assert.ok(!result.ok, "Should reject time less than 5 minutes in future");
  });

  it("should reject date more than 1 year in future", () => {
    const tooFar = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    const result = ScheduledTime.create({ dateTime: tooFar });
    assert.ok(!result.ok, "Should reject time more than 1 year in future");
  });

  it("should create from ISO string", () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    const result = ScheduledTime.fromISOString(futureDate.toISOString());
    assert.ok(result.ok, "Should create from ISO string");
  });

  it("should create from now plus minutes", () => {
    const result = ScheduledTime.fromNowPlusMinutes(30);
    assert.ok(result.ok, "Should create from now plus minutes");
    if (result.ok) {
      assert.ok(result.value.minutesUntil >= 29 && result.value.minutesUntil <= 31);
    }
  });

  it("should delay scheduled time", () => {
    const result1 = ScheduledTime.fromNowPlusMinutes(30);
    assert.ok(result1.ok);
    if (result1.ok) {
      const result2 = result1.value.delay(15);
      assert.ok(result2.ok, "Should delay scheduled time");
      if (result2.ok) {
        assert.ok(result2.value.minutesUntil > result1.value.minutesUntil);
      }
    }
  });

  it("should check isWithinMinutes", () => {
    const result = ScheduledTime.fromNowPlusMinutes(10);
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(result.value.isWithinMinutes(15));
      assert.ok(!result.value.isWithinMinutes(5));
    }
  });

  it("should reschedule to a new future time", () => {
    const result = ScheduledTime.fromNowPlusMinutes(30);
    assert.ok(result.ok);
    if (result.ok) {
      const newTime = new Date(Date.now() + 60 * 60 * 1000);
      const rescheduled = result.value.reschedule(newTime);
      assert.ok(rescheduled.ok, "Reschedule to future should succeed");
    }
  });

  it("should compare two ScheduledTimes correctly", () => {
    const r1 = ScheduledTime.fromNowPlusMinutes(30);
    const r2 = ScheduledTime.fromNowPlusMinutes(60);
    assert.ok(r1.ok && r2.ok);
    if (r1.ok && r2.ok) {
      assert.equal(r1.value.compareTo(r2.value), -1, "Earlier time should be -1");
      assert.equal(r2.value.compareTo(r1.value), 1, "Later time should be 1");
      assert.equal(r1.value.compareTo(r1.value), 0, "Same time should be 0");
    }
  });

  it("should expose correct hoursUntil", () => {
    const result = ScheduledTime.fromNowPlusMinutes(120);
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(result.value.hoursUntil >= 1 && result.value.hoursUntil <= 2);
    }
  });

  it("hasPassed should return false for future time", () => {
    const result = ScheduledTime.fromNowPlusMinutes(30);
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.hasPassed(), false);
    }
  });

  it("reconstitute should bypass future validation (for past DB times)", () => {
    const pastDate = new Date(Date.now() - 60 * 60 * 1000);
    const scheduled = ScheduledTime.reconstitute(pastDate, "UTC");
    assert.ok(scheduled.hasPassed(), "Reconstituted past time should have passed");
    assert.equal(scheduled.timezone, "UTC");
  });
});

describe("Domain Value Objects - Provider", () => {
  it("should create provider from string", () => {
    const result = Provider.fromString("X");
    assert.ok(result.ok, "Should create provider from string");
    if (result.ok) {
      assert.ok(result.value.isX());
      assert.equal(result.value.displayName, "X (Twitter)");
    }
  });

  it("should accept lowercase provider string", () => {
    const result = Provider.fromString("instagram");
    assert.ok(result.ok, "Should accept lowercase");
    if (result.ok) {
      assert.ok(result.value.isInstagram());
    }
  });

  it("should reject invalid provider", () => {
    const result = Provider.fromString("invalid");
    assert.ok(!result.ok, "Should reject invalid provider");
  });

  it("should have complete capability matrix for X", () => {
    const x = Provider.x();
    assert.ok(x.supportsImages(), "X supports images");
    assert.ok(x.supportsVideos(), "X supports videos");
    assert.ok(x.supportsGifs(), "X supports gifs");
    assert.ok(x.supportsThreads(), "X supports threads");
    assert.ok(x.supportsScheduling(), "X supports scheduling");
    assert.ok(x.supportsHashtags(), "X supports hashtags");
    assert.ok(x.supportsMentions(), "X supports mentions");
    assert.ok(x.supportsLinks(), "X supports links");
    assert.ok(x.supportsPolls(), "X supports polls");
    assert.ok(!x.supportsStories(), "X does not support stories");
    assert.ok(!x.supportsReels(), "X does not support reels");
    assert.ok(!x.supportsCarousel(), "X does not support carousel");
    assert.equal(x.maxCharacters, 280);
    assert.equal(x.maxImages, 4);
    assert.equal(x.maxVideoDurationSeconds, 140);
    assert.ok(x.displayName.length > 0);
    assert.ok(x.icon.length > 0);
    assert.ok(x.color.length > 0);
    assert.ok(x.isValidContentLength(0));
    assert.ok(x.isValidContentLength(280));
    assert.ok(!x.isValidContentLength(281));
  });

  it("should have complete capability matrix for Instagram", () => {
    const ig = Provider.instagram();
    assert.ok(ig.supportsImages(), "Instagram supports images");
    assert.ok(ig.supportsVideos(), "Instagram supports videos");
    assert.ok(ig.supportsStories(), "Instagram supports stories");
    assert.ok(ig.supportsReels(), "Instagram supports reels");
    assert.ok(ig.supportsScheduling(), "Instagram supports scheduling");
    assert.ok(ig.supportsCarousel(), "Instagram supports carousel");
    assert.ok(ig.supportsHashtags(), "Instagram supports hashtags");
    assert.ok(ig.supportsMentions(), "Instagram supports mentions");
    assert.ok(!ig.supportsGifs(), "Instagram does not support gifs");
    assert.ok(!ig.supportsThreads(), "Instagram does not support threads");
    assert.ok(!ig.supportsLinks(), "Instagram does not support links");
    assert.ok(!ig.supportsPolls(), "Instagram does not support polls");
    assert.equal(ig.maxCharacters, 2200);
    assert.equal(ig.maxImages, 10);
    assert.equal(ig.maxVideoDurationSeconds, 60);
    assert.ok(ig.displayName.length > 0);
    assert.ok(ig.icon.length > 0);
    assert.ok(ig.color.length > 0);
    assert.ok(ig.isValidContentLength(2200));
    assert.ok(!ig.isValidContentLength(2201));
  });

  it("should have complete capability matrix for Facebook", () => {
    const fb = Provider.facebook();
    assert.ok(fb.supportsImages(), "Facebook supports images");
    assert.ok(fb.supportsVideos(), "Facebook supports videos");
    assert.ok(fb.supportsGifs(), "Facebook supports gifs");
    assert.ok(fb.supportsStories(), "Facebook supports stories");
    assert.ok(fb.supportsReels(), "Facebook supports reels");
    assert.ok(fb.supportsScheduling(), "Facebook supports scheduling");
    assert.ok(fb.supportsCarousel(), "Facebook supports carousel");
    assert.ok(fb.supportsHashtags(), "Facebook supports hashtags");
    assert.ok(fb.supportsMentions(), "Facebook supports mentions");
    assert.ok(fb.supportsLinks(), "Facebook supports links");
    assert.ok(fb.supportsPolls(), "Facebook supports polls");
    assert.ok(!fb.supportsThreads(), "Facebook does not support threads");
    assert.equal(fb.maxCharacters, 63206);
    assert.equal(fb.maxImages, 10);
    assert.equal(fb.maxVideoDurationSeconds, 14400);
    assert.ok(fb.displayName.length > 0);
    assert.ok(fb.icon.length > 0);
    assert.ok(fb.color.length > 0);
    assert.ok(fb.isValidContentLength(63206));
    assert.ok(!fb.isValidContentLength(63207));
  });

  it("should have complete capability matrix for YouTube", () => {
    const yt = Provider.youtube();
    assert.ok(yt.supportsVideos(), "YouTube supports videos");
    assert.ok(yt.supportsReels(), "YouTube supports reels (Shorts)");
    assert.ok(yt.supportsScheduling(), "YouTube supports scheduling");
    assert.ok(yt.supportsHashtags(), "YouTube supports hashtags");
    assert.ok(yt.supportsMentions(), "YouTube supports mentions");
    assert.ok(yt.supportsLinks(), "YouTube supports links");
    assert.ok(yt.supportsPolls(), "YouTube supports polls");
    assert.ok(!yt.supportsImages(), "YouTube does not support images (thumbnails only)");
    assert.ok(!yt.supportsGifs(), "YouTube does not support gifs");
    assert.ok(!yt.supportsThreads(), "YouTube does not support threads");
    assert.ok(!yt.supportsStories(), "YouTube does not support stories");
    assert.ok(!yt.supportsCarousel(), "YouTube does not support carousel");
    assert.equal(yt.maxCharacters, 5000);
    assert.equal(yt.maxImages, 0);
    assert.equal(yt.maxVideoDurationSeconds, 43200);
    assert.ok(yt.displayName.length > 0);
    assert.ok(yt.icon.length > 0);
    assert.ok(yt.color.length > 0);
    assert.ok(yt.isValidContentLength(5000));
    assert.ok(!yt.isValidContentLength(5001));
  });

  it("should have complete capability matrix for TikTok", () => {
    const tt = Provider.tiktok();
    assert.ok(tt.supportsImages(), "TikTok supports images");
    assert.ok(tt.supportsVideos(), "TikTok supports videos");
    assert.ok(tt.supportsScheduling(), "TikTok supports scheduling");
    assert.ok(tt.supportsCarousel(), "TikTok supports carousel");
    assert.ok(tt.supportsHashtags(), "TikTok supports hashtags");
    assert.ok(tt.supportsMentions(), "TikTok supports mentions");
    assert.ok(!tt.supportsGifs(), "TikTok does not support gifs");
    assert.ok(!tt.supportsThreads(), "TikTok does not support threads");
    assert.ok(!tt.supportsStories(), "TikTok does not support stories");
    assert.ok(!tt.supportsReels(), "TikTok does not support reels");
    assert.ok(!tt.supportsLinks(), "TikTok does not support links");
    assert.ok(!tt.supportsPolls(), "TikTok does not support polls");
    assert.equal(tt.maxCharacters, 2200);
    assert.equal(tt.maxImages, 35);
    assert.equal(tt.maxVideoDurationSeconds, 600);
    assert.ok(tt.displayName.length > 0);
    assert.ok(tt.icon.length > 0);
    assert.ok(tt.color.length > 0);
    assert.ok(tt.isValidContentLength(2200));
    assert.ok(!tt.isValidContentLength(2201));
  });

  it("should validate content length", () => {
    const x = Provider.x();
    assert.ok(x.isValidContentLength(280));
    assert.ok(!x.isValidContentLength(281));
  });

  it("should return all providers", () => {
    const all = Provider.all();
    assert.equal(all.length, 5);
    assert.ok(all.some((p) => p.isX()));
    assert.ok(all.some((p) => p.isInstagram()));
    assert.ok(all.some((p) => p.isFacebook()));
    assert.ok(all.some((p) => p.isYouTube()));
    assert.ok(all.some((p) => p.isTikTok()));
  });

  it("should check equality correctly", () => {
    const x1 = Provider.x();
    const x2 = Provider.x();
    const instagram = Provider.instagram();

    assert.ok(x1.equals(x2));
    assert.ok(!x1.equals(instagram));
  });

  it("toString should return the provider type string", () => {
    assert.equal(Provider.x().toString(), "X");
    assert.equal(Provider.instagram().toString(), "INSTAGRAM");
    assert.equal(Provider.facebook().toString(), "FACEBOOK");
    assert.equal(Provider.youtube().toString(), "YOUTUBE");
    assert.equal(Provider.tiktok().toString(), "TIKTOK");
  });

  it("toJSON should include displayName, icon, color, capabilities", () => {
    const json = Provider.x().toJSON();
    assert.equal(json.type, "X");
    assert.ok(typeof json.displayName === "string");
    assert.ok(typeof json.icon === "string");
    assert.ok(typeof json.color === "string");
    assert.ok(typeof json.capabilities === "object");
  });

  it("capabilities getter should return a copy (not the original reference)", () => {
    const x = Provider.x();
    const caps1 = x.capabilities;
    const caps2 = x.capabilities;
    // Should not be the same reference
    assert.ok(caps1 !== caps2, "capabilities should return a fresh copy each time");
    // But same values
    assert.equal(caps1.maxCharacters, caps2.maxCharacters);
  });
});
