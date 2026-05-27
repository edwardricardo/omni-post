# Provider Testing — Canon (§3.2 Normalization Roadmap)

> Workstream: §3.2 Normalization Roadmap (Phase A1 closed; Phases B/C/D PENDING).

## 3 niveles de testing por provider

Cada provider en `packages/providers/<name>/` tiene tres capas de testing complementarias:

| Capa                 | Qué prueba                                                     | Tooling                                | Cuándo corre               | Status hoy          |
| -------------------- | -------------------------------------------------------------- | -------------------------------------- | -------------------------- | ------------------- |
| **Unit (`vi.fn()`)** | Lógica del adapter aislada: render, params, error handling     | `vi.fn()` + factory injection          | Cada PR (CI default)       | ✅ 11 providers     |
| **Contract (MSW)**   | Stack completo adapter+apiClient contra contract fixtures HTTP | `msw` (Mock Service Worker, node)      | Cada PR (CI default)       | ✅ telegram (proof) |
| **Sandbox (real)**   | Real provider sandbox APIs — atrapa upstream API drift         | `vitest` + `describe.skipIf(no-creds)` | Nightly con GitHub Secrets | 🚧 §3.2.c PENDING   |

Los 3 niveles son **complementarios, no excluyentes** — un PR feature debería al menos pasar Unit y Contract; Sandbox corre en nightly para detectar regressions upstream que no se ven en mocks.

---

## Recipe: migrar un test `vi.fn()` → MSW

**Antes** (`vi.fn()` pattern — el existente en todos los providers):

```typescript
import { TelegramAdapter } from "../src/TelegramAdapter.js";

function createMockApiClient() {
  return {
    sendMessage: vi.fn(async () => ({ message_id: 42, ... })),
    // ... otros métodos mockeados
  };
}

function makeAdapter(client = createMockApiClient()) {
  const factory = () => client as never;
  return { adapter: new TelegramAdapter({ apiClientFactory: factory }), client };
}

it("publishes a text message", async () => {
  const { adapter, client } = makeAdapter();
  const result = await adapter.publish(input, creds);
  expect(result.ok).toBe(true);
  expect(client.sendMessage).toHaveBeenCalledWith(...);
});
```

**Después** (MSW pattern — proof en `tests/TelegramAdapter.publish.msw.test.ts`):

```typescript
import {
  createProviderMockServer,
  http,
  HttpResponse,
} from "@providers/shared/test-utils/msw-helpers.js";
import { TelegramAdapter } from "../src/TelegramAdapter.js";

const server = createProviderMockServer([
  http.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, () => {
    return HttpResponse.json({
      ok: true,
      result: { message_id: 42, chat: {...}, date: 0, text: "..." },
    });
  }),
]);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it("publishes a text message", async () => {
  const adapter = new TelegramAdapter(); // sin factory injection — usa real HTTP
  const result = await adapter.publish(input, creds);
  expect(result.ok).toBe(true);
});
```

**Diferencias clave:**

- MSW intercepta el `fetch()` REAL del apiClient — el test ejerce el stack completo (URL construction, header building, response parsing).
- No hay `client.sendMessage.mock.calls` — la verificación es via la response handlers + `onUnhandledRequest: "error"` (cualquier request inesperado falla el test).
- Más resiliente a refactors INTERNOS del apiClient — solo el contrato HTTP importa.
- Más brittle a cambios UPSTREAM — exactamente lo que queremos para detectar drift.

**Cuándo NO migrar:**

- Si el test ya verifica lógica interna del adapter que no involucra HTTP (e.g., render rules, validation), el `vi.fn()` pattern sigue siendo correcto.
- Migración progresiva: empezar por los flows de `publish` / `validateCredentials` / `fetchAnalytics` que SÍ hacen HTTP real.

---

## Recipe: sandbox integration tests

**Patrón "skip when no creds"** — el test se ejecuta SOLO cuando GitHub Secrets están configurados. Local dev y CI sin creds simplemente skippean.

Template canon vive en `packages/providers/_template/tests/integration/sandbox.template.test.ts`. Copy-paste por provider:

```typescript
const SKIP = !process.env.TELEGRAM_TEST_BOT_TOKEN || !process.env.TELEGRAM_TEST_CHAT_ID;

describe.skipIf(SKIP)("TelegramAdapter — sandbox integration", () => {
  it("publishes against the real sandbox", async () => {
    const adapter = new TelegramAdapter();
    const creds = {
      botToken: process.env.TELEGRAM_TEST_BOT_TOKEN!,
      chatId: process.env.TELEGRAM_TEST_CHAT_ID!,
    };
    const result = await adapter.publish(input, creds);
    expect(result.ok).toBe(true);
  });
});
```

**Cuándo se desbloquea cada paso:**

