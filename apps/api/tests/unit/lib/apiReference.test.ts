/**
 * @file apiReference.test.ts
 * @description Pins the API reference gate: with the flag off no `/docs` route
 *              exists, with it on Scalar serves the page, its script and the OpenAPI
 *              document built by `@fastify/swagger` at `/docs/json` and
 *              `/docs/openapi.yaml`, the document never lists a reference route, and
 *              an enabled reference without `@fastify/swagger` refuses to register
 *              instead of serving nothing.
 * @layer infrastructure
 */

import fastifySwagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { API_REFERENCE_PREFIX, registerApiReference } from "../../../src/lib/apiReference.js";

const REFERENCE_URLS = [
  "/docs",
  "/docs/",
  "/docs/json",
  "/docs/openapi.json",
  "/docs/openapi.yaml",
  "/docs/js/scalar.js",
] as const;

/** Every route Scalar registers under the prefix, as Fastify reports it to `onRoute`. */
const SCALAR_ROUTES = ["/docs", "/docs/", "/docs/js/scalar.js", "/docs/json", "/docs/openapi.yaml"];

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
  await registerApiReference(app, { enabled });
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

describe("registerApiReference", () => {
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("serves no reference route when the reference is disabled", async () => {
    const app = await buildApp(false);

    const statuses: Record<string, number> = {};
    for (const url of REFERENCE_URLS) {
      statuses[url] = (await app.inject({ method: "GET", url })).statusCode;
    }

    expect(statuses).toEqual(Object.fromEntries(REFERENCE_URLS.map((url) => [url, 404])));
    expect(referenceRoutes(app)).toEqual([]);
  });

  it("registers exactly Scalar's routes under the prefix when enabled", async () => {
    const app = await buildApp(true);

    expect(referenceRoutes(app)).toEqual([...SCALAR_ROUTES].sort());
  });

  it("serves the reference page and its script when enabled", async () => {
    const app = await buildApp(true);

    const bare = await app.inject({ method: "GET", url: API_REFERENCE_PREFIX });
    expect(bare.statusCode).toBe(301);
    expect(bare.headers.location).toBe(`${API_REFERENCE_PREFIX}/`);

    const page = await app.inject({ method: "GET", url: `${API_REFERENCE_PREFIX}/` });
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.body).toContain("./json");

    const script = await app.inject({ method: "GET", url: `${API_REFERENCE_PREFIX}/js/scalar.js` });
    expect(script.statusCode).toBe(200);
  });

  it("serves the OpenAPI document at /docs/json and /docs/openapi.yaml when enabled", async () => {
    const app = await buildApp(true);

    const json = await app.inject({ method: "GET", url: `${API_REFERENCE_PREFIX}/json` });
    expect(json.statusCode).toBe(200);
    expect(json.json<{ paths: Record<string, unknown> }>().paths).toHaveProperty("/widgets");

    const yaml = await app.inject({ method: "GET", url: `${API_REFERENCE_PREFIX}/openapi.yaml` });
    expect(yaml.statusCode).toBe(200);
    expect(yaml.body).toContain("/widgets");
  });

  it("serves the JSON document at one URL only when enabled", async () => {
    const app = await buildApp(true);

    const response = await app.inject({
      method: "GET",
      url: `${API_REFERENCE_PREFIX}/openapi.json`,
    });

    expect(response.statusCode).toBe(404);
  });

  it("keeps the OpenAPI document identical whether the reference is served or not", async () => {
    const enabled = await buildApp(true);
    const disabled = await buildApp(false);

    expect(documentedPaths(enabled)).toEqual(["/widgets"]);
    expect(documentedPaths(disabled)).toEqual(["/widgets"]);
  });

  it("refuses to register an enabled reference without @fastify/swagger", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);

    await expect(registerApiReference(app, { enabled: true })).rejects.toThrow(
      /@fastify\/swagger must be registered first/
    );
  });

  it("registers nothing without @fastify/swagger when disabled", async () => {
    const app = Fastify({ logger: false });
    apps.push(app);

    await registerApiReference(app, { enabled: false });
    await app.ready();

    const response = await app.inject({ method: "GET", url: `${API_REFERENCE_PREFIX}/` });
    expect(response.statusCode).toBe(404);
  });
});
