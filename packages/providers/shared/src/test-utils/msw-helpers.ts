/**
 * @file msw-helpers.ts
 * @description Shared MSW (Mock Service Worker) helpers para tests de
 *   providers. Establece el patrón canónico para mockear HTTP calls de los
 *   providers contra fixtures recorded — alternativa al patrón `vi.fn()` +
 *   factory injection que se usaba históricamente.
 *
 *   Patrón:
 *
 *   ```typescript
 *   import {
 *     createProviderMockServer,
 *     http,
 *     HttpResponse,
 *   } from "@providers/shared/test-utils/msw-helpers.js";
 *
 *   const server = createProviderMockServer([
 *     http.post("https://api.twitter.com/2/tweets", () => HttpResponse.json({...})),
 *   ]);
 *
 *   beforeAll(() => server.listen());
 *   afterEach(() => server.resetHandlers());
 *   afterAll(() => server.close());
 *   ```
 *
 *   Re-exporta `http` y `HttpResponse` para que los tests no tengan que
 *   importar directamente de `msw` — el wrapper permite refactorizar el
 *   pattern en un solo lugar si MSW v3 cambia API.
 *
 * @layer infrastructure
 */
import { setupServer, type SetupServerApi } from "msw/node";
import { http, HttpResponse, type RequestHandler } from "msw";

/**
 * Crea un MSW server con los handlers provistos. Los handlers son lazy —
 * se resuelven solo cuando un test los activa via `server.use(...)` o
 * directamente cuando llegan requests.
 *
 * @param handlers - Lista de handlers `http.get/post/...` para registrar.
 * @returns El SetupServerApi listo para `.listen()` / `.resetHandlers()` /
 *   `.close()` en hooks de vitest.
 */
export function createProviderMockServer(handlers: RequestHandler[]): SetupServerApi {
  return setupServer(...handlers);
}

export { http, HttpResponse };
export type { RequestHandler } from "msw";
