/**
 * @file templateAnalytics.test.ts
 * @description Tests for templateAnalytics stubs. Each method throws
 *   `notImplemented` (501) until the analytics event pipeline is wired up.
 *   Routes that call these surface 501 to the client.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { templateAnalytics } from "../../src/templates/templateAnalytics.js";
import { AppError, ErrorCode } from "@shared/types";

describe("Template Analytics - Stubs throw notImplemented", () => {
  describe("getTemplateAnalytics", () => {
    it("throws with code NOT_IMPLEMENTED", async () => {
      try {
        await templateAnalytics.getTemplateAnalytics("project-123");
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe(ErrorCode.NOT_IMPLEMENTED);
        expect((err as AppError).statusCode).toBe(501);
      }
    });
  });

  describe("trackTemplateUsage", () => {
    it("throws with code NOT_IMPLEMENTED", async () => {
      try {
        await templateAnalytics.trackTemplateUsage("p", "t", {
          action: "USE",
          timestamp: new Date(),
        });
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe(ErrorCode.NOT_IMPLEMENTED);
        expect((err as AppError).statusCode).toBe(501);
      }
    });
  });

  describe("getABTestResults", () => {
    it("throws with code NOT_IMPLEMENTED", async () => {
      try {
        await templateAnalytics.getABTestResults("p", "t");
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe(ErrorCode.NOT_IMPLEMENTED);
        expect((err as AppError).statusCode).toBe(501);
      }
    });
  });
});
