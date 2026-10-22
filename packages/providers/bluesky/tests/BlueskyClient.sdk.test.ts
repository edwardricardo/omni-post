/**
 * @file BlueskyClient.sdk.test.ts
 * @description Contract tests that run BlueskyClient against the installed @atproto/api SDK,
 *   with `fetch` replaced at the network boundary by an in-memory XRPC service. They pin the
 *   requests the provider sends (session creation, blob upload, record creation, post search) and
 *   the way it maps the responses, so an SDK upgrade that changes the wire contract fails here
 *   rather than in production. The sibling BlueskyClient.test.ts mocks the SDK module itself and
 *   cannot see such a change.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { BlueskyClient } from "../src/BlueskyClient.js";

// ---------------------------------------------------------------------------
// In-memory XRPC service
// ---------------------------------------------------------------------------

interface RecordedRequest {
  method: string;
  nsid: string;
  params: URLSearchParams;
  headers: Headers;
  body: Uint8Array;
}

type XrpcHandler = (request: RecordedRequest) => Response;

const SESSION = {
  accessJwt: "fixture-access-token",
  refreshJwt: "fixture-refresh-token",
  did: "did:plc:omnipostfixture",
  handle: "omnipost.bsky.social",
} as const;

/** A CIDv1 with the dag-cbor codec, the shape the PDS returns for a created record. */
const RECORD_CID = "bafyreidfayvfuwqa7qlnopdjiqrxzs6blmoeu4rujcjtnci5beludirz2a";
/** A CIDv1 with the raw codec, the shape the PDS returns for an uploaded blob. */
const BLOB_CID = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
const POST_URI = `at://${SESSION.did}/app.bsky.feed.post/3lpostfixture1`;

let handlers: Map<string, XrpcHandler>;
let requests: RecordedRequest[];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function xrpcError(status: number, error: string): Response {
  return jsonResponse(status, { error, message: `${error} from the fixture service` });
}

