# ADR-0001: Agent Orchestration Engine and Schema-Validated Provider Substrate

- **Status**: Accepted
- **Date**: 2026-05-19
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

A significant part of the product surface is **agentic**: content repurposing,
inbox triage, and trend radar are not linear pipelines. They are
plan → act → reflect loops with conditional branching, self-critique, bounded
retries, and **irreversible downstream effects** (a repurposed post is
published). Several of these flows additionally require a **human-in-the-loop
approval** before the irreversible step, and worker jobs must be
**resumable and fault-tolerant** across process restarts.

The codebase already isolates AI behind a hexagonal boundary:
`AIServicePort` (domain repository port) and `AIGeneratePort` (application),
resolved through DI. Application and domain never import a provider SDK. The
existing `ai/orchestrator.ts` is a **provider transport** concern
(routing / fallback / cache / rate-limit / usage) — it is explicitly _not_ an
agent graph and contains no plan/act/reflect logic.

Two gaps blocked building reliable agentic flows:

1. **No graph-execution substrate.** Branching, reflection, loop guards,
   durable checkpointing, and interrupt/resume for human approval had no home.
2. **No schema-validated model I/O.** Provider adapters generated free-form
   text and `JSON.parse`-d it with no schema enforcement. A malformed model
   response silently corrupted downstream callers instead of failing fast.

## Decision

**Adopt LangGraph.js as the graph-execution engine** (hybrid pattern: the
library is the execution backbone; node bodies hold our custom logic),
**wrapped behind a technology-free hexagonal port** (`AgentOrchestrationPort`
in `packages/ports`). Domain and application depend only on the port; the
LangGraph adapter lives in infrastructure (`apps/api/src/ai/agent/`).

**Redesign the provider substrate for schema-validated structured output.**
Every provider implements `generateStructured<T>(messages, spec)` using its
native structured-output mechanism, and the result is always routed through a
zod `parse` that is the authoritative validation gate:

| Provider   | Native mechanism                                          |
| ---------- | --------------------------------------------------------- |
| OpenAI     | `response_format: { type: "json_schema", strict: true }`  |
| Anthropic  | Forced single-tool use (`tool_choice: { type: "tool" }`)  |
| Gemini     | `responseMimeType: "application/json"` + `responseSchema` |
| Perplexity | `response_format: { type: "json_schema" }`                |

zod schemas are the single source of truth (`structuredSchemas.ts`); the
JSON Schema sent on the wire is derived from them via `z.toJSONSchema()`, and
`spec.parse` validates the response so a drifting model fails validation
rather than corrupting a caller.

## Rationale

1. **The flows are non-linear.** Branching + reflection + bounded retries +
   irreversible effects + human approval is exactly the shape a proven graph
   engine is built for. A bespoke primitive would mean reimplementing,
   hardening, and maintaining durable checkpointing, interrupt/resume,
   recursion/timeout guards, conditional routing, streaming, and a
   trajectory-evaluation surface — permanent surface area and risk.
2. **Coupling is contained.** LangGraph is referenced only inside the infra
   adapter behind a port that already exists in spirit. Application and domain
   stay framework-free; the engine is swappable without touching them.
3. **The I/O gap is closed now, not deferred.** Schema-validated structured
   output is part of a robust substrate, not a later optimization. Fragile
   text parsing is removed at the source.
4. **Determinism for tests.** With a deterministic `AIServicePort` fake the
   graph is fully reproducible, enabling trajectory assertions (node order,
   step count, tool/structured-call validity, cost ceiling) in CI.

## Alternatives Considered

- **Custom in-house orchestration primitive.** Rejected: it pushes the
  reimplement-and-maintain cost of checkpointing, HITL, and guards onto us
  permanently. The port preserves this as an escape hatch (see _Revisit if_)
  without paying the cost up front.
- **Higher-level LangChain agents.** Rejected: less control over explicit
  graph state, branching, and the interrupt point needed for approval.
- **Defer structured outputs; keep text + `JSON.parse`.** Rejected: a
  malformed response corrupts callers silently — the opposite of robust.

## Consequences

**Positive**

- A maintained, hardened engine provides durable checkpointing (resumable
  worker jobs), interrupt/resume (human approval before publish),
  recursion/timeout guards, and conditional routing.
- The hexagonal port guarantees an architectural exit: the engine can be
  replaced without changing application/domain.
- Provider responses are schema-validated; malformed model output fails
  validation instead of silently propagating.

**Negative / costs**

- New dependencies (`@langchain/langgraph`, `@langchain/core`), pinned to
  exact stable versions.
- LangGraph's engine state model must be bridged to `Result` at the adapter
  boundary (no throwing across the port).

## Revisit if

If LangGraph's engine-state model fights the `Result` contract or TypeScript
strict mode at the adapter edge in a way that is net-negative, the same port
allows substituting a custom engine **without touching application or
domain**. The probed, hardened base was chosen first for robustness; the port
guarantees the exit.

## Risks and Mitigations

| Risk                                  | Mitigation                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Dependency churn / supply chain       | Exact version pins; no caret/tilde ranges.                                  |
| Engine lock-in                        | Engine confined to one infra adapter behind `AgentOrchestrationPort`.       |
| Non-deterministic agent tests         | Deterministic `AIServicePort` fake + trajectory-eval gate in CI.            |
| Structured-output model drift         | zod `spec.parse` is the authoritative gate; HTTP-faithful wire tests (MSW). |
| Irreversible publish without approval | Graph `interrupt()` gate before any downstream publish.                     |

## References

- LangGraph.js production guidance — https://langgraphjs.guide/production/
- Framework vs. custom agentic engine — https://www.turgon.ai/post/langchain-langgraph-or-custom-choosing-the-right-agentic-framework
- LangGraph vs LangChain (2026) — https://www.spheron.network/blog/langgraph-vs-langchain/
- Agent evaluation frameworks (2026) — https://futureagi.com/blog/agent-evaluation-frameworks-2026
- Survey of agent trajectory evaluation — https://arxiv.org/html/2503.16416v1
- Cockburn, Hexagonal Architecture — https://alistair.cockburn.us/hexagonal-architecture
