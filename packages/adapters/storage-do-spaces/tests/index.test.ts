/**
 * @file index.test.ts
 * @description Unit tests for createDigitalOceanSpacesAdapter: it must hand the S3 adapter the
 *              Spaces credentials, bucket and region, plus an https endpoint built from the bare
 *              Spaces host, and return the adapter the S3 factory built. The S3 adapter is
 *              replaced by a recording double, so no request leaves the process.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { s3Config, s3Adapter } = vi.hoisted(() => ({
  s3Config: vi.fn(),
  s3Adapter: { generateUploadSignature: vi.fn(), getMediaMetadata: vi.fn() },
}));

vi.mock("@adapters/storage-s3", () => ({
  createS3StorageAdapter: (config: unknown) => {
    s3Config(config);
    return s3Adapter;
  },
}));

const { createDigitalOceanSpacesAdapter } = await import("../src/index.js");

const SPACES_CONFIG = {
  key: "spaces-key",
  secret: "spaces-secret",
  endpoint: "fra1.digitaloceanspaces.com",
  bucket: "omni-media",
  region: "fra1",
};

describe("createDigitalOceanSpacesAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps the Spaces config onto the S3 adapter with an https endpoint", () => {
    createDigitalOceanSpacesAdapter(SPACES_CONFIG);

    expect(s3Config).toHaveBeenCalledTimes(1);
    expect(s3Config).toHaveBeenCalledWith({
      accessKeyId: "spaces-key",
      secretAccessKey: "spaces-secret",
      bucket: "omni-media",
      region: "fra1",
      endpoint: "https://fra1.digitaloceanspaces.com",
    });
  });

  it("returns the adapter the S3 factory built", () => {
    expect(createDigitalOceanSpacesAdapter(SPACES_CONFIG)).toBe(s3Adapter);
  });
});
