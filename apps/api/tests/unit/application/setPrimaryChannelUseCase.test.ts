/**
 * @file setPrimaryChannelUseCase.test.ts
 * @description Unit tests for SetPrimaryChannelUseCase — covers the happy path
 *              (no previous primary), the swap path (existing primary unmarked),
 *              the idempotent path (target already primary), and failure modes
 *              (channel not found, invalid id, save errors). Uses an in-memory
 *              ChannelRepository mock and a no-op UnitOfWork.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ok, err } from "@shared/types";
import { Channel, ChannelId, ProjectId, Provider } from "../../../src/domain/index.js";
import { EntityNotFoundError } from "../../../src/domain/errors/index.js";
import { SetPrimaryChannelUseCase } from "../../../src/application/channels/SetPrimaryChannelUseCase.js";
import { USE_CASE_ERRORS } from "../../../src/application/UseCase.js";

function makeChannel(props?: {
  isPrimary?: boolean;
  projectId?: ProjectId;
  provider?: Provider;
}): Channel {
  const result = Channel.create({
    projectId: props?.projectId ?? ProjectId.generate(),
    provider: props?.provider ?? Provider.x(),
    handle: `@channel-${Math.random().toString(36).slice(2, 8)}`,
    credentials: { accessToken: "token" },
  });
  if (!result.ok) throw new Error("Channel.create failed in test fixture");
  if (props?.isPrimary) result.value.markAsPrimary();
  return result.value;
}

function createMockChannelRepository() {
  const store = new Map<string, Channel>();
  return {
    store,
    findById: vi.fn(async (id: ChannelId) => {
      const channel = store.get(id.value);
      if (!channel) return err(new EntityNotFoundError("Channel", id.value));
      return ok(channel);
    }),
    findByProjectId: vi.fn(async () => []),
    findByProjectAndProvider: vi.fn(async (projectId: ProjectId, provider: Provider) =>
      [...store.values()].filter(
        (c) => c.projectId.value === projectId.value && c.provider.type === provider.type
      )
    ),
    findPrimaryByProjectAndProvider: vi.fn(async (projectId: ProjectId, provider: Provider) => {
      const primary = [...store.values()].find(
        (c) =>
          c.projectId.value === projectId.value && c.provider.type === provider.type && c.isPrimary
      );
      if (!primary) {
        return err(
          new EntityNotFoundError("Channel", `${projectId.value}/${provider.type}/primary`)
        );
      }
      return ok(primary);
    }),
    save: vi.fn(async (channel: Channel) => {
      store.set(channel.id.value, channel);
      return ok(undefined);
    }),
    delete: vi.fn(),
    hardDelete: vi.fn(),
  };
}

function createMockUnitOfWork() {
  return {
    executeInTransaction: vi.fn(async (work: () => Promise<void>) => {
      await work();
    }),
  };
}

describe("SetPrimaryChannelUseCase", () => {
  let channelRepo: ReturnType<typeof createMockChannelRepository>;
  let unitOfWork: ReturnType<typeof createMockUnitOfWork>;
  let useCase: SetPrimaryChannelUseCase;

  beforeEach(() => {
    channelRepo = createMockChannelRepository();
    unitOfWork = createMockUnitOfWork();
    useCase = new SetPrimaryChannelUseCase(channelRepo, unitOfWork);
  });

  it("promotes a channel when no previous primary exists", async () => {
    const channel = makeChannel();
    channelRepo.store.set(channel.id.value, channel);

    const result = await useCase.execute({ channelId: channel.id.value });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(channel.id.value);
    expect(result.value.previousPrimaryId).toBeUndefined();
    expect(channel.isPrimary).toBe(true);
    expect(unitOfWork.executeInTransaction).toHaveBeenCalledTimes(1);
  });

  it("swaps the primary flag when a previous primary exists", async () => {
    const projectId = ProjectId.generate();
    const provider = Provider.x();
    const previous = makeChannel({ projectId, provider, isPrimary: true });
    const target = makeChannel({ projectId, provider });
    channelRepo.store.set(previous.id.value, previous);
    channelRepo.store.set(target.id.value, target);

    const result = await useCase.execute({ channelId: target.id.value });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.previousPrimaryId).toBe(previous.id.value);
    expect(target.isPrimary).toBe(true);
    expect(previous.isPrimary).toBe(false);
    // Both saves run inside the same transaction.
    expect(unitOfWork.executeInTransaction).toHaveBeenCalledTimes(1);
    expect(channelRepo.save).toHaveBeenCalledTimes(2);
  });

  it("is idempotent when the target is already primary", async () => {
    const channel = makeChannel({ isPrimary: true });
    channelRepo.store.set(channel.id.value, channel);

    const result = await useCase.execute({ channelId: channel.id.value });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(channel.id.value);
    expect(result.value.previousPrimaryId).toBeUndefined();
    // Idempotent — no save inside transaction needed.
    expect(channelRepo.save).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the channel does not exist", async () => {
    const result = await useCase.execute({ channelId: ChannelId.generate().value });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(USE_CASE_ERRORS.NOT_FOUND);
  });

  it("returns VALIDATION_FAILED for an invalid channel id", async () => {
    const result = await useCase.execute({ channelId: "not-a-uuid" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
  });

  it("returns INTERNAL_ERROR when saving the previous primary fails", async () => {
    const projectId = ProjectId.generate();
    const provider = Provider.x();
    const previous = makeChannel({ projectId, provider, isPrimary: true });
    const target = makeChannel({ projectId, provider });
    channelRepo.store.set(previous.id.value, previous);
    channelRepo.store.set(target.id.value, target);

    channelRepo.save.mockImplementationOnce(async () => err(new Error("DB write failed")));

    const result = await useCase.execute({ channelId: target.id.value });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(USE_CASE_ERRORS.INTERNAL_ERROR);
  });

  it("works without a UnitOfWork (test backward compat)", async () => {
    const channel = makeChannel();
    channelRepo.store.set(channel.id.value, channel);

    const useCaseWithoutUoW = new SetPrimaryChannelUseCase(channelRepo);
    const result = await useCaseWithoutUoW.execute({ channelId: channel.id.value });

    expect(result.ok).toBe(true);
    expect(channel.isPrimary).toBe(true);
  });
});
