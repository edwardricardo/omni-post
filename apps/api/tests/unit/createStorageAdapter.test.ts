/**
 * @file createStorageAdapter.test.ts
 * @description Unit tests for the storage adapter factory. Verifies that the
 *              S3 path forwards S3_ENDPOINT (S3-compatible backends such as
 *              MinIO) only when set, and applies sane defaults otherwise.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEnv, s3Spy } = vi.hoisted(() => ({
  mockEnv: { STORAGE_PROVIDER: "s3" } as Record<string, unknown>,
  s3Spy: vi.fn((cfg: unknown) => cfg),
}));

vi.mock("../../src/config/env.js", () => ({ env: mockEnv }));
vi.mock("@adapters/storage-s3", () => ({ createS3StorageAdapter: s3Spy }));

const { createStorageAdapter } =
  await import("../../src/infrastructure/storage/createStorageAdapter.js");

describe("createStorageAdapter", () => {
  beforeEach(() => {
    s3Spy.mockClear();
    for (const k of Object.keys(mockEnv)) delete mockEnv[k];
    mockEnv.STORAGE_PROVIDER = "s3";
  });

  it("forwards S3_ENDPOINT to the S3 adapter when set (MinIO / S3-compatible)", () => {
    mockEnv.S3_ENDPOINT = "http://omnipost-infra:9000";

    createStorageAdapter();

    expect(s3Spy).toHaveBeenCalledTimes(1);
    expect(s3Spy.mock.calls[0]?.[0]).toMatchObject({
      endpoint: "http://omnipost-infra:9000",
    });
  });

  it("omits the endpoint key entirely when S3_ENDPOINT is unset (AWS S3)", () => {
    createStorageAdapter();

    const config = s3Spy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("endpoint" in config).toBe(false);
  });

  it("applies bucket/region defaults when S3_* are unset", () => {
    createStorageAdapter();

    expect(s3Spy.mock.calls[0]?.[0]).toMatchObject({
      bucket: "omni-post-media",
      region: "us-east-1",
    });
  });
});
