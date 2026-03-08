/**
 * Application Layer - Link Tracking Use Cases Tests
 *
 * Part of Sprint 19: Link Tracking Feature
 * Tests for CreateTrackedLink, GetTrackedLink, RedirectAndTrackClick,
 * GetLinkStats, and DeleteTrackedLink use cases.
 */

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import {
  TrackedLink,
  ProjectId,
  TrackedLinkId,
  EntityNotFoundError,
} from "../../../../src/domain/index.js";
import {
  CreateTrackedLinkUseCase,
  GetTrackedLinkUseCase,
  RedirectAndTrackClickUseCase,
  GetLinkStatsUseCase,
  DeleteTrackedLinkUseCase,
  type CreateTrackedLinkInput,
  type RedirectInput,
} from "../../../../src/application/links/index.js";

// Mock repository factory
function createMockRepository(t: TestContext) {
  return {
    save: t.mock.fn(async () => ok(undefined)),
    findById: t.mock.fn(async () => err(new EntityNotFoundError("TrackedLink", "test"))),
    findByShortCode: t.mock.fn(async () => err(new EntityNotFoundError("TrackedLink", "test"))),
    findByProjectId: t.mock.fn(async () => []),
    delete: t.mock.fn(async () => ok(undefined)),
    recordClick: t.mock.fn(async () => ok(undefined)),
    getClickStats: t.mock.fn(async () => ({
      totalClicks: 0,
      clicksByCountry: {},
    })),
    isShortCodeAvailable: t.mock.fn(async () => true),
  };
}

describe("CreateTrackedLinkUseCase", { concurrency: 1 }, () => {
  let useCase: CreateTrackedLinkUseCase;
  let mockRepo: ReturnType<typeof createMockRepository>;

  beforeEach((t) => {
    mockRepo = createMockRepository(t);
    useCase = new CreateTrackedLinkUseCase(mockRepo);
  });

  it("should create a tracked link with valid input", async () => {
    const input: CreateTrackedLinkInput = {
      projectId: ProjectId.generate().value,
      originalUrl: "https://example.com/my-page",
    };

    const result = await useCase.execute(input);

    assert.ok(result.ok, "Should succeed");
    if (result.ok) {
      assert.ok(result.value.id);
      assert.equal(result.value.originalUrl, input.originalUrl);
      assert.ok(result.value.shortCode);
    }
    assert.equal(mockRepo.save.mock.calls.length, 1);
  });

  it("should create a tracked link with vanity slug", async () => {
    const input: CreateTrackedLinkInput = {
      projectId: ProjectId.generate().value,
      originalUrl: "https://example.com/campaign",
      vanitySlug: "summer-sale",
    };

    const result = await useCase.execute(input);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.vanitySlug, "summer-sale");
    }
  });

  it("should fail with invalid URL", async () => {
    const input: CreateTrackedLinkInput = {
      projectId: ProjectId.generate().value,
      originalUrl: "not-a-valid-url",
    };

    const result = await useCase.execute(input);

    assert.ok(!result.ok, "Should fail with invalid URL");
  });

  it("should fail with invalid project ID", async () => {
    const input: CreateTrackedLinkInput = {
      projectId: "invalid-id",
      originalUrl: "https://example.com",
    };

    const result = await useCase.execute(input);

    assert.ok(!result.ok, "Should fail with invalid project ID");
  });

  it("should fail when vanity slug is already taken", async () => {
    mockRepo.isShortCodeAvailable.mock.mockImplementation(async () => false);

    const input: CreateTrackedLinkInput = {
      projectId: ProjectId.generate().value,
      originalUrl: "https://example.com",
      vanitySlug: "taken-slug",
    };

    const result = await useCase.execute(input);

    assert.ok(!result.ok, "Should fail when slug is taken");
  });
});

describe("GetTrackedLinkUseCase", { concurrency: 1 }, () => {
  let useCase: GetTrackedLinkUseCase;
  let mockRepo: ReturnType<typeof createMockRepository>;

  beforeEach((t) => {
    mockRepo = createMockRepository(t);
    useCase = new GetTrackedLinkUseCase(mockRepo);
  });

  it("should return link when found by ID", async () => {
    const projectId = ProjectId.generate();
    const linkResult = TrackedLink.create({
      projectId,
      originalUrl: "https://example.com",
    });
    assert.ok(linkResult.ok);
    const link = linkResult.value;

    mockRepo.findById.mock.mockImplementation(async () => ok(link));

    const result = await useCase.execute({ linkId: link.id.value });

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.id, link.id.value);
    }
  });

  it("should return error when link not found", async () => {
    const result = await useCase.execute({ linkId: TrackedLinkId.generate().value });

    assert.ok(!result.ok, "Should return error for non-existent link");
  });
});

