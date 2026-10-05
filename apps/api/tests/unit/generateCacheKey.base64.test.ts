/**
 * @file generateCacheKey.base64.test.ts
 * @description Pins `generateCacheKey` of `@shared/types` to the key its previous implementation
 *   produced. The kernel encodes the serialized query data with `TextEncoder` and `btoa` so its
 *   root barrel loads in a browser; every case here compares that key with the one
 *   `Buffer.from(dataString).toString("base64")` gave for the same query, so a change to the
 *   encoding cannot move a cached key unnoticed.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { generateCacheKey, type Query } from "@shared/types";

const makeQuery = (overrides: Partial<Query> = {}): Query => ({
  id: "qry-cache-key",
  type: "GetCacheKeyFixture",
  data: {},
  metadata: { source: "unit-test", correlationId: "corr-cache-key" },
  timestamp: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

/**
 * The key the previous implementation produced: the data serialized exactly as
 * `generateCacheKey` serializes it (keys of an object sorted), encoded with Node's Buffer.
 */
const keyFromBufferEncoding = (query: Query): string => {
  const { type, data } = query;
  const sortedKeys = data && typeof data === "object" ? Object.keys(data).sort() : undefined;
  const serialized = JSON.stringify(data, sortedKeys);
  return `query:${type}:${Buffer.from(serialized).toString("base64").replace(/[+/=]/g, "")}`;
};

// One case per UTF-8 byte width, plus the empty and long edges. A lone surrogate never reaches
// the encoder raw: JSON.stringify writes it as the escape `\ud83d`, and the case pins that path.
const EQUIVALENT_INPUTS: Array<[label: string, data: unknown]> = [
  ["plain ASCII", { postId: "post-123", page: 2, includeDrafts: false }],
  ["multi-byte UTF-8", { title: "ñandú — façade" }],
  ["an astral code point", { reaction: "launch 🚀 done" }],
  ["a lone surrogate", { fragment: "\uD83D" }],
  ["an empty string", ""],
  ["an empty object", {}],
  ["a string longer than 64 KiB", { body: "x€😀".repeat(16 * 1024) }],
];

describe("generateCacheKey", () => {
  it.each(EQUIVALENT_INPUTS)(
    "returns the key the Buffer encoding produced when the data is %s",
    (_label, data) => {
      // Arrange
      const query = makeQuery({ data });

      // Act
      const key = generateCacheKey(query);

      // Assert
      expect(key).toBe(keyFromBufferEncoding(query));
    }
  );

  it("returns a key with an empty hash when the data is undefined", () => {
    // Arrange: JSON.stringify(undefined) is undefined, which Buffer.from rejected with an
    // unhandled TypeError (ERR_INVALID_ARG_TYPE). The encoder now reads it as no bytes. Accepted
    // because no caller passes undefined data and a key is a better answer than a crash.
    const query = makeQuery({ data: undefined });

    // Act
    const key = generateCacheKey(query);

    // Assert
    expect(key).toBe("query:GetCacheKeyFixture:");
  });
});
