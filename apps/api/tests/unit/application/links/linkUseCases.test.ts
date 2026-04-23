/**
 * Application Layer - Link Tracking Use Cases Tests
 *
 * Tests for CreateTrackedLink, GetTrackedLink, RedirectAndTrackClick,
 * GetLinkStats, and DeleteTrackedLink use cases.
 *
 * @file linkUseCases.test.ts
 * @description Tests for CreateTrackedLinkUseCase
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
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
function createMockRepository() {
  return {
    save: vi.fn(async () => ok(undefined)),
    findById: vi.fn(async () => err(new EntityNotFoundError("TrackedLink", "test"))),
    findByShortCode: vi.fn(async () => err(new EntityNotFoundError("TrackedLink", "test"))),
    findByProjectId: vi.fn(async () => []),
    delete: vi.fn(async () => ok(undefined)),
    recordClick: vi.fn(async () => ok(undefined)),
    getClickStats: vi.fn(async () => ({
      totalClicks: 0,
      clicksByCountry: {},
    })),
    isShortCodeAvailable: vi.fn(async () => true),
  };
}

describe("CreateTrackedLinkUseCase", () => {
  let useCase: CreateTrackedLinkUseCase;
  let mockRepo: ReturnType<typeof createMockRepository>;

  beforeEach(() => {
    mockRepo = createMockRepository();
    useCase = new CreateTrackedLinkUseCase(mockRepo);
  });

  it("should create a tracked link with valid input", async () => {
    const input: CreateTrackedLinkInput = {
      projectId: ProjectId.generate().value,
      originalUrl: "https://example.com/my-page",
    };

    const result = await useCase.execute(input);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.id).toBeTruthy();
      expect(result.value.originalUrl).toBe(input.originalUrl);
      expect(result.value.shortCode).toBeTruthy();
    }
    expect(mockRepo.save.mock.calls.length).toBe(1);
  });

  it("should create a tracked link with vanity slug", async () => {
    const input: CreateTrackedLinkInput = {
      projectId: ProjectId.generate().value,
      originalUrl: "https://example.com/campaign",
      vanitySlug: "summer-sale",
    };

    const result = await useCase.execute(input);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.vanitySlug).toBe("summer-sale");
    }
  });

  it("should fail with invalid URL", async () => {
    const input: CreateTrackedLinkInput = {
      projectId: ProjectId.generate().value,
      originalUrl: "not-a-valid-url",
    };

    const result = await useCase.execute(input);

    expect(result.ok).toBeFalsy();
  });

  it("should fail with invalid project ID", async () => {
    const input: CreateTrackedLinkInput = {
      projectId: "invalid-id",
      originalUrl: "https://example.com",
    };

    const result = await useCase.execute(input);

    expect(result.ok).toBeFalsy();
  });

  it("should fail when vanity slug is already taken", async () => {
    mockRepo.isShortCodeAvailable.mockImplementation(async () => false);

    const input: CreateTrackedLinkInput = {
      projectId: ProjectId.generate().value,
      originalUrl: "https://example.com",
      vanitySlug: "taken-slug",
    };

    const result = await useCase.execute(input);

    expect(result.ok).toBeFalsy();
  });
});

describe("GetTrackedLinkUseCase", () => {
  let useCase: GetTrackedLinkUseCase;
  let mockRepo: ReturnType<typeof createMockRepository>;

  beforeEach(() => {
    mockRepo = createMockRepository();
    useCase = new GetTrackedLinkUseCase(mockRepo);
  });

  it("should return link when found by ID", async () => {
    const projectId = ProjectId.generate();
    const linkResult = TrackedLink.create({
      projectId,
      originalUrl: "https://example.com",
    });
    expect(linkResult.ok).toBeTruthy();
    const link = linkResult.value;

    mockRepo.findById.mockImplementation(async () => ok(link));

    const result = await useCase.execute({ linkId: link.id.value });

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.id).toBe(link.id.value);
    }
  });

  it("should return error when link not found", async () => {
    const result = await useCase.execute({ linkId: TrackedLinkId.generate().value });

    expect(result.ok).toBeFalsy();
  });
});

describe("RedirectAndTrackClickUseCase", () => {
  let useCase: RedirectAndTrackClickUseCase;
  let mockRepo: ReturnType<typeof createMockRepository>;

  beforeEach(() => {
    mockRepo = createMockRepository();
    useCase = new RedirectAndTrackClickUseCase(mockRepo);
  });

  it("should return original URL and record click", async () => {
    const projectId = ProjectId.generate();
    const linkResult = TrackedLink.create({
      projectId,
      originalUrl: "https://example.com/target",
    });
    expect(linkResult.ok).toBeTruthy();
    const link = linkResult.value;

    mockRepo.findByShortCode.mockImplementation(async () => ok(link));

    const input: RedirectInput = {
      shortCode: link.shortCode.value,
      referrer: "https://twitter.com",
      userAgent: "Mozilla/5.0",
      ipAddress: "192.168.1.1",
      country: "US",
      city: "New York",
    };

    const result = await useCase.execute(input);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.originalUrl).toBe("https://example.com/target");
    }
    expect(mockRepo.recordClick.mock.calls.length).toBe(1);
  });

  it("should return error for non-existent short code", async () => {
    const result = await useCase.execute({ shortCode: "non-existent" });

    expect(result.ok).toBeFalsy();
  });

  it("should return error for inactive link", async () => {
    const projectId = ProjectId.generate();
    const linkResult = TrackedLink.create({
      projectId,
      originalUrl: "https://example.com",
    });
    expect(linkResult.ok).toBeTruthy();
    const link = linkResult.value;
    link.deactivate();

    mockRepo.findByShortCode.mockImplementation(async () => ok(link));

    const result = await useCase.execute({ shortCode: link.shortCode.value });

    expect(result.ok).toBeFalsy();
  });
});

describe("GetLinkStatsUseCase", () => {
  let useCase: GetLinkStatsUseCase;
  let mockRepo: ReturnType<typeof createMockRepository>;

  beforeEach(() => {
    mockRepo = createMockRepository();
    useCase = new GetLinkStatsUseCase(mockRepo);
  });

  it("should return statistics for a link", async () => {
    const projectId = ProjectId.generate();
    const linkResult = TrackedLink.create({
      projectId,
      originalUrl: "https://example.com",
    });
    expect(linkResult.ok).toBeTruthy();
    const link = linkResult.value;

    mockRepo.findById.mockImplementation(async () => ok(link));
    mockRepo.getClickStats.mockImplementation(async () => ({
      totalClicks: 150,
      clicksByCountry: { US: 100, UK: 50 },
    }));

    const result = await useCase.execute({ linkId: link.id.value });

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.totalClicks).toBe(150);
      expect(result.value.clicksByCountry["US"]).toBe(100);
    }
  });

  it("should return error when link not found", async () => {
    const result = await useCase.execute({ linkId: TrackedLinkId.generate().value });

    expect(result.ok).toBeFalsy();
  });
});

describe("DeleteTrackedLinkUseCase", () => {
  let useCase: DeleteTrackedLinkUseCase;
  let mockRepo: ReturnType<typeof createMockRepository>;

  beforeEach(() => {
    mockRepo = createMockRepository();
    useCase = new DeleteTrackedLinkUseCase(mockRepo);
  });

  it("should delete a tracked link", async () => {
    const projectId = ProjectId.generate();
    const linkResult = TrackedLink.create({
      projectId,
      originalUrl: "https://example.com",
    });
    expect(linkResult.ok).toBeTruthy();
    const link = linkResult.value;

    mockRepo.findById.mockImplementation(async () => ok(link));

    const result = await useCase.execute({ linkId: link.id.value });

    expect(result.ok).toBeTruthy();
    expect(mockRepo.delete.mock.calls.length).toBe(1);
  });

  it("should return error when link not found", async () => {
    const result = await useCase.execute({ linkId: TrackedLinkId.generate().value });

    expect(result.ok).toBeFalsy();
  });
});
