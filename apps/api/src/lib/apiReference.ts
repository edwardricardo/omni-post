/**
 * @file apiReference.ts
 * @description Registers the API reference only where a deployment opts in. Scalar,
 *              the one plugin this module registers, renders the page under `/docs/`
 *              and serves the OpenAPI document that `@fastify/swagger` builds: as JSON
 *              at `/docs/json`, the path configured below, and as YAML at
 *              `/docs/openapi.yaml`, Scalar's default. `@fastify/swagger` serves no
 *              route of its own. Scalar hides every one of those routes from the
 *              document, so the document, and the API types generated from it, are
 *              the same whether the reference is served or not.
 * @layer infrastructure
 */

import type { FastifyInstance } from "fastify";

/** Path prefix of every API reference route. */
export const API_REFERENCE_PREFIX = "/docs";

/**
 * Path, under the prefix, of the JSON document. Scalar's default is `/openapi.json`;
 * `/json` keeps the document at `/docs/json`, the URL it has always had.
 */
const DOCUMENT_JSON_PATH = "/json";

/** Whether a deployment serves the API reference. */
export interface ApiReferenceOptions {
  /** Registers the reference routes when true, and nothing when false. */
  readonly enabled: boolean;
}

/**
 * @description Registers Scalar's API reference over the document `@fastify/swagger`
 *              builds, or nothing when the reference is disabled. The document maps
 *              every route, parameter and schema of the API, so it is served only
 *              where `API_DOCS_ENABLED` is set.
 * @param app - The Fastify instance, with `@fastify/swagger` already registered
 * @param options - Whether the deployment serves the reference
 * @returns Resolves once the routes are registered, or at once when disabled
 * @throws Error when enabled without `@fastify/swagger`, where Scalar would only log a
 *         warning and serve no reference
 */
export async function registerApiReference(
  app: FastifyInstance,
  options: ApiReferenceOptions
): Promise<void> {
  if (!options.enabled) return;
  if (!app.hasPlugin("@fastify/swagger")) {
    throw new Error(
      "registerApiReference: @fastify/swagger must be registered first; the API reference renders its document"
    );
  }
  const scalar = await import("@scalar/fastify-api-reference");
  await app.register(scalar.default, {
    routePrefix: API_REFERENCE_PREFIX,
    openApiDocumentEndpoints: { json: DOCUMENT_JSON_PATH },
    configuration: { theme: "kepler" },
  });
}
