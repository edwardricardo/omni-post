/**
 * Integration Tests — Localized AI Routes
 *
 * Exercises the locale-native AI surface end-to-end against the real
 * API + Postgres. This suite runs in the canonical dev environment where
 * NO embeddings/content AI provider key is configured, so it validates
 * the DEGRADED mode:
 *   - Glossary + style-guide CRUD works without a provider; the term /
 *     rule row is persisted and `embeddingPersisted` is `false` (the
 *     embedding column stays NULL because no provider can compute it).
 *   - Per-locale listing isolates rows: `es` rows never surface under
 *     `en` and vice-versa.
 *   - Auth: missing customer JWT → 401 on every endpoint.
 *   - Validation: unsupported locale (e.g. `pt`) → 422.
 *   - `POST /ai/generate-localized` fails CLEANLY (well-formed JSON
 *     error, no crash) when no content-LLM provider is available — the
 *     embedding step degrades silently, but content generation itself
 *     genuinely cannot run with zero providers.
 *
 * The grounded-success path (200 + content + populated usedTerms /
 * usedRules) is covered deterministically by the trajectory eval
 * (`tests/eval/localizedGeneration.eval.test.ts`) with mocked providers,
 * and is validated end-to-end once a real OpenAI/Gemini key is present.
 *
 * The dev environment (`pnpm dev`) MUST be up — API on 3000. Tests fail
 * loud if the API is unreachable.
 *
 * @file aiLocalizedRoutes.test.ts
 * @description Tests for the client-facing localized AI endpoints
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable, getBaseUrl } from "../testUtils.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

const API_URL = getBaseUrl();

interface Fixture {
  accountId: string;
  authHeader: string;
}

const tokenFor = (sub: string, accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

async function json(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  authHeader?: string
) {
  const init: RequestInit = {
    method,
    headers: {
      ...(authHeader ? { Authorization: authHeader } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  const response = await fetch(`${API_URL}${path}`, init);
  const payload: unknown = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}

describe("Localized AI routes integration", () => {
  let prisma: PrismaClient;
  let fixture: Fixture;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_URL} — start the dev environment with 'pnpm dev' before running this suite`
    );

    prisma = createTestPrismaClient();
    const tag = `ai-localized-int-${Date.now()}`;

    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "Localized AI Integration Account" },
    });
    const customerUser = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email: `customer-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "Localized",
        lastName: "Tester",
      },
    });

    fixture = {
      accountId: account.id,
      authHeader: tokenFor(customerUser.id, account.id),
    };
  });

  after(async () => {
    if (!fixture) return;
    await prisma.glossary.deleteMany({ where: { accountId: fixture.accountId } });
    await prisma.styleGuideRule.deleteMany({ where: { accountId: fixture.accountId } });
    await prisma.customerUser.deleteMany({ where: { accountId: fixture.accountId } });
    await prisma.account.deleteMany({ where: { id: fixture.accountId } });
    await prisma.$disconnect();
  });

  it("rejects missing auth on every endpoint with 401", async () => {
    const endpoints: ReadonlyArray<[string, "GET" | "POST" | "DELETE", unknown?]> = [
      ["/ai/glossary?locale=es", "GET"],
      ["/ai/glossary", "POST", { locale: "es", term: "x", definition: "y" }],
      ["/ai/glossary/00000000-0000-4000-8000-000000000000", "DELETE"],
      ["/ai/style-guide?locale=es", "GET"],
      ["/ai/style-guide", "POST", { locale: "es", rule: "x" }],
      ["/ai/style-guide/00000000-0000-4000-8000-000000000000", "DELETE"],
      [
        "/ai/generate-localized",
        "POST",
        { locale: "es", brief: "Suficientemente largo para validacion." },
      ],
    ];
    for (const [path, method, body] of endpoints) {
      const { status } = await json(method, path, body);
      assert.strictEqual(status, 401, `Expected 401 for ${method} ${path}, got ${status}`);
    }
  });

  it("rejects an unsupported locale with 422", async () => {
    const { status } = await json(
      "POST",
      "/ai/glossary",
      { locale: "pt", term: "Marca", definition: "Identidad" },
      fixture.authHeader
    );
    assert.strictEqual(status, 422);
  });

  it("upserts a glossary term and persists the row (embedding degraded without a provider)", async () => {
    const { status, body } = await json(
      "POST",
      "/ai/glossary",
      {
        locale: "es",
        term: "Marca",
        definition: "Identidad comercial de la empresa",
        usage: "Nuestra marca habla de calidad y confianza.",
      },
      fixture.authHeader
    );

    assert.strictEqual(status, 201);
    const data = (
      body as { ok: boolean; data: { embeddingPersisted: boolean; entry: { id: string } } }
    ).data;
    assert.ok(data.entry.id);
    // No provider configured → embedding cannot be computed; the term is
    // still persisted (degraded), and the embedding column stays NULL.
    assert.strictEqual(data.embeddingPersisted, false);

    const stored = await prisma.$queryRawUnsafe<Array<{ has_embedding: boolean }>>(
      `SELECT embedding IS NOT NULL AS has_embedding FROM "Glossary" WHERE id = $1`,
      data.entry.id
    );
    assert.strictEqual(stored[0]?.has_embedding, false);
  });

  it("lists glossary terms per locale and isolates cross-locale rows", async () => {
    await json(
      "POST",
      "/ai/glossary",
      { locale: "en", term: "Brand", definition: "Commercial identity" },
      fixture.authHeader
    );

    const esList = await json("GET", "/ai/glossary?locale=es", undefined, fixture.authHeader);
    const enList = await json("GET", "/ai/glossary?locale=en", undefined, fixture.authHeader);

    assert.strictEqual(esList.status, 200);
    assert.strictEqual(enList.status, 200);
    const esEntries = (esList.body as { data: { entries: Array<{ term: string }> } }).data.entries;
    const enEntries = (enList.body as { data: { entries: Array<{ term: string }> } }).data.entries;

    assert.ok(esEntries.some((e) => e.term === "Marca"));
    assert.ok(!esEntries.some((e) => e.term === "Brand"));
    assert.ok(enEntries.some((e) => e.term === "Brand"));
    assert.ok(!enEntries.some((e) => e.term === "Marca"));
  });

  it("upserts and lists style-guide rules with locale isolation", async () => {
    const createEs = await json(
      "POST",
      "/ai/style-guide",
      { locale: "es", rule: "Usa la primera persona del plural", category: "tone" },
      fixture.authHeader
    );
    const createEn = await json(
      "POST",
      "/ai/style-guide",
      { locale: "en", rule: "Prefer active voice", category: "grammar" },
      fixture.authHeader
    );

    assert.strictEqual(createEs.status, 201);
    assert.strictEqual(createEn.status, 201);
    // Degraded: rule persisted, embedding not computed without a provider.
    assert.strictEqual(
      (createEs.body as { data: { embeddingPersisted: boolean } }).data.embeddingPersisted,
      false
    );

    const esList = await json("GET", "/ai/style-guide?locale=es", undefined, fixture.authHeader);
    const enList = await json("GET", "/ai/style-guide?locale=en", undefined, fixture.authHeader);

    const esRules = (esList.body as { data: { rules: Array<{ rule: string }> } }).data.rules;
    const enRules = (enList.body as { data: { rules: Array<{ rule: string }> } }).data.rules;

    assert.ok(esRules.some((r) => r.rule.includes("primera persona")));
    assert.ok(!esRules.some((r) => r.rule.includes("active voice")));
    assert.ok(enRules.some((r) => r.rule.includes("active voice")));
  });

  it("generate-localized fails cleanly when no content-LLM provider is configured", async () => {
    const { status, body } = await json(
      "POST",
      "/ai/generate-localized",
      {
        locale: "es",
        brief: "Escribe un anuncio breve para el lanzamiento de un nuevo producto premium.",
        platforms: ["instagram"],
      },
      fixture.authHeader
    );

    // With zero AI providers the embedding step degrades silently but the
    // content LLM call cannot run, so the endpoint returns a well-formed
    // error (not a crash). When a provider key is present this path
    // returns 200 with grounded content — covered by the trajectory eval.
    assert.strictEqual(status, 500);
    const payload = body as { ok: boolean; error: string };
    assert.strictEqual(payload.ok, false);
    assert.ok(typeof payload.error === "string" && payload.error.length > 0);
  });
});
