/**
 * @file apiReference.test.ts
 * @description Pins the API reference gate: with the flag off no `/docs` route
 *              exists; with it on the API serves the OpenAPI document built by
 *              `@fastify/swagger` at `/docs/json` and `/docs/openapi.yaml` and nothing
 *              else under the prefix, the document never lists those routes, and an
 *              enabled reference without `@fastify/swagger` refuses to register
 *              instead of serving nothing.
 * @layer infrastructure
 */

import fastifySwagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { API_REFERENCE_PREFIX, registerApiReference } from "../../../src/lib/apiReference.js";

const PROBED_URLS = [
  "/docs",
  "/docs/",
  "/docs/json",
  "/docs/openapi.json",
  "/docs/openapi.yaml",
  "/docs/js/scalar.js",
] as const;

/** The two routes the enabled reference registers, as Fastify reports them to `onRoute`. */
const DOCUMENT_ROUTES = ["/docs/json", "/docs/openapi.yaml"];

const apps: FastifyInstance[] = [];
const registeredUrls = new WeakMap<FastifyInstance, string[]>();

/**
 * @description Builds a Fastify app with `@fastify/swagger`, one documented route and
 *              the API reference registered with the given flag.
 * @param enabled - The value `API_DOCS_ENABLED` would carry
 * @returns The ready app
 */
async function buildApp(enabled: boolean): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  apps.push(app);
  const urls: string[] = [];
  registeredUrls.set(app, urls);
  app.addHook("onRoute", (route) => {
    urls.push(route.url);
  });
  await app.register(fastifySwagger, {
    openapi: { info: { title: "Reference test API", version: "1.0.0" } },
  });
  registerApiReference(app, { enabled });
  app.get(
    "/widgets",
    { schema: { response: { 200: { type: "object", properties: { id: { type: "string" } } } } } },
    async () => ({ id: "widget-1" })
  );
  await app.ready();
  return app;
}

/**
 * @description Lists the paths the app's OpenAPI document declares.
 * @param app - A ready app with `@fastify/swagger`
 * @returns The document's path keys, sorted
 */
function documentedPaths(app: FastifyInstance): string[] {
  return Object.keys(app.swagger().paths ?? {}).sort();
}

/**
 * @description Lists the distinct URLs registered under the reference prefix.
 * @param app - An app built by `buildApp`
 * @returns The registered URLs that start with the prefix, sorted
 */
function referenceRoutes(app: FastifyInstance): string[] {
  const urls = registeredUrls.get(app) ?? [];
  return [...new Set(urls.filter((url) => url.startsWith(API_REFERENCE_PREFIX)))].sort();
}

/**
 * @description Requests every probed URL and records its status code.
 * @param app - A ready app
 * @returns The status code of each probed URL
 */
async function probeStatuses(app: FastifyInstance): Promise<Record<string, number>> {
  const statuses: Record<string, number> = {};
  for (const url of PROBED_URLS) {
    statuses[url] = (await app.inject({ method: "GET", url })).statusCode;
  }
  return statuses;
}

describe("registerApiReference", () => {
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("serves no reference route when the reference is disabled", async () => {
    const app = await buildApp(false);

    expect(await probeStatuses(app)).toEqual(
      Object.fromEntries(PROBED_URLS.map((url) => [url, 404]))
    );
    expect(referenceRoutes(app)).toEqual([]);
  });

  it("serves the document at /docs/json and /docs/openapi.yaml and nothing else when enabled", async () => {
    const app = await buildApp(true);

    expect(await probeStatuses(app)).toEqual({
      "/docs": 404,
      "/docs/": 404,
      "/docs/json": 200,
      "/docs/openapi.json": 404,
      "/docs/openapi.yaml": 200,
      "/docs/js/scalar.js": 404,
    });
    expect(referenceRoutes(app)).toEqual(DOCUMENT_ROUTES);
  });

  it("serves the JSON document with its paths when enabled", async () => {
    const app = await buildApp(true);

    const json = await app.inject({ method: "GET", url: `${API_REFERENCE_PREFIX}/json` });

    expect(json.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(json.json<{ paths: Record<string, unknown> }>().paths).toHaveProperty("/widgets");
  });

  it("serves the YAML document with its paths when enabled", async () => {
    const app = await buildApp(true);

    const yaml = await app.inject({ method: "GET", url: `${API_REFERENCE_PREFIX}/openapi.yaml` });

    expect(yaml.headers["content-type"]).toBe("application/yaml; charset=utf-8");
    expect(yaml.body).toContain("/widgets:");
  });

  it("keeps the OpenAPI document identical whether the reference is served or not", async () => {
    const enabled = await buildApp(true);
    const disabled = await buildApp(false);

    expect(documentedPaths(enabled)).toEqual(["/widgets"]);
    expect(documentedPaths(disabled)).toEqual(["/widgets"]);
  });

  it("refuses to register an enabled reference without @fastify/swagger", () => {
    const app = Fastify({ logger: false });
    apps.push(app);

    expect(() => registerApiReference(app, { enabled: true })).toThrow(
      /@fastify\/swagger must be registered first/
    );
  });

  it("registers nothing without @fastify/swagger when disabled", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);

    registerApiReference(app, { enabled: false });
    await app.ready();

    const response = await app.inject({ method: "GET", url: `${API_REFERENCE_PREFIX}/json` });
    expect(response.statusCode).toBe(404);
  });
});
