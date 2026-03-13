import { describe, it, expect } from "vitest";
import { MediaAttachment, MediaId, ScheduledTime, Provider } from "./value-objects.fixtures.js";

describe("Domain Value Objects - MediaAttachment", () => {
  it("should create image attachment", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/image.jpg",
      width: 1200,
      height: 800,
      altText: "A test image",
    });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isImage()).toBeTruthy();
      expect(result.value.width).toBe(1200);
      expect(result.value.altText).toBe("A test image");
    }
  });

  it("should create video attachment", () => {
    const result = MediaAttachment.create({
      type: "video",
      url: "https://example.com/video.mp4",
      durationMs: 30000,
    });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isVideo()).toBeTruthy();
      expect(result.value.durationMs).toBe(30000);
    }
  });

  it("should reject invalid URL", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "not-a-url",
    });
    expect(result.ok).toBeFalsy();
  });

  it("should reject empty URL", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "",
    });
    expect(result.ok).toBeFalsy();
  });

  it("should reject invalid media type", () => {
    const result = MediaAttachment.create({
      type: "audio" as "image",
      url: "https://example.com/audio.mp3",
    });
    expect(result.ok).toBeFalsy();
  });

  it("should calculate aspect ratio", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/image.jpg",
      width: 1600,
      height: 900,
    });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(Math.abs(result.value.aspectRatio! - 16 / 9) < 0.001).toBeTruthy();
    }
  });

  it("should check platform compatibility", () => {
    const result = MediaAttachment.create({
      type: "gif",
      url: "https://example.com/animation.gif",
    });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      const xCompatible = result.value.isCompatibleWithPlatform("X");
      expect(xCompatible.ok).toBeTruthy();

      const instagramCompatible = result.value.isCompatibleWithPlatform("INSTAGRAM");
      expect(instagramCompatible.ok).toBeFalsy();
    }
  });

  it("should reject width of 0", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
      width: 0,
    });
    expect(result.ok).toBeFalsy();
  });

  it("should reject negative width", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
      width: -1,
    });
    expect(result.ok).toBeFalsy();
  });

  it("should reject height of 0", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
      height: 0,
    });
    expect(result.ok).toBeFalsy();
  });

  it("should reject durationMs of 0 for video", () => {
    const result = MediaAttachment.create({
      type: "video",
      url: "https://example.com/vid.mp4",
      durationMs: 0,
    });
    expect(result.ok).toBeFalsy();
  });

  it("should reject negative durationMs", () => {
    const result = MediaAttachment.create({
      type: "video",
      url: "https://example.com/vid.mp4",
      durationMs: -1,
    });
    expect(result.ok).toBeFalsy();
  });

  it("should reject fileSizeBytes of 0", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
      fileSizeBytes: 0,
    });
    expect(result.ok).toBeFalsy();
  });

  it("isGif() should return true for gif type", () => {
    const result = MediaAttachment.create({
      type: "gif",
      url: "https://example.com/anim.gif",
    });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isGif()).toBe(true);
    }
  });

  it("isGif() should return false for image type", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
    });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isGif()).toBe(false);
    }
  });

  it("isVideo() should return false for image type", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
    });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isVideo()).toBe(false);
    }
  });

  it("isImage() should return false for video type", () => {
    const result = MediaAttachment.create({
      type: "video",
      url: "https://example.com/vid.mp4",
    });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isImage()).toBe(false);
    }
  });

  it("should return undefined aspectRatio when no dimensions provided", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
    });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.aspectRatio).toBe(undefined);
    }
  });

  it("image should be compatible with Facebook platform", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
    });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      const compat = result.value.isCompatibleWithPlatform("FACEBOOK");
      expect(compat.ok).toBeTruthy();
    }
  });

  it("video should be compatible with YouTube platform", () => {
    const result = MediaAttachment.create({
      type: "video",
      url: "https://example.com/vid.mp4",
      durationMs: 5000,
    });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      const compat = result.value.isCompatibleWithPlatform("YOUTUBE");
      expect(compat.ok).toBeTruthy();
    }
  });

  it("image should be compatible with TikTok platform", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
    });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      const compat = result.value.isCompatibleWithPlatform("TIKTOK");
      expect(compat.ok).toBeTruthy();
    }
  });

  it("should create media with custom MediaId (preserved)", () => {
    const customId = MediaId.generate();
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
      id: customId,
    });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.id.equals(customId)).toBeTruthy();
    }
  });

  it("withAltText should return a new immutable instance", () => {
    const result = MediaAttachment.create({
      type: "image",
      url: "https://example.com/img.jpg",
      altText: "Original alt",
    });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      const original = result.value;
      const updated = original.withAltText("New alt");
      expect(original.altText).toBe("Original alt");
      expect(updated.altText).toBe("New alt");
      expect(original.equals(original)).toBeTruthy();
      expect(original.equals(updated)).toBeTruthy();
    }
  });
});

