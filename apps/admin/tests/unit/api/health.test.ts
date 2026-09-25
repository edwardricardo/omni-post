/**
 * @file health.test.ts
 * @description Pins the admin container's liveness contract. This route was
 *              ABSENT while both portal Dockerfiles' HEALTHCHECK requested it,
 *              so every admin container reported `unhealthy` for its whole life.
 *              The HEALTHCHECK is the route's only consumer and it is never
 *              exercised in CI, so without this test any App Router change that
 *              renames the path, drops the export, or turns the handler static
 *              reproduces that exact defect with no failing signal until deploy.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";

import { GET, dynamic } from "../../../app/api/health/route";

describe("GET /api/health (admin liveness)", () => {
  it("returns 200, which is the only status the Dockerfile HEALTHCHECK accepts", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "omnipost-admin",
    });
  });

  it("is never prerendered, so a stopped process cannot answer from disk", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("returns its response directly, so an awaited backend call cannot be added silently", () => {
    // WHAT THIS PROVES, stated narrowly so the title cannot be read as more. A
    // liveness probe that calls the backend converts that backend's outage into
    // a restart loop of portals that are serving correctly. An awaited HTTP call
    // cannot be added to a handler that returns its response directly — it
    // forces `async`, and `async` returns a Promise, which this rejects.
    //
    // WHAT IT DOES NOT PROVE: the absence of I/O. A synchronous fs read, a
    // native binding, or a fire-and-forget promise would all pass. Those are
    // not the shape that made this route worth writing, and no cheap assertion
    // catches them; the one that would is a boot of the container, which is
    // where CI's smoke step covers it instead.
    expect(GET()).not.toBeInstanceOf(Promise);
  });
});
