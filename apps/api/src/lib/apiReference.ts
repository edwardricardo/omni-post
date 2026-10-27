/**
 * @file apiReference.ts
 * @description Serves the OpenAPI document that `@fastify/swagger` builds, only where a
 *              deployment opts in: as JSON at `/docs/json` and as YAML at
 *              `/docs/openapi.yaml`. Both routes are hidden from the document, so the
 *              document, and the API types generated from it, are the same whether it
 *              is served or not. No interactive reference page is served: the API's
 *              CSP (`script-src 'self'`) blocks the inline script such a page boots
 *              with, so a viewer reads the document from these routes instead.
 * @layer infrastructure
 */

import type { FastifyInstance } from "fastify";

/** Path prefix of every API reference route. */
export const API_REFERENCE_PREFIX = "/docs";

/** URL of the JSON document, the URL it has always had. */
const DOCUMENT_JSON_URL = `${API_REFERENCE_PREFIX}/json`;

/** URL of the YAML document. */
const DOCUMENT_YAML_URL = `${API_REFERENCE_PREFIX}/openapi.yaml`;

/** Whether a deployment serves the API reference. */
export interface ApiReferenceOptions {
  /** Registers the document routes when true, and nothing when false. */
  readonly enabled: boolean;
}

/**
 * @description Registers the routes that serve the OpenAPI document `@fastify/swagger`
 *              builds, or nothing when the reference is disabled. The document maps
 *              every route, parameter and schema of the API, so it is served only where
 *              `API_DOCS_ENABLED` is set.
 * @param app - The Fastify instance, with `@fastify/swagger` already registered
 * @param options - Whether the deployment serves the reference
 * @throws Error when enabled without `@fastify/swagger`, which would leave the routes
 *         with no document to serve
 */
export function registerApiReference(app: FastifyInstance, options: ApiReferenceOptions): void {
  if (!options.enabled) return;
  if (!app.hasPlugin("@fastify/swagger")) {
    throw new Error(
      "registerApiReference: @fastify/swagger must be registered first; the API reference serves its document"
    );
  }
  app.get(DOCUMENT_JSON_URL, { schema: { hide: true } }, async (_request, reply) =>
    reply.type("application/json; charset=utf-8").send(app.swagger())
  );
  app.get(DOCUMENT_YAML_URL, { schema: { hide: true } }, async (_request, reply) =>
    reply.type("application/yaml; charset=utf-8").send(app.swagger({ yaml: true }))
  );
}