describe("Domain Value Objects - ScheduledTime", () => {
  it("should create valid scheduled time", () => {
    const futureDate = new Date(Date.now() + 30 * 60 * 1000);
    const result = ScheduledTime.create({ dateTime: futureDate });
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.hasPassed()).toBeFalsy();
      expect(result.value.minutesUntil > 0).toBeTruthy();
    }
  });

  it("should reject past date", () => {
    const pastDate = new Date(Date.now() - 1000);
    const result = ScheduledTime.create({ dateTime: pastDate });
    expect(result.ok).toBeFalsy();
  });

  it("should reject date less than 5 minutes in future", () => {
    const tooSoon = new Date(Date.now() + 2 * 60 * 1000);
    const result = ScheduledTime.create({ dateTime: tooSoon });
    expect(result.ok).toBeFalsy();
  });

  it("should reject date more than 1 year in future", () => {
    const tooFar = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    const result = ScheduledTime.create({ dateTime: tooFar });
    expect(result.ok).toBeFalsy();
  });

  it("should create from ISO string", () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    const result = ScheduledTime.fromISOString(futureDate.toISOString());
    expect(result.ok).toBeTruthy();
  });

  it("should create from now plus minutes", () => {
    const result = ScheduledTime.fromNowPlusMinutes(30);
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.minutesUntil >= 29 && result.value.minutesUntil <= 31).toBeTruthy();
    }
  });

  it("should delay scheduled time", () => {
    const result1 = ScheduledTime.fromNowPlusMinutes(30);
    expect(result1.ok).toBeTruthy();
    if (result1.ok) {
      const result2 = result1.value.delay(15);
      expect(result2.ok).toBeTruthy();
      if (result2.ok) {
        expect(result2.value.minutesUntil > result1.value.minutesUntil).toBeTruthy();
      }
    }
  });

  it("should check isWithinMinutes", () => {
    const result = ScheduledTime.fromNowPlusMinutes(10);
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isWithinMinutes(15)).toBeTruthy();
      expect(result.value.isWithinMinutes(5)).toBeFalsy();
    }
  });

  it("should reschedule to a new future time", () => {
    const result = ScheduledTime.fromNowPlusMinutes(30);
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      const newTime = new Date(Date.now() + 60 * 60 * 1000);
      const rescheduled = result.value.reschedule(newTime);
      expect(rescheduled.ok).toBeTruthy();
    }
  });

  it("should compare two ScheduledTimes correctly", () => {
    const r1 = ScheduledTime.fromNowPlusMinutes(30);
    const r2 = ScheduledTime.fromNowPlusMinutes(60);
    expect(r1.ok && r2.ok).toBeTruthy();
    if (r1.ok && r2.ok) {
      expect(r1.value.compareTo(r2.value)).toBe(-1);
      expect(r2.value.compareTo(r1.value)).toBe(1);
      expect(r1.value.compareTo(r1.value)).toBe(0);
    }
  });

  it("should expose correct hoursUntil", () => {
    const result = ScheduledTime.fromNowPlusMinutes(120);
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.hoursUntil >= 1 && result.value.hoursUntil <= 2).toBeTruthy();
    }
  });

  it("hasPassed should return false for future time", () => {
    const result = ScheduledTime.fromNowPlusMinutes(30);
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.hasPassed()).toBe(false);
    }
  });

  it("reconstitute should bypass future validation (for past DB times)", () => {
    const pastDate = new Date(Date.now() - 60 * 60 * 1000);
    const scheduled = ScheduledTime.reconstitute(pastDate, "UTC");
    expect(scheduled.hasPassed()).toBeTruthy();
    expect(scheduled.timezone).toBe("UTC");
  });
});

