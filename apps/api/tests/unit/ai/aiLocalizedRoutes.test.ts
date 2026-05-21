/**
 * @file aiLocalizedRoutes.test.ts
 * @description Unit tests for the locale-native AI route plugin via
 *              Fastify `inject()`. Covers happy paths for each route
 *              (generate, glossary upsert/list/delete, style-guide
 *              upsert/list/delete), 401 when the auth middleware
 *              omits `customerUser`, 422 on validation failures, 404
 *              when a delete targets an unknown id, and 500 mapping
 *              of UseCaseError. The auth middleware is mocked at module
 *              load so we never reach JWT verification.
 * @layer infrastructure
 */
import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";

const FAKE_AUTHED_ACCOUNT = "acc-authed";

vi.mock("../../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async (request: {
    headers: Record<string, string | undefined>;
    customerUser?: { accountId: string };
  }) => {
    if (request.headers["x-test-skip-auth"] === "true") return;
    request.customerUser = { accountId: FAKE_AUTHED_ACCOUNT };
  },
}));

import Fastify, { type FastifyInstance } from "fastify";
import { ok, err } from "@shared/types";
import { Container } from "../../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";
import { UseCaseError, USE_CASE_ERRORS } from "../../../src/application/UseCase.js";

interface UseCaseStubs {
  generate: ReturnType<typeof vi.fn>;
  upsertGlossary: ReturnType<typeof vi.fn>;
  deleteGlossary: ReturnType<typeof vi.fn>;
  listGlossary: ReturnType<typeof vi.fn>;
  upsertStyleRule: ReturnType<typeof vi.fn>;
  deleteStyleRule: ReturnType<typeof vi.fn>;
  listStyleRules: ReturnType<typeof vi.fn>;
}

function makeStubs(): UseCaseStubs {
  return {
    generate: vi.fn(),
    upsertGlossary: vi.fn(),
    deleteGlossary: vi.fn(),
    listGlossary: vi.fn(),
    upsertStyleRule: vi.fn(),
    deleteStyleRule: vi.fn(),
    listStyleRules: vi.fn(),
  };
}

async function buildApp(stubs: UseCaseStubs): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const container = new Container();
  container.registerInstance(TOKENS.GenerateLocalizedContentUseCase, {
    execute: stubs.generate,
  } as never);
  container.registerInstance(TOKENS.UpsertGlossaryTermUseCase, {
    execute: stubs.upsertGlossary,
  } as never);
  container.registerInstance(TOKENS.DeleteGlossaryTermUseCase, {
    execute: stubs.deleteGlossary,
  } as never);
  container.registerInstance(TOKENS.ListGlossaryByLocaleQuery, {
    execute: stubs.listGlossary,
  } as never);
  container.registerInstance(TOKENS.UpsertStyleGuideRuleUseCase, {
    execute: stubs.upsertStyleRule,
  } as never);
  container.registerInstance(TOKENS.DeleteStyleGuideRuleUseCase, {
    execute: stubs.deleteStyleRule,
  } as never);
  container.registerInstance(TOKENS.ListStyleGuideRulesByLocaleQuery, {
    execute: stubs.listStyleRules,
  } as never);
  app.decorate("container", container);
  const { aiLocalizedRoutes } = await import("../../../src/ai/aiLocalizedRoutes.js");
  await app.register(aiLocalizedRoutes);
  return app;
}

describe("aiLocalizedRoutes — POST /ai/generate-localized", () => {
  let app: FastifyInstance;
  let stubs: UseCaseStubs;

  beforeEach(() => {
    vi.clearAllMocks();
    stubs = makeStubs();
  });
  afterEach(async () => {
    if (app) await app.close();
  });

  it("returns 200 with the use-case output on success", async () => {
    stubs.generate.mockResolvedValue(
      ok({ content: "Contenido", rationale: null, usedTerms: ["g-1"], usedRules: [] })
    );
    app = await buildApp(stubs);

    const response = await app.inject({
      method: "POST",
      url: "/ai/generate-localized",
      payload: { locale: "es", brief: "Anuncio de lanzamiento" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data: { content: string } };
    expect(body.ok).toBe(true);
    expect(body.data.content).toBe("Contenido");
    expect(stubs.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: FAKE_AUTHED_ACCOUNT,
        locale: "es",
        brief: "Anuncio de lanzamiento",
      })
    );
  });

  it("returns 401 when the auth middleware does not populate customerUser", async () => {
    app = await buildApp(stubs);
    const response = await app.inject({
      method: "POST",
      url: "/ai/generate-localized",
      payload: { locale: "es", brief: "Anuncio de lanzamiento" },
      headers: { "x-test-skip-auth": "true" },
    });
    expect(response.statusCode).toBe(401);
    expect(stubs.generate).not.toHaveBeenCalled();
  });

  it("returns 422 when the locale is unsupported", async () => {
    app = await buildApp(stubs);
    const response = await app.inject({
      method: "POST",
      url: "/ai/generate-localized",
      payload: { locale: "pt", brief: "Lançamento de novidade" },
    });
    expect(response.statusCode).toBe(422);
    expect(stubs.generate).not.toHaveBeenCalled();
  });

  it("returns 422 when the brief is too short", async () => {
    app = await buildApp(stubs);
    const response = await app.inject({
      method: "POST",
      url: "/ai/generate-localized",
      payload: { locale: "es", brief: "corto" },
    });
    expect(response.statusCode).toBe(422);
  });

  it("returns 500 mapping a UseCaseError from the orchestrator", async () => {
    stubs.generate.mockResolvedValue(
      err(new UseCaseError("AI unavailable", USE_CASE_ERRORS.INTERNAL_ERROR))
    );
    app = await buildApp(stubs);

    const response = await app.inject({
      method: "POST",
      url: "/ai/generate-localized",
      payload: { locale: "es", brief: "Anuncio de lanzamiento" },
    });
    expect(response.statusCode).toBe(500);
  });
});

