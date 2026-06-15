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
    it("throws AppError with statusCode 501", async () => {
      await expect(templateAnalytics.getTemplateAnalytics("project-123")).rejects.toBeInstanceOf(
        AppError
      );
    });

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

    it("throws regardless of filters argument", async () => {
      await expect(
        templateAnalytics.getTemplateAnalytics("project-123", { templateIds: ["t1"] })
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  describe("trackTemplateUsage", () => {
    it("throws AppError with statusCode 501", async () => {
      await expect(
        templateAnalytics.trackTemplateUsage("project-123", "template-456", {
          action: "VIEW",
          timestamp: new Date(),
        })
      ).rejects.toBeInstanceOf(AppError);
    });

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

    it("throws across all event action types", async () => {
      const actions: Array<"VIEW" | "USE" | "COMPILE" | "LIKE" | "SHARE"> = [
        "VIEW",
        "USE",
        "COMPILE",
        "LIKE",
        "SHARE",
      ];
      for (const action of actions) {
        await expect(
          templateAnalytics.trackTemplateUsage("p", "t", { action, timestamp: new Date() })
        ).rejects.toBeInstanceOf(AppError);
      }
    });
  });

  describe("getABTestResults", () => {
    it("throws AppError with statusCode 501", async () => {
      await expect(
        templateAnalytics.getABTestResults("project-123", "test-456")
      ).rejects.toBeInstanceOf(AppError);
    });

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