describe("Domain Value Objects - Provider", () => {
  it("should create provider from string", () => {
    const result = Provider.fromString("X");
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isX()).toBeTruthy();
      expect(result.value.displayName).toBe("X (Twitter)");
    }
  });

  it("should accept lowercase provider string", () => {
    const result = Provider.fromString("instagram");
    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.isInstagram()).toBeTruthy();
    }
  });

  it("should reject invalid provider", () => {
    const result = Provider.fromString("invalid");
    expect(result.ok).toBeFalsy();
  });

  it("should have complete capability matrix for X", () => {
    const x = Provider.x();
    expect(x.supportsImages()).toBeTruthy();
    expect(x.supportsVideos()).toBeTruthy();
    expect(x.supportsGifs()).toBeTruthy();
    expect(x.supportsThreads()).toBeTruthy();
    expect(x.supportsScheduling()).toBeTruthy();
    expect(x.supportsHashtags()).toBeTruthy();
    expect(x.supportsMentions()).toBeTruthy();
    expect(x.supportsLinks()).toBeTruthy();
    expect(x.supportsPolls()).toBeTruthy();
    expect(x.supportsStories()).toBeFalsy();
    expect(x.supportsReels()).toBeFalsy();
    expect(x.supportsCarousel()).toBeFalsy();
    expect(x.maxCharacters).toBe(280);
    expect(x.maxImages).toBe(4);
    expect(x.maxVideoDurationSeconds).toBe(140);
    expect(x.displayName.length > 0).toBeTruthy();
    expect(x.icon.length > 0).toBeTruthy();
    expect(x.color.length > 0).toBeTruthy();
    expect(x.isValidContentLength(0)).toBeTruthy();
    expect(x.isValidContentLength(280)).toBeTruthy();
    expect(x.isValidContentLength(281)).toBeFalsy();
  });

  it("should have complete capability matrix for Instagram", () => {
    const ig = Provider.instagram();
    expect(ig.supportsImages()).toBeTruthy();
    expect(ig.supportsVideos()).toBeTruthy();
    expect(ig.supportsStories()).toBeTruthy();
    expect(ig.supportsReels()).toBeTruthy();
    expect(ig.supportsScheduling()).toBeTruthy();
    expect(ig.supportsCarousel()).toBeTruthy();
    expect(ig.supportsHashtags()).toBeTruthy();
    expect(ig.supportsMentions()).toBeTruthy();
    expect(ig.supportsGifs()).toBeFalsy();
    expect(ig.supportsThreads()).toBeFalsy();
    expect(ig.supportsLinks()).toBeFalsy();
    expect(ig.supportsPolls()).toBeFalsy();
    expect(ig.maxCharacters).toBe(2200);
    expect(ig.maxImages).toBe(10);
    expect(ig.maxVideoDurationSeconds).toBe(60);
    expect(ig.displayName.length > 0).toBeTruthy();
    expect(ig.icon.length > 0).toBeTruthy();
    expect(ig.color.length > 0).toBeTruthy();
    expect(ig.isValidContentLength(2200)).toBeTruthy();
    expect(ig.isValidContentLength(2201)).toBeFalsy();
  });

  it("should have complete capability matrix for Facebook", () => {
    const fb = Provider.facebook();
    expect(fb.supportsImages()).toBeTruthy();
    expect(fb.supportsVideos()).toBeTruthy();
    expect(fb.supportsGifs()).toBeTruthy();
    expect(fb.supportsStories()).toBeTruthy();
    expect(fb.supportsReels()).toBeTruthy();
    expect(fb.supportsScheduling()).toBeTruthy();
    expect(fb.supportsCarousel()).toBeTruthy();
    expect(fb.supportsHashtags()).toBeTruthy();
    expect(fb.supportsMentions()).toBeTruthy();
    expect(fb.supportsLinks()).toBeTruthy();
    expect(fb.supportsPolls()).toBeTruthy();
    expect(fb.supportsThreads()).toBeFalsy();
    expect(fb.maxCharacters).toBe(63206);
    expect(fb.maxImages).toBe(10);
    expect(fb.maxVideoDurationSeconds).toBe(14400);
    expect(fb.displayName.length > 0).toBeTruthy();
    expect(fb.icon.length > 0).toBeTruthy();
    expect(fb.color.length > 0).toBeTruthy();
    expect(fb.isValidContentLength(63206)).toBeTruthy();
    expect(fb.isValidContentLength(63207)).toBeFalsy();
  });

  it("should have complete capability matrix for YouTube", () => {
    const yt = Provider.youtube();
    expect(yt.supportsVideos()).toBeTruthy();
    expect(yt.supportsReels()).toBeTruthy();
    expect(yt.supportsScheduling()).toBeTruthy();
    expect(yt.supportsHashtags()).toBeTruthy();
    expect(yt.supportsMentions()).toBeTruthy();
    expect(yt.supportsLinks()).toBeTruthy();
    expect(yt.supportsPolls()).toBeTruthy();
    expect(yt.supportsImages()).toBeFalsy();
    expect(yt.supportsGifs()).toBeFalsy();
    expect(yt.supportsThreads()).toBeFalsy();
    expect(yt.supportsStories()).toBeFalsy();
    expect(yt.supportsCarousel()).toBeFalsy();
    expect(yt.maxCharacters).toBe(5000);
    expect(yt.maxImages).toBe(0);
    expect(yt.maxVideoDurationSeconds).toBe(43200);
    expect(yt.displayName.length > 0).toBeTruthy();
    expect(yt.icon.length > 0).toBeTruthy();
    expect(yt.color.length > 0).toBeTruthy();
    expect(yt.isValidContentLength(5000)).toBeTruthy();
    expect(yt.isValidContentLength(5001)).toBeFalsy();
  });

  it("should have complete capability matrix for TikTok", () => {
    const tt = Provider.tiktok();
    expect(tt.supportsImages()).toBeTruthy();
    expect(tt.supportsVideos()).toBeTruthy();
    expect(tt.supportsScheduling()).toBeTruthy();
    expect(tt.supportsCarousel()).toBeTruthy();
    expect(tt.supportsHashtags()).toBeTruthy();
    expect(tt.supportsMentions()).toBeTruthy();
    expect(tt.supportsGifs()).toBeFalsy();
    expect(tt.supportsThreads()).toBeFalsy();
    expect(tt.supportsStories()).toBeFalsy();
    expect(tt.supportsReels()).toBeFalsy();
    expect(tt.supportsLinks()).toBeFalsy();
    expect(tt.supportsPolls()).toBeFalsy();
    expect(tt.maxCharacters).toBe(2200);
    expect(tt.maxImages).toBe(35);
    expect(tt.maxVideoDurationSeconds).toBe(600);
    expect(tt.displayName.length > 0).toBeTruthy();
    expect(tt.icon.length > 0).toBeTruthy();
    expect(tt.color.length > 0).toBeTruthy();
    expect(tt.isValidContentLength(2200)).toBeTruthy();
    expect(tt.isValidContentLength(2201)).toBeFalsy();
  });

  it("should validate content length", () => {
    const x = Provider.x();
    expect(x.isValidContentLength(280)).toBeTruthy();
    expect(x.isValidContentLength(281)).toBeFalsy();
  });

  it("should return all providers", () => {
    const all = Provider.all();
    // 10 providers: X, Instagram, Facebook, YouTube, TikTok, Snapchat, Telegram, Pinterest, LinkedIn, Bluesky
    expect(all.length).toBe(10);
    expect(all.some((p) => p.isX())).toBeTruthy();
    expect(all.some((p) => p.isInstagram())).toBeTruthy();
    expect(all.some((p) => p.isFacebook())).toBeTruthy();
    expect(all.some((p) => p.isYouTube())).toBeTruthy();
    expect(all.some((p) => p.isTikTok())).toBeTruthy();
  });

  it("should check equality correctly", () => {
    const x1 = Provider.x();
    const x2 = Provider.x();
    const instagram = Provider.instagram();

    expect(x1.equals(x2)).toBeTruthy();
    expect(x1.equals(instagram)).toBeFalsy();
  });

  it("toString should return the provider type string", () => {
    expect(Provider.x().toString()).toBe("X");
    expect(Provider.instagram().toString()).toBe("INSTAGRAM");
    expect(Provider.facebook().toString()).toBe("FACEBOOK");
    expect(Provider.youtube().toString()).toBe("YOUTUBE");
    expect(Provider.tiktok().toString()).toBe("TIKTOK");
  });

  it("toJSON should include displayName, icon, color, capabilities", () => {
    const json = Provider.x().toJSON();
    expect(json.type).toBe("X");
    expect(typeof json.displayName === "string").toBeTruthy();
    expect(typeof json.icon === "string").toBeTruthy();
    expect(typeof json.color === "string").toBeTruthy();
    expect(typeof json.capabilities === "object").toBeTruthy();
  });

  it("capabilities getter should return a copy (not the original reference)", () => {
    const x = Provider.x();
    const caps1 = x.capabilities;
    const caps2 = x.capabilities;
    // Should not be the same reference
    expect(caps1 !== caps2).toBeTruthy();
    // But same values
    expect(caps1.maxCharacters).toBe(caps2.maxCharacters);
  });
});