describe("aiLocalizedRoutes — glossary CRUD", () => {
  let app: FastifyInstance;
  let stubs: UseCaseStubs;

  beforeEach(() => {
    vi.clearAllMocks();
    stubs = makeStubs();
  });
  afterEach(async () => {
    if (app) await app.close();
  });

  it("POST /ai/glossary returns 201 on successful upsert", async () => {
    stubs.upsertGlossary.mockResolvedValue(
      ok({ id: "g-1", term: "Marca", definition: "Identidad" })
    );
    app = await buildApp(stubs);

    const response = await app.inject({
      method: "POST",
      url: "/ai/glossary",
      payload: { locale: "es", term: "Marca", definition: "Identidad" },
    });

    expect(response.statusCode).toBe(201);
    expect(stubs.upsertGlossary).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: FAKE_AUTHED_ACCOUNT,
        locale: "es",
        term: "Marca",
      })
    );
  });

  it("DELETE /ai/glossary/:id returns 404 when use case yields NOT_FOUND", async () => {
    stubs.deleteGlossary.mockResolvedValue(
      err(new UseCaseError("Glossary entry not found", USE_CASE_ERRORS.NOT_FOUND))
    );
    app = await buildApp(stubs);

    const response = await app.inject({
      method: "DELETE",
      url: "/ai/glossary/123e4567-e89b-12d3-a456-426614174000",
    });
    expect(response.statusCode).toBe(404);
  });

  it("DELETE /ai/glossary/:id returns 422 for an invalid uuid", async () => {
    app = await buildApp(stubs);
    const response = await app.inject({
      method: "DELETE",
      url: "/ai/glossary/not-a-uuid",
    });
    expect(response.statusCode).toBe(422);
    expect(stubs.deleteGlossary).not.toHaveBeenCalled();
  });

  it("GET /ai/glossary returns 200 with the listed entries", async () => {
    stubs.listGlossary.mockResolvedValue(ok({ entries: [{ id: "g-1" }, { id: "g-2" }] }));
    app = await buildApp(stubs);

    const response = await app.inject({ method: "GET", url: "/ai/glossary?locale=es" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as {
      ok: boolean;
      data: { entries: Array<{ id: string }> };
    };
    expect(body.data.entries).toHaveLength(2);
  });

  it("GET /ai/glossary returns 422 when locale is missing", async () => {
    app = await buildApp(stubs);
    const response = await app.inject({ method: "GET", url: "/ai/glossary" });
    expect(response.statusCode).toBe(422);
  });
});

describe("aiLocalizedRoutes — style-guide CRUD", () => {
  let app: FastifyInstance;
  let stubs: UseCaseStubs;

  beforeEach(() => {
    vi.clearAllMocks();
    stubs = makeStubs();
  });
  afterEach(async () => {
    if (app) await app.close();
  });

  it("POST /ai/style-guide returns 201 on successful upsert", async () => {
    stubs.upsertStyleRule.mockResolvedValue(ok({ id: "s-1", rule: "Prefer active voice" }));
    app = await buildApp(stubs);

    const response = await app.inject({
      method: "POST",
      url: "/ai/style-guide",
      payload: { locale: "en", rule: "Prefer active voice", category: "grammar" },
    });

    expect(response.statusCode).toBe(201);
    expect(stubs.upsertStyleRule).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: FAKE_AUTHED_ACCOUNT,
        locale: "en",
        rule: "Prefer active voice",
        category: "grammar",
      })
    );
  });

  it("DELETE /ai/style-guide/:id returns 404 when use case yields NOT_FOUND", async () => {
    stubs.deleteStyleRule.mockResolvedValue(
      err(new UseCaseError("Style guide rule not found", USE_CASE_ERRORS.NOT_FOUND))
    );
    app = await buildApp(stubs);
    const response = await app.inject({
      method: "DELETE",
      url: "/ai/style-guide/123e4567-e89b-12d3-a456-426614174000",
    });
    expect(response.statusCode).toBe(404);
  });

  it("GET /ai/style-guide returns 200 with the listed rules", async () => {
    stubs.listStyleRules.mockResolvedValue(ok({ rules: [{ id: "s-1" }] }));
    app = await buildApp(stubs);

    const response = await app.inject({ method: "GET", url: "/ai/style-guide?locale=en" });
    expect(response.statusCode).toBe(200);
  });
});