describe("RedirectAndTrackClickUseCase", { concurrency: 1 }, () => {
  let useCase: RedirectAndTrackClickUseCase;
  let mockRepo: ReturnType<typeof createMockRepository>;

  beforeEach((t) => {
    mockRepo = createMockRepository(t);
    useCase = new RedirectAndTrackClickUseCase(mockRepo);
  });

  it("should return original URL and record click", async () => {
    const projectId = ProjectId.generate();
    const linkResult = TrackedLink.create({
      projectId,
      originalUrl: "https://example.com/target",
    });
    assert.ok(linkResult.ok);
    const link = linkResult.value;

    mockRepo.findByShortCode.mock.mockImplementation(async () => ok(link));

    const input: RedirectInput = {
      shortCode: link.shortCode.value,
      referrer: "https://twitter.com",
      userAgent: "Mozilla/5.0",
      ipAddress: "192.168.1.1",
      country: "US",
      city: "New York",
    };

    const result = await useCase.execute(input);

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.originalUrl, "https://example.com/target");
    }
    assert.equal(mockRepo.recordClick.mock.calls.length, 1);
  });

  it("should return error for non-existent short code", async () => {
    const result = await useCase.execute({ shortCode: "non-existent" });

    assert.ok(!result.ok);
  });

  it("should return error for inactive link", async () => {
    const projectId = ProjectId.generate();
    const linkResult = TrackedLink.create({
      projectId,
      originalUrl: "https://example.com",
    });
    assert.ok(linkResult.ok);
    const link = linkResult.value;
    link.deactivate();

    mockRepo.findByShortCode.mock.mockImplementation(async () => ok(link));

    const result = await useCase.execute({ shortCode: link.shortCode.value });

    assert.ok(!result.ok, "Should not redirect to inactive link");
  });
});

describe("GetLinkStatsUseCase", { concurrency: 1 }, () => {
  let useCase: GetLinkStatsUseCase;
  let mockRepo: ReturnType<typeof createMockRepository>;

  beforeEach((t) => {
    mockRepo = createMockRepository(t);
    useCase = new GetLinkStatsUseCase(mockRepo);
  });

  it("should return statistics for a link", async () => {
    const projectId = ProjectId.generate();
    const linkResult = TrackedLink.create({
      projectId,
      originalUrl: "https://example.com",
    });
    assert.ok(linkResult.ok);
    const link = linkResult.value;

    mockRepo.findById.mock.mockImplementation(async () => ok(link));
    mockRepo.getClickStats.mock.mockImplementation(async () => ({
      totalClicks: 150,
      clicksByCountry: { US: 100, UK: 50 },
    }));

    const result = await useCase.execute({ linkId: link.id.value });

    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.totalClicks, 150);
      assert.equal(result.value.clicksByCountry["US"], 100);
    }
  });

  it("should return error when link not found", async () => {
    const result = await useCase.execute({ linkId: TrackedLinkId.generate().value });

    assert.ok(!result.ok);
  });
});

describe("DeleteTrackedLinkUseCase", { concurrency: 1 }, () => {
  let useCase: DeleteTrackedLinkUseCase;
  let mockRepo: ReturnType<typeof createMockRepository>;

  beforeEach((t) => {
    mockRepo = createMockRepository(t);
    useCase = new DeleteTrackedLinkUseCase(mockRepo);
  });

  it("should delete a tracked link", async () => {
    const projectId = ProjectId.generate();
    const linkResult = TrackedLink.create({
      projectId,
      originalUrl: "https://example.com",
    });
    assert.ok(linkResult.ok);
    const link = linkResult.value;

    mockRepo.findById.mock.mockImplementation(async () => ok(link));

    const result = await useCase.execute({ linkId: link.id.value });

    assert.ok(result.ok);
    assert.equal(mockRepo.delete.mock.calls.length, 1);
  });

  it("should return error when link not found", async () => {
    const result = await useCase.execute({ linkId: TrackedLinkId.generate().value });

    assert.ok(!result.ok);
  });
});
