/**
 * @file index.test.ts
 * @description Unit tests for createGcsStorageAdapter: how the config maps onto the
 *              `@google-cloud/storage` client, and how the adapter turns SDK results and
 *              failures into StoragePort results. The SDK is replaced by a recording double, so
 *              no request leaves the process.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { storageOptions, bucketNames, getSignedUrl, getMetadata } = vi.hoisted(() => ({
  storageOptions: vi.fn(),
  bucketNames: vi.fn(),
  getSignedUrl: vi.fn(),
  getMetadata: vi.fn(),
}));

vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    constructor(options: unknown) {
      storageOptions(options);
    }
    bucket(name: string) {
      bucketNames(name);
      return { file: () => ({ getSignedUrl, getMetadata }) };
    }
  },
}));

const { createGcsStorageAdapter } = await import("../src/index.js");

const BASE_CONFIG = { projectId: "omni-project", bucketName: "omni-media" };
const SERVICE_ACCOUNT_KEY = {
  type: "service_account",
  client_email: "uploader@omni-project.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----\n",
};
const toBase64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64");

describe("createGcsStorageAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes only the project id when no key is configured, so ADC resolves credentials", () => {
    createGcsStorageAdapter(BASE_CONFIG);

    expect(storageOptions).toHaveBeenCalledWith({ projectId: "omni-project" });
    expect(bucketNames).toHaveBeenCalledWith("omni-media");
  });

  it("maps keyFilePath to the SDK keyFilename option", () => {
    createGcsStorageAdapter({ ...BASE_CONFIG, keyFilePath: "/secrets/gcs.json" });

    expect(storageOptions).toHaveBeenCalledWith({
      projectId: "omni-project",
      keyFilename: "/secrets/gcs.json",
    });
  });

  it("decodes a base64 service-account key into the SDK credentials option", () => {
    createGcsStorageAdapter({ ...BASE_CONFIG, keyJson: toBase64(SERVICE_ACCOUNT_KEY) });

    expect(storageOptions).toHaveBeenCalledWith({
      projectId: "omni-project",
      credentials: SERVICE_ACCOUNT_KEY,
    });
  });

  it("throws at construction when keyJson is not a service-account key", () => {
    expect(() =>
      createGcsStorageAdapter({ ...BASE_CONFIG, keyJson: toBase64({ client_email: "x" }) })
    ).toThrow("GCS keyJson must be a base64-encoded service-account JSON key");
    expect(() => createGcsStorageAdapter({ ...BASE_CONFIG, keyJson: "not-base64-json" })).toThrow(
      "GCS keyJson must be a base64-encoded service-account JSON key"
    );
  });

  it("returns a v4 write URL bound to the content type when the type is allowed", async () => {
    getSignedUrl.mockResolvedValue(["https://storage.googleapis.com/signed"]);
    const adapter = createGcsStorageAdapter(BASE_CONFIG);

    const result = await adapter.generateUploadSignature("photo.png", "image/png");

    expect(result.ok && result.value.url).toBe("https://storage.googleapis.com/signed");
    expect(getSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({ version: "v4", action: "write", contentType: "image/png" })
    );
  });

  it("returns INVALID_TYPE without calling the SDK when the content type is not allowed", async () => {
    const adapter = createGcsStorageAdapter(BASE_CONFIG);

    const result = await adapter.generateUploadSignature("notes.txt", "text/plain");

    expect(result).toEqual({ ok: false, error: "INVALID_TYPE" });
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the SDK reports a missing object", async () => {
    getMetadata.mockRejectedValue(Object.assign(new Error("No such object"), { code: 404 }));
    const adapter = createGcsStorageAdapter(BASE_CONFIG);

    const result = await adapter.getMediaMetadata(
      "https://storage.googleapis.com/omni-media/a.png"
    );

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
