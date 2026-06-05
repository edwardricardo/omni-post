/**
 * @file GenerateRepurposeVariantsUseCase.test.ts
 * @description Unit tests for GenerateRepurposeVariantsUseCase.
 *   Tier 3 — mocks RepurposeVariantPort and GeneratePlatformVariantsUseCase boundaries.
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { GenerateRepurposeVariantsUseCase } from "../../src/GenerateRepurposeVariantsUseCase.js";
import type {
  RepurposeVariantPort,
  NotificationPort,
} from "../../src/GenerateRepurposeVariantsUseCase.js";
import type { GeneratePlatformVariantsUseCase } from "../../src/GeneratePlatformVariantsUseCase.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROPOSAL_ID = "p1000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "a1000000-0000-4000-8000-000000000001";
const POST_ID = "po100000-0000-4000-8000-000000000001";

function makePort(overrides?: Partial<RepurposeVariantPort>): RepurposeVariantPort {
  return {
    loadProposal: vi.fn(async () => ({
      id: PROPOSAL_ID,
      accountId: ACCOUNT_ID,
      sourcePostId: POST_ID,
      sourcePlatform: "INSTAGRAM",
    })),
    getPostContent: vi.fn(async () => "Check out our latest product launch! #excited"),
    getConnectedPlatforms: vi.fn(async () => ["INSTAGRAM", "TWITTER", "LINKEDIN"]),
    createVariant: vi.fn(async () => undefined),
    existingVariantPlatforms: vi.fn(async () => []),
    ...overrides,
  };
}

function makePlatformVariants(success = true): GeneratePlatformVariantsUseCase {
  return {
    execute: vi.fn(async () => {
      if (!success) {
        return { ok: false, error: { message: "AI failed", code: USE_CASE_ERRORS.INTERNAL_ERROR } };
      }
      return {
        ok: true,
        value: {
          variants: [
            {
              platform: "TWITTER",
              content: "Check out our launch!",
              charCount: 25,
              charLimit: 280,
              hashtags: ["#excited"],
            },
            {
              platform: "LINKEDIN",
              content: "We are thrilled to launch...",
              charCount: 30,
              charLimit: 3000,
              hashtags: [],
            },
          ],
          generationMs: 100,
        },
      };
    }),
  } as unknown as GeneratePlatformVariantsUseCase;
}

function makeNotificationPort(): NotificationPort {
  return {
    notify: vi.fn(async () => undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GenerateRepurposeVariantsUseCase", () => {
  let port: ReturnType<typeof makePort>;
  let platformVariants: GeneratePlatformVariantsUseCase;

  beforeEach(() => {
    vi.clearAllMocks();
    port = makePort();
    platformVariants = makePlatformVariants();
  });

  describe("happy path — variants created", () => {
    it("returns ok with variantsCreated count when proposal and post content exist", async () => {
      const useCase = new GenerateRepurposeVariantsUseCase(
        port,
        platformVariants,
        makeNotificationPort()
      );

      const result = await useCase.execute({ proposalId: PROPOSAL_ID });

      assert.ok(result.ok, `Expected ok, got: ${!result.ok ? result.error.message : ""}`);
      assert.strictEqual(result.value.variantsCreated, 2);
    });
  });

  describe("not found — proposal missing", () => {
    it("returns NOT_FOUND error when proposal does not exist", async () => {
      const noProposalPort = makePort({
        loadProposal: vi.fn(async () => null),
      });
      const useCase = new GenerateRepurposeVariantsUseCase(noProposalPort, platformVariants);

      const result = await useCase.execute({ proposalId: PROPOSAL_ID });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
    });
  });

  describe("not found — source post content missing", () => {
    it("returns NOT_FOUND error when source post content cannot be loaded", async () => {
      const noContentPort = makePort({
        getPostContent: vi.fn(async () => null),
      });
      const useCase = new GenerateRepurposeVariantsUseCase(noContentPort, platformVariants);

      const result = await useCase.execute({ proposalId: PROPOSAL_ID });

      assert.ok(!result.ok);
      assert.strictEqual(result.error.code, USE_CASE_ERRORS.NOT_FOUND);
    });
  });

  describe("no target platforms", () => {
    it("returns ok with variantsCreated 0 when no other platforms are connected", async () => {
      const onlySourcePort = makePort({
        getConnectedPlatforms: vi.fn(async () => ["INSTAGRAM"]),
      });
      const useCase = new GenerateRepurposeVariantsUseCase(onlySourcePort, platformVariants);

      const result = await useCase.execute({ proposalId: PROPOSAL_ID });

      assert.ok(result.ok);
      assert.strictEqual(result.value.variantsCreated, 0);
    });
  });
});