1. **Provisioning** (Edward): crear sandbox app/bot en el portal del provider:
   - **Telegram**: `@BotFather` → `/newbot` → guardar token.
   - **Meta (FB+IG)**: developers.facebook.com → Create App → Test mode.
   - **X**: developer.x.com → App con Sandbox v2 endpoints.
   - **LinkedIn**: developers.linkedin.com → Sandbox enabled app.
   - **TikTok**: business-api.tiktok.com → Sandbox env.
   - **YouTube**: console.cloud.google.com → OAuth test users.
   - **Pinterest**: developers.pinterest.com → Sandbox app.
   - **Snapchat**: kit.snapchat.com → Test ad account.
   - **Bluesky**: bsky.social → Test account (no portal).
   - **Threads**: heredado de Meta — incierto, requiere validación.

2. **Secrets** (Edward): agregar `<PROVIDER>_TEST_*` env vars a GitHub Actions Secrets via Repo Settings → Secrets and variables → Actions.

3. **Test impl** (dev): copiar el template a `packages/providers/<provider>/tests/integration/sandbox.test.ts`, reemplazar placeholders con calls reales.

4. **CI wireup** (§3.2.d): nuevo workflow `provider-sandbox.yml` que corre nightly + manual trigger.

---

## Status Phase A1 (DONE) vs Phases B/C/D (PENDING)

### ✅ Phase A1 — railroad + proof

- `msw@2.14.3` instalado pinned en root devDeps.
- `packages/providers/shared/src/test-utils/msw-helpers.ts` — wrapper canónico para `setupServer` + `http`/`HttpResponse`. Exportado vía `@providers/shared/test-utils/msw-helpers`.
- `packages/providers/shared/package.json` — agregado export subpath + `peerDependenciesMeta.msw.optional = true` (para que packages que no usan MSW no compitan).
- `packages/providers/telegram/vitest.config.ts` — alias específico `@providers/shared/test-utils` antes del bare alias para resolver subpath.
- `packages/providers/telegram/tests/TelegramAdapter.publish.msw.test.ts` — proof-of-concept (2 tests verde) ejerciendo TelegramAdapter contra MSW handlers.
- `packages/providers/_template/tests/integration/sandbox.template.test.ts` — template "skip when no creds" listo para copy-paste.
- Doc canon (este archivo).

### ⏭ Phase B / §3.2.b — migración MSW progresiva

Para cada uno de los 10 providers restantes:

1. Agregar el alias `@providers/shared/test-utils` a su `vitest.config.ts`.
2. Migrar al menos 1 test (preferir `publish.test.ts` o similar) al pattern MSW.
3. Coexistir con los tests `vi.fn()` existentes — migración incremental por flow.

Estimado: ~2h por provider × 10 = 20h trabajo progresivo.

### ⏭ Phase C / §3.2.c — sandbox apps + secrets

1. Edward provisiona sandbox app por provider.
2. Edward agrega secrets a GitHub Actions.
3. Dev copia template + implementa real assertions.

Bloqueado por: acción de Edward fuera del repo. Edward decide priority order (qué provider primero).

### ⏭ Phase D / §3.2.d — CI nightly workflow

Crear `.github/workflows/provider-sandbox.yml` que:

- Corre con cron schedule (nightly).
- Inyecta GitHub Secrets como env vars.
- Ejecuta `pnpm --filter "@providers/*" test:sandbox`.
- Abre GitHub issue automáticamente si algún provider falla (atrapa upstream drift).

Bloqueado por: `omnipost-allow sensitive-edit` token (mismo issue que §2.2.a-CI, §3.1.b CI gate). 30-50 LOC follow-up.

---

## Caveats conocidos

- **MSW + Node fetch**: MSW 2.x intercepta `fetch()` nativo de Node 18+. Funciona out-of-the-box con el patrón actual de provider adapters (todos usan `fetch()` nativo excepto X que usa `twitter-api-v2` — para X, MSW debería interceptar el HTTP underlying del library, pero la complejidad es mayor; defer X a §3.2.b experimentation).
- **`onUnhandledRequest: 'error'`**: hace que el test FAILE si el adapter hace una request HTTP que no declaramos handler. Esencial para contract tests; sin esto los tests pasarían silently aunque el upstream contract cambie.
- **Fallback strategies del circuit breaker**: algunos adapters (e.g., Telegram con `SOCIAL_POST_FALLBACK`) swallow errors HTTP y retornan success-ish. Cuando se migran a MSW + test 4xx/5xx scenarios, esto se manifestará. Decidir caso por caso si el fallback es correcto o si necesita test override (e.g., `circuitBreaker.disable()` en el setup del test).
- **`msw` peerDep en `@providers/shared`**: marked optional para no forzar consumers que no usan tests MSW a instalar `msw`. Tests MSW reciben msw del root devDeps via pnpm workspace hoist.
