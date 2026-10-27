/**
 * @file apiReferenceGate.integration.test.ts
 * @description Boots the real `createApp()` under the test environment, which leaves
 *              `API_DOCS_ENABLED` unset, and requires every API reference route to
 *              answer 404. The unit suite of `registerApiReference` proves the gate on
 *              a bare Fastify instance; this file proves `createApp()` hands it the
 *              environment's value, so a deployment that sets nothing serves no
 *              reference and no OpenAPI document.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { createApp } from "../../src/index.js";
import { env } from "../../src/config/env.js";

const REFERENCE_URLS = [
  "/docs",
  "/docs/",
  "/docs/json",
  "/docs/openapi.json",
  "/docs/openapi.yaml",
  "/docs/js/scalar.js",
] as const;

describe("API reference gate in createApp()", () => {
  let app: FastifyInstance | undefined;

  before(async () => {
    app = await createApp();
    await app.ready();
  });

  after(async () => {
    if (app) {
      await app.close();
    }
  });

  it("runs under an environment that leaves API_DOCS_ENABLED off", () => {
    assert.equal(env.API_DOCS_ENABLED, false);
  });

  it("serves no API reference route when API_DOCS_ENABLED is off", async () => {
    assert.ok(app, "createApp() returned an app");
    const statuses: Record<string, number> = {};
    for (const url of REFERENCE_URLS) {
      statuses[url] = (await app.inject({ method: "GET", url })).statusCode;
    }

    assert.deepEqual(statuses, Object.fromEntries(REFERENCE_URLS.map((url) => [url, 404])));
  });

  it("keeps the OpenAPI document free of reference routes", () => {
    assert.ok(app, "createApp() returned an app");
    const paths = Object.keys(app.swagger().paths ?? {});

    assert.ok(paths.length > 0, "the document lists the API's routes");
    assert.deepEqual(
      paths.filter((path) => path.startsWith("/docs")),
      []
    );
  });
});
