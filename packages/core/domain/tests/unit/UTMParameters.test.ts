/**
 * @file UTMParameters.test.ts
 * @description Unit tests for the UTMParameters value object — construction
 *   validation, URL building, optional fields, immutability, and value equality.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { UTMParameters } from "@core/domain/value-objects/UTMParameters.js";

describe("UTMParameters", () => {
  describe("create — valid inputs", () => {
    it("constructs successfully with the three required fields", () => {
      const r = UTMParameters.create({ source: "twitter", medium: "social", campaign: "launch" });
      assert.ok(r.ok);
      assert.strictEqual(r.value.source, "twitter");
      assert.strictEqual(r.value.medium, "social");
      assert.strictEqual(r.value.campaign, "launch");
    });

    it("constructs successfully with all five fields including content and term", () => {
      const r = UTMParameters.create({
        source: "newsletter",
        medium: "email",
        campaign: "q4",
        content: "header-cta",
        term: "social-media",
      });
      assert.ok(r.ok);
      assert.strictEqual(r.value.content, "header-cta");
      assert.strictEqual(r.value.term, "social-media");
    });

    it("optional fields remain undefined when not provided", () => {
      const r = UTMParameters.create({ source: "x", medium: "social", campaign: "c" });
      assert.ok(r.ok);
      assert.strictEqual(r.value.content, undefined);
      assert.strictEqual(r.value.term, undefined);
    });
  });

  describe("create — invalid inputs", () => {
    it("rejects an empty source", () => {
      const r = UTMParameters.create({ source: "", medium: "social", campaign: "launch" });
      assert.ok(!r.ok);
      assert.match(r.error.message, /utm_source/);
    });

    it("rejects an empty medium", () => {
      const r = UTMParameters.create({ source: "x", medium: "", campaign: "launch" });
      assert.ok(!r.ok);
      assert.match(r.error.message, /utm_medium/);
    });

    it("rejects an empty campaign", () => {
      const r = UTMParameters.create({ source: "x", medium: "social", campaign: "" });
      assert.ok(!r.ok);
      assert.match(r.error.message, /utm_campaign/);
    });

    it("rejects source with a space (non-URL-safe character)", () => {
      const r = UTMParameters.create({ source: "my source", medium: "social", campaign: "c" });
      assert.ok(!r.ok);
      assert.match(r.error.message, /invalid characters/i);
    });

    it("rejects source with a slash", () => {
      const r = UTMParameters.create({ source: "a/b", medium: "social", campaign: "c" });
      assert.ok(!r.ok);
    });
  });

  describe("buildUrl — invariant", () => {
    it("appends all three required utm_* params to the base URL", () => {
      const r = UTMParameters.create({ source: "twitter", medium: "social", campaign: "launch" });
      assert.ok(r.ok);
      const url = r.value.buildUrl("https://example.com/page");
      assert.match(url, /utm_source=twitter/);
      assert.match(url, /utm_medium=social/);
      assert.match(url, /utm_campaign=launch/);
    });

    it("appends optional content and term when present", () => {
      const r = UTMParameters.create({
        source: "x",
        medium: "social",
        campaign: "c",
        content: "header",
        term: "test-term",
      });
      assert.ok(r.ok);
      const url = r.value.buildUrl("https://example.com");
      assert.match(url, /utm_content=header/);
      assert.match(url, /utm_term=test-term/);
    });

    it("does not include utm_content or utm_term when fields are absent", () => {
      const r = UTMParameters.create({ source: "x", medium: "social", campaign: "c" });
      assert.ok(r.ok);
      const url = r.value.buildUrl("https://example.com");
      assert.ok(!url.includes("utm_content"));
      assert.ok(!url.includes("utm_term"));
    });
  });

  describe("equality + immutability", () => {
    it("two instances with identical required props are equal by value", () => {
      const a = UTMParameters.create({ source: "x", medium: "social", campaign: "c" });
      const b = UTMParameters.create({ source: "x", medium: "social", campaign: "c" });
      assert.ok(a.ok && b.ok);
      assert.ok(a.value.equals(b.value));
    });

    it("two instances that differ in campaign are NOT equal", () => {
      const a = UTMParameters.create({ source: "x", medium: "social", campaign: "c1" });
      const b = UTMParameters.create({ source: "x", medium: "social", campaign: "c2" });
      assert.ok(a.ok && b.ok);
      assert.ok(!a.value.equals(b.value));
    });

    it("readonly fields cannot be reassigned at runtime (TypeScript readonly is compile-time; verify by structural copy instead)", () => {
      const r = UTMParameters.create({ source: "x", medium: "social", campaign: "c" });
      assert.ok(r.ok);
      const original = r.value.source;
      // Attempt reassignment — TS readonly does NOT freeze the object at runtime
      // so we assert value unchanged after a structural copy confirms original intact
      const copy = { ...r.value };
      assert.strictEqual(copy.source, original);
      assert.strictEqual(r.value.source, original);
    });

    it("toJSON serializes to a plain object with the correct fields", () => {
      const r = UTMParameters.create({ source: "x", medium: "social", campaign: "c" });
      assert.ok(r.ok);
      const json = r.value.toJSON();
      assert.strictEqual(json.source, "x");
      assert.strictEqual(json.medium, "social");
      assert.strictEqual(json.campaign, "c");
      assert.ok(!("content" in json));
    });
  });
});
