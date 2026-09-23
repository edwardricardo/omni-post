/**
 * @file classifyPublishFailure.test.ts
 * @description The classifier's whole table, including the arm that exists precisely so a
 *   failure nobody recognises is not silently called permanent.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import type { PublishError, RenderError } from "@shared/types";
import { classifyPublishFailure } from "../../src/lib/classifyPublishFailure.js";

describe("classifyPublishFailure", () => {
  describe("the closed PublishError union", () => {
    const table: Array<[PublishError, string, string | undefined]> = [
      ["RATE_LIMIT", "transient", undefined],
      ["NETWORK", "transient", undefined],
      ["AUTH", "nontransient", "CHANNEL_AUTH_REQUIRED"],
      ["VALIDATION", "nontransient", "CONTENT_REJECTED"],
      ["THREAD_INTERRUPTED", "nontransient", "THREAD_INTERRUPTED"],
      ["PARENT_TWEET_FAILED", "unclassifiable", undefined],
    ];

    it.each(table)("classifies %s as %s", (code, classification, reason) => {
      const verdict = classifyPublishFailure(code);
      expect(verdict.classification).toBe(classification);
      expect(verdict.code).toBe(reason);
    });
  });

  describe("the closed RenderError union", () => {
    const renderErrors: RenderError[] = [
      "UNSUPPORTED_MEDIA",
      "TEXT_TOO_LONG",
      "VALIDATION_ERROR",
      "CONTENT_TOO_LONG",
      "INVALID_STRATEGY",
      "MEDIA_DISTRIBUTION_FAILED",
      "THREAD_PLANNING_FAILED",
    ];

    it.each(renderErrors)("excludes %s immediately as a render failure", (code) => {
      expect(classifyPublishFailure(code)).toEqual({
        classification: "nontransient",
        code: "RENDER_FAILED",
      });
    });
  });

  describe("a shape the classifier does not recognise", () => {
    const unknownShapes: Array<[string, unknown]> = [
      ["a thrown Error", new Error("Render error: SOMETHING_ELSE")],
      ["a provider string outside both unions", "QUOTA_EXCEEDED"],
      ["an object", { code: "NETWORK" }],
      ["undefined", undefined],
      ["null", null],
      // Names every object inherits from `Object.prototype`. A membership test written
      // with `in`, or a bare index read, walks that chain and answers yes for all of
      // them — a permanent exclusion under a cause the failure never named.
      ["the inherited name toString", "toString"],
      ["the inherited name constructor", "constructor"],
      ["the inherited name __proto__", "__proto__"],
      ["the inherited name hasOwnProperty", "hasOwnProperty"],
    ];

    // The third answer is the point of the classifier. Collapsing an unknown into
    // `transient` retries forever against a channel that may be permanently broken;
    // collapsing it into `nontransient` strands a channel that would have succeeded.
    // Both failures read as a working classifier, which is why they are asserted as
    // refusals rather than inferred from the positive assertion above.
    it.each(unknownShapes)(
      "calls %s unclassifiable, and neither of the other two",
      (_name, shape) => {
        const verdict = classifyPublishFailure(shape);
        expect(verdict.classification).toBe("unclassifiable");
        expect(verdict.classification).not.toBe("transient");
        expect(verdict.classification).not.toBe("nontransient");
        expect(verdict.code).toBeUndefined();
      }
    );
  });
});