function defaultHandlers(): Map<string, XrpcHandler> {
  return new Map<string, XrpcHandler>([
    ["com.atproto.server.createSession", () => jsonResponse(200, SESSION)],
    ["com.atproto.repo.createRecord", () => jsonResponse(200, { uri: POST_URI, cid: RECORD_CID })],
    [
      "com.atproto.repo.uploadBlob",
      (request) =>
        jsonResponse(200, {
          blob: {
            $type: "blob",
            ref: { $link: BLOB_CID },
            mimeType: request.headers.get("content-type") ?? "application/octet-stream",
            size: request.body.byteLength,
          },
        }),
    ],
    ["app.bsky.feed.searchPosts", () => jsonResponse(200, { posts: [] })],
  ]);
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  const nsid = url.pathname.replace(/^\/xrpc\//, "");
  const recorded: RecordedRequest = {
    method: request.method,
    nsid,
    params: url.searchParams,
    headers: request.headers,
    body: new Uint8Array(await request.arrayBuffer()),
  };
  requests.push(recorded);
  const handler = handlers.get(nsid);
  return handler ? handler(recorded) : xrpcError(501, "MethodNotImplemented");
}

function requestsTo(nsid: string): RecordedRequest[] {
  return requests.filter((request) => request.nsid === nsid);
}

function jsonBody(request: RecordedRequest | undefined): Record<string, unknown> {
  assert.ok(request, "the request should have been sent");
  return JSON.parse(new TextDecoder().decode(request.body)) as Record<string, unknown>;
}

/** The record a createRecord request carried, or a failed assertion if there was none. */
function createdRecord(): Record<string, unknown> {
  const body = jsonBody(requestsTo("com.atproto.repo.createRecord")[0]);
  return body.record as Record<string, unknown>;
}

/** The UTF-8 byte range of the first occurrence of `fragment` in `text`. */
function byteRange(text: string, fragment: string): { byteStart: number; byteEnd: number } {
  const start = text.indexOf(fragment);
  assert.ok(start >= 0, `"${fragment}" should occur in the text`);
  const encoder = new TextEncoder();
  const byteStart = encoder.encode(text.slice(0, start)).byteLength;
  return { byteStart, byteEnd: byteStart + encoder.encode(fragment).byteLength };
}

/** Bytes that open with a PNG signature and an IHDR chunk declaring the given size. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function makeClient(): BlueskyClient {
  return new BlueskyClient({ identifier: SESSION.handle, appPassword: "fixture-app-password" });
}

async function loggedInClient(): Promise<BlueskyClient> {
  const client = makeClient();
  const login = await client.login();
  assert.ok(login.ok, "the fixture service should accept the login");
  return client;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("BlueskyClient against the @atproto/api SDK", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    handlers = defaultHandlers();
    requests = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(fakeFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("login", () => {
    it("returns the session when createSession accepts the identifier and app password", async () => {
      const client = makeClient();

      const result = await client.login();

      assert.ok(result.ok);
      assert.deepEqual(result.value, SESSION);
      const body = jsonBody(requestsTo("com.atproto.server.createSession")[0]);
      assert.equal(body.identifier, SESSION.handle);
      assert.equal(body.password, "fixture-app-password");
    });

    it("returns AUTH when createSession rejects the credentials", async () => {
      handlers.set("com.atproto.server.createSession", () =>
        xrpcError(401, "AuthenticationRequired")
      );
      const client = makeClient();

      const result = await client.login();

      assert.ok(!result.ok);
      assert.equal(result.error, "AUTH");
    });
  });

  describe("publishText", () => {
    it("creates an app.bsky.feed.post record in the session's repo with the access token", async () => {
      const client = await loggedInClient();

      const result = await client.publishText("Hello from OmniPost");

      assert.ok(result.ok);
      assert.deepEqual(result.value, { uri: POST_URI, cid: RECORD_CID });
      const request = requestsTo("com.atproto.repo.createRecord")[0];
      assert.equal(request?.method, "POST");
      assert.equal(request?.headers.get("authorization"), `Bearer ${SESSION.accessJwt}`);
      const body = jsonBody(request);
      assert.equal(body.repo, SESSION.did);
      assert.equal(body.collection, "app.bsky.feed.post");
      const record = createdRecord();
      assert.equal(record.$type, "app.bsky.feed.post");
      assert.equal(record.text, "Hello from OmniPost");
      assert.ok(!Number.isNaN(Date.parse(String(record.createdAt))), "createdAt is a datetime");
      assert.equal(Object.prototype.hasOwnProperty.call(record, "facets"), false);
    });

    it("publishes a link facet spanning the URL's UTF-8 bytes", async () => {
      const client = await loggedInClient();
      const text = "Read ✨ https://example.com/docs";

      await client.publishText(text);

      const start = new TextEncoder().encode("Read ✨ ").byteLength;
      expect(createdRecord().facets).toEqual([
        {
          index: { byteStart: start, byteEnd: new TextEncoder().encode(text).byteLength },
          features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://example.com/docs" }],
        },
      ]);
    });

    it("publishes tag facets for hashtags and for cashtags", async () => {
      const client = await loggedInClient();

      await client.publishText("Watching $aapl with #omnipost");

      const features = (createdRecord().facets as Array<{ features: unknown[] }>).flatMap(
        (facet) => facet.features
      );
      expect(features).toEqual(
        expect.arrayContaining([
          { $type: "app.bsky.richtext.facet#tag", tag: "$AAPL" },
          { $type: "app.bsky.richtext.facet#tag", tag: "omnipost" },
        ])
      );
    });

    it("drops a mention facet whose handle does not resolve and keeps the text and other facets", async () => {
      const client = await loggedInClient();
      const text = "Ask @ghost.bsky.social about #omnipost at https://example.com/docs";

      const result = await client.publishText(text);

      assert.ok(result.ok);
      assert.equal(requestsTo("com.atproto.identity.resolveHandle").length, 1);
      const record = createdRecord();
      assert.equal(record.text, text);
      expect(record.facets).toEqual([
        {
          index: byteRange(text, "#omnipost"),
          features: [{ $type: "app.bsky.richtext.facet#tag", tag: "omnipost" }],
        },
        {
          index: byteRange(text, "https://example.com/docs"),
          features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://example.com/docs" }],
        },
      ]);
    });

    it("keeps a mention facet whose handle resolves, carrying the resolved DID", async () => {
      handlers.set("com.atproto.identity.resolveHandle", (request) =>
        request.params.get("handle") === "friend.bsky.social"
          ? jsonResponse(200, { did: "did:plc:friendfixture" })
          : xrpcError(400, "InvalidRequest")
      );
      const client = await loggedInClient();
      const text = "Thanks @friend.bsky.social";

      await client.publishText(text);

      expect(createdRecord().facets).toEqual([
        {
          $type: "app.bsky.richtext.facet",
          index: byteRange(text, "@friend.bsky.social"),
          features: [{ $type: "app.bsky.richtext.facet#mention", did: "did:plc:friendfixture" }],
        },
      ]);
    });

    it("returns PUBLISH when createRecord fails", async () => {
      handlers.set("com.atproto.repo.createRecord", () => xrpcError(400, "InvalidRequest"));
      const client = await loggedInClient();

      const result = await client.publishText("Hello");

      assert.ok(!result.ok);
      assert.equal(result.error, "PUBLISH");
    });
  });

  describe("publishWithImages", () => {
    it("uploads each image and embeds the returned blob refs with alt text and aspect ratio", async () => {
      const client = await loggedInClient();
      const first = pngHeader(640, 480);
      const second = pngHeader(1080, 1350);

      const result = await client.publishWithImages("Two images", [first, second], ["First alt"]);

      assert.ok(result.ok);
      const uploads = requestsTo("com.atproto.repo.uploadBlob");
      assert.equal(uploads.length, 2);
      for (const upload of uploads) {
        assert.equal(upload.method, "POST");
        assert.equal(upload.headers.get("content-type"), "image/jpeg");
        assert.equal(upload.headers.get("authorization"), `Bearer ${SESSION.accessJwt}`);
      }
      assert.deepEqual(
        uploads.map((upload) => Array.from(upload.body)),
        [Array.from(first), Array.from(second)]
      );
      const blob = (size: number) => ({
        $type: "blob",
        ref: { $link: BLOB_CID },
        mimeType: "image/jpeg",
        size,
      });
      expect(createdRecord().embed).toEqual({
        $type: "app.bsky.embed.images",
        images: [
          {
            image: blob(first.byteLength),
            alt: "First alt",
            aspectRatio: { width: 640, height: 480 },
          },
          { image: blob(second.byteLength), alt: "", aspectRatio: { width: 1080, height: 1350 } },
        ],
      });
    });

    it("drops a mention facet whose handle does not resolve, omitting facets when none is left", async () => {
      const client = await loggedInClient();
      const text = "Photo by @ghost.bsky.social";

      const result = await client.publishWithImages(text, [pngHeader(10, 10)], ["alt"]);

      assert.ok(result.ok);
      const record = createdRecord();
      assert.equal(record.text, text);
      assert.equal(Object.prototype.hasOwnProperty.call(record, "facets"), false);
    });

    it("returns PUBLISH when uploadBlob fails and creates no record", async () => {
      handlers.set("com.atproto.repo.uploadBlob", () => xrpcError(400, "BlobTooLarge"));
      const client = await loggedInClient();

      const result = await client.publishWithImages("Image", [pngHeader(10, 10)], ["alt"]);

      assert.ok(!result.ok);
      assert.equal(result.error, "PUBLISH");
      assert.equal(requestsTo("com.atproto.repo.createRecord").length, 0);
    });
  });

  describe("searchPosts", () => {
    it("queries app.bsky.feed.searchPosts sorted by latest with the window and cursor", async () => {
      const client = await loggedInClient();

      await client.searchPosts('omnipost OR "omni post"', 250, "2026-10-01T00:00:00.000Z", "c-1");

      const request = requestsTo("app.bsky.feed.searchPosts")[0];
      assert.equal(request?.method, "GET");
      assert.equal(request?.headers.get("authorization"), `Bearer ${SESSION.accessJwt}`);
      assert.deepEqual(Object.fromEntries(request?.params ?? []), {
        q: 'omnipost OR "omni post"',
        limit: "100",
        sort: "latest",
        since: "2026-10-01T00:00:00.000Z",
        cursor: "c-1",
      });
    });

    it("maps post views to mentions, falling back to indexedAt when the record has no createdAt", async () => {
      handlers.set("app.bsky.feed.searchPosts", () =>
        jsonResponse(200, {
          cursor: "c-2",
          posts: [
            {
              uri: "at://did:plc:authorone/app.bsky.feed.post/3lmention1",
              cid: RECORD_CID,
              author: {
                did: "did:plc:authorone",
                handle: "author-one.bsky.social",
                displayName: "Author One",
                avatar: "https://cdn.bsky.app/img/avatar/plain/did:plc:authorone/a@jpeg",
              },
              record: {
                $type: "app.bsky.feed.post",
                text: "omnipost ships",
                createdAt: "2026-10-20T10:00:00.000Z",
                langs: ["en", "es"],
              },
              indexedAt: "2026-10-20T10:00:05.000Z",
            },
            {
              uri: "at://did:plc:authortwo/app.bsky.feed.post/3lmention2",
              cid: RECORD_CID,
              author: { did: "did:plc:authortwo", handle: "author-two.bsky.social" },
              record: { $type: "app.bsky.feed.post", text: "omni post" },
              indexedAt: "2026-10-21T08:30:00.000Z",
            },
          ],
        })
      );
      const client = await loggedInClient();

      const result = await client.searchPosts("omnipost");

      assert.ok(result.ok);
      assert.deepEqual(result.value, {
        cursor: "c-2",
        posts: [
          {
            uri: "at://did:plc:authorone/app.bsky.feed.post/3lmention1",
            cid: RECORD_CID,
            authorDid: "did:plc:authorone",
            authorHandle: "author-one.bsky.social",
            authorDisplayName: "Author One",
            authorAvatar: "https://cdn.bsky.app/img/avatar/plain/did:plc:authorone/a@jpeg",
            text: "omnipost ships",
            createdAt: "2026-10-20T10:00:00.000Z",
            lang: "en",
          },
          {
            uri: "at://did:plc:authortwo/app.bsky.feed.post/3lmention2",
            cid: RECORD_CID,
            authorDid: "did:plc:authortwo",
            authorHandle: "author-two.bsky.social",
            text: "omni post",
            createdAt: "2026-10-21T08:30:00.000Z",
          },
        ],
      });
    });

    it("returns RATE_LIMIT when the service answers 429", async () => {
      handlers.set("app.bsky.feed.searchPosts", () => xrpcError(429, "RateLimitExceeded"));
      const client = await loggedInClient();

      const result = await client.searchPosts("omnipost");

      assert.ok(!result.ok);
      assert.equal(result.error, "RATE_LIMIT");
    });

    it("returns NETWORK when the service fails with any other status", async () => {
      handlers.set("app.bsky.feed.searchPosts", () => xrpcError(502, "UpstreamFailure"));
      const client = await loggedInClient();

      const result = await client.searchPosts("omnipost");

      assert.ok(!result.ok);
      assert.equal(result.error, "NETWORK");
    });
  });
});
