## Política de mocking en tests — OmniPost

Regla base: **MSW para clientes HTTP. vi.mock para todo lo demás.**

| Capa que estoy testeando                   | Herramienta                            | Por qué                                                      |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------ |
| `apps/api/src/billing/stripe.gateway.ts`   | MSW                                    | Es un cliente HTTP — testeás serialización + parsing         |
| `apps/api/src/billing/paddle.gateway.ts`   | MSW                                    | Idem                                                         |
| `apps/api/src/social/*.client.ts` (los 11) | MSW                                    | Clientes HTTP de los providers                               |
| `apps/api/src/ai/*.adapter.ts` (los 4)     | MSW                                    | Clientes HTTP a OpenAI/Anthropic/Gemini/Perplexity           |
| `apps/api/src/webhooks/outbound/*`         | MSW                                    | Hace HTTP outbound a clientes                                |
| `apps/api/src/billing/billing.service.ts`  | vi.mock sobre gateways                 | Lógica de orquestación; gateways ya tienen sus tests con MSW |
| `apps/api/src/billing/dunning.service.ts`  | vi.mock sobre Resend client + gateways | Lógica de negocio                                            |
| `apps/api/src/compliance/*.service.ts`     | vi.mock sobre Prisma                   | Lógica de cálculo (score) — sin HTTP                         |
| `apps/api/src/webhooks/dlq/*`              | vi.mock sobre webhook-sender           | Lógica de retry — el HTTP real ya se testea en sender        |
| Cualquier servicio en `apps/admin/*`       | vi.mock                                | Admin no hace HTTP a externos, solo a tu API                 |
| Cualquier hook React en `apps/client/*`    | vi.mock sobre el api client            | Idem                                                         |

### Reglas estrictas

1. **NUNCA mockear `axios` o `node-fetch` con vi.mock**. Si el SUT usa axios para llamar a Stripe, usá MSW; nunca `vi.mock('axios')`. Te ata al detalle de implementación y bloquea refactors.

2. **MSW se activa por archivo, NO globalmente**. Cada test que necesita MSW llama `setupMswServer()` en su propio archivo. Razón: choca con `vi.mock` cuando ambos manipulan `fetch` global (incidente confirmado en admin).

3. **Si el SUT llama a múltiples capas (HTTP + DB + queue), mockear las dependencias internas con vi.mock y dejar HTTP real interceptado por MSW**. Combinación válida en el mismo test.

4. **`onUnhandledRequest: 'error'` siempre**. Cualquier request HTTP sin handler MSW configurado debe fallar el test. Sin esto se pueden colar llamadas a APIs reales.

5. **Si dudás, MSW**. Es más explícito y resistente a refactors. La frase "vi.mock es más simple" no justifica usarlo cuando el SUT hace HTTP.
