/**
 * @file index.test.ts
 * @description Unit tests for createAzureBlobStorageAdapter: how the config maps onto the
 *              `@azure/storage-blob` clients, and how the adapter turns SDK results and failures
 *              into StoragePort results. The SDK is replaced by a recording double, so no request
 *              leaves the process.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { credentialArgs, serviceArgs, containerNames, sasArgs, getProperties } = vi.hoisted(() => ({
  credentialArgs: vi.fn(),
  serviceArgs: vi.fn(),
  containerNames: vi.fn(),
  sasArgs: vi.fn(),
  getProperties: vi.fn(),
}));

vi.mock("@azure/storage-blob", () => ({
  StorageSharedKeyCredential: class {
    constructor(accountName: string, accountKey: string) {
      credentialArgs(accountName, accountKey);
    }
  },
  BlobServiceClient: class {
    constructor(url: string, credential: unknown) {
      serviceArgs(url, credential);
    }
    getContainerClient(name: string) {
      containerNames(name);
      return {
        getBlockBlobClient: (blobName: string) => ({
          url: `https://omniacct.blob.core.windows.net/${name}/${blobName}`,
          getProperties,
        }),
      };
    }
  },
  BlobSASPermissions: class {
    create = false;
    write = false;
  },
  generateBlobSASQueryParameters: (options: unknown, credential: unknown) => {
    sasArgs(options, credential);
    return { toString: () => "sv=fixture&sig=fixture" };
  },
}));

const { createAzureBlobStorageAdapter } = await import("../src/index.js");

const CONFIG = { accountName: "omniacct", accountKey: "fixture-key", containerName: "media" };

describe("createAzureBlobStorageAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a shared-key credential and the account blob endpoint from the config", () => {
    createAzureBlobStorageAdapter(CONFIG);

    expect(credentialArgs).toHaveBeenCalledWith("omniacct", "fixture-key");
    expect(serviceArgs).toHaveBeenCalledWith(
      "https://omniacct.blob.core.windows.net",
      expect.anything()
    );
    expect(containerNames).toHaveBeenCalledWith("media");
  });

  it("returns a SAS URL granting create and write on the blob when the type is allowed", async () => {
    const adapter = createAzureBlobStorageAdapter(CONFIG);

    const result = await adapter.generateUploadSignature("clip.mp4", "video/mp4");

    expect(result.ok && result.value.url).toMatch(
      /^https:\/\/omniacct\.blob\.core\.windows\.net\/media\/\d+-clip\.mp4\?sv=fixture&sig=fixture$/
    );
    expect(result.ok && result.value.fields["x-ms-blob-type"]).toBe("BlockBlob");
    expect(sasArgs).toHaveBeenCalledWith(
      expect.objectContaining({
        containerName: "media",
        contentType: "video/mp4",
        permissions: expect.objectContaining({ create: true, write: true }),
      }),
      expect.anything()
    );
  });

  it("returns INVALID_TYPE without signing when the content type is not allowed", async () => {
    const adapter = createAzureBlobStorageAdapter(CONFIG);

    const result = await adapter.generateUploadSignature("notes.txt", "text/plain");

    expect(result).toEqual({ ok: false, error: "INVALID_TYPE" });
    expect(sasArgs).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the SDK reports a missing blob", async () => {
    getProperties.mockRejectedValue(Object.assign(new Error("BlobNotFound"), { statusCode: 404 }));
    const adapter = createAzureBlobStorageAdapter(CONFIG);

    const result = await adapter.getMediaMetadata(
      "https://omniacct.blob.core.windows.net/media/a.png"
    );

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
