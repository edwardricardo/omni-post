/**
 * @file createStorageAdapter.test.ts
 * @description Unit tests for the storage adapter factory: each STORAGE_PROVIDER value builds its
 *              adapter from the mapped env, a missing required variable is refused and named, the
 *              S3 credential pair is both-or-neither (neither leaves the SDK default chain in
 *              charge), and the default `local` provider builds with no storage variable at all.
 *              Both adapter packages are replaced by recording doubles and the env module by a
 *              mutable object.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEnv, s3Factory, spacesFactory } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, string | undefined>,
  s3Factory: vi.fn((config: unknown) => ({ kind: "s3", config })),
  spacesFactory: vi.fn((config: unknown) => ({ kind: "do-spaces", config })),
}));

vi.mock("../../../../src/config/env.js", () => ({ env: mockEnv }));
vi.mock("@adapters/storage-s3", () => ({ createS3StorageAdapter: s3Factory }));
vi.mock("@adapters/storage-do-spaces", () => ({
  createDigitalOceanSpacesAdapter: spacesFactory,
}));

const { createStorageAdapter } =
  await import("../../../../src/infrastructure/storage/createStorageAdapter.js");

const SPACES_ENV: Record<string, string> = {
  STORAGE_PROVIDER: "do-spaces",
  DO_SPACES_BUCKET: "omni-spaces",
  DO_SPACES_REGION: "fra1",
  DO_SPACES_KEY: "spaces-key",
  DO_SPACES_SECRET: "spaces-secret",
  DO_SPACES_ENDPOINT: "fra1.digitaloceanspaces.com",
};

const S3_ENV: Record<string, string> = {
  STORAGE_PROVIDER: "s3",
  S3_BUCKET: "omni-media",
  S3_REGION: "eu-west-1",
  S3_ACCESS_KEY_ID: "s3-key-id",
  S3_SECRET_ACCESS_KEY: "s3-secret",
};

const useEnv = (values: Record<string, string>): void => {
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
  Object.assign(mockEnv, values);
};

const without = (values: Record<string, string>, key: string): Record<string, string> =>
  Object.fromEntries(Object.entries(values).filter(([name]) => name !== key));

const firstConfig = (factory: typeof s3Factory): Record<string, unknown> =>
  factory.mock.calls[0]?.[0] as Record<string, unknown>;

describe("createStorageAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("STORAGE_PROVIDER=do-spaces", () => {
    it("returns the Spaces adapter built from the DO_SPACES_* variables", () => {
      useEnv(SPACES_ENV);

      const adapter = createStorageAdapter();

      expect(spacesFactory).toHaveBeenCalledTimes(1);
      expect(spacesFactory).toHaveBeenCalledWith({
        bucket: "omni-spaces",
        region: "fra1",
        key: "spaces-key",
        secret: "spaces-secret",
        endpoint: "fra1.digitaloceanspaces.com",
      });
      expect(adapter).toBe(spacesFactory.mock.results[0]?.value);
      expect(s3Factory).not.toHaveBeenCalled();
    });

    it.each([
      "DO_SPACES_BUCKET",
      "DO_SPACES_REGION",
      "DO_SPACES_KEY",
      "DO_SPACES_SECRET",
      "DO_SPACES_ENDPOINT",
    ])("throws naming %s when it is unset", (key) => {
      useEnv(without(SPACES_ENV, key));

      expect(() => createStorageAdapter()).toThrow(new RegExp(`\\b${key}\\b`));
      expect(spacesFactory).not.toHaveBeenCalled();
    });
  });

  describe("STORAGE_PROVIDER=s3", () => {
    it("returns the S3 adapter built from the S3_* variables, with no endpoint for AWS", () => {
      useEnv(S3_ENV);

      const adapter = createStorageAdapter();

      expect(s3Factory).toHaveBeenCalledTimes(1);
      expect(firstConfig(s3Factory)).toEqual({
        bucket: "omni-media",
        region: "eu-west-1",
        accessKeyId: "s3-key-id",
        secretAccessKey: "s3-secret",
      });
      expect(adapter).toBe(s3Factory.mock.results[0]?.value);
    });

    it("forwards S3_ENDPOINT for an S3-compatible backend", () => {
      useEnv({ ...S3_ENV, S3_ENDPOINT: "http://omnipost-infra:9000" });

      createStorageAdapter();

      expect(firstConfig(s3Factory)).toMatchObject({ endpoint: "http://omnipost-infra:9000" });
    });

    it("builds without credentials when neither key is set, leaving them to the SDK default chain", () => {
      useEnv({ STORAGE_PROVIDER: "s3", S3_BUCKET: "omni-media", S3_REGION: "eu-west-1" });

      createStorageAdapter();

      expect(firstConfig(s3Factory)).toEqual({ bucket: "omni-media", region: "eu-west-1" });
    });

    it.each(["S3_BUCKET", "S3_REGION"])("throws naming %s when it is unset", (key) => {
      useEnv(without(S3_ENV, key));

      expect(() => createStorageAdapter()).toThrow(new RegExp(`\\b${key}\\b`));
      expect(s3Factory).not.toHaveBeenCalled();
    });
  });

  describe.each(["s3", "local"])("STORAGE_PROVIDER=%s credential pair", (provider) => {
    it.each([
      ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"],
      ["S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID"],
    ])("throws naming %s when only %s is set", (missing, present) => {
      useEnv({
        STORAGE_PROVIDER: provider,
        S3_BUCKET: "omni-media",
        S3_REGION: "eu-west-1",
        [present]: "half-of-a-pair",
      });

      expect(() => createStorageAdapter()).toThrow(new RegExp(`\\b${missing}\\b`));
      expect(s3Factory).not.toHaveBeenCalled();
    });
  });

  describe("STORAGE_PROVIDER=local", () => {
    it("builds with no storage variable, leaving credentials to the SDK default chain", () => {
      useEnv({ STORAGE_PROVIDER: "local" });

      createStorageAdapter();

      expect(firstConfig(s3Factory)).toEqual({ bucket: "omni-post-media", region: "us-east-1" });
    });

    it("forwards a complete credential pair, bucket, region and endpoint when set", () => {
      useEnv({
        STORAGE_PROVIDER: "local",
        S3_BUCKET: "dev-media",
        S3_REGION: "eu-central-1",
        S3_ACCESS_KEY_ID: "minio-user",
        S3_SECRET_ACCESS_KEY: "minio-password",
        S3_ENDPOINT: "http://localhost:9000",
      });

      createStorageAdapter();

      expect(firstConfig(s3Factory)).toEqual({
        bucket: "dev-media",
        region: "eu-central-1",
        accessKeyId: "minio-user",
        secretAccessKey: "minio-password",
        endpoint: "http://localhost:9000",
      });
    });
  });
});
