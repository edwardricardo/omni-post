---
name: feedback-canon-research
description: "Edward's canon-research discipline: research first, canon over consistency, no patches, no suppression"
metadata:
  type: feedback-canon
  owner: edward
  loaded: every-session-via-claude-local-md
---

# Canon Research & Anti-Suppression Discipline

> Personal canon: how to investigate before changing code, when to defer to canon
> over existing patterns, and the absolute prohibition on time-bomb suppressions.
> Auto-loaded via `@~/.claude/feedback/canon-research.md` in `CLAUDE.local.md`.

**Owner:** Edward
**Loaded:** every session (Claude Code `@`-import, depth 1)

---

## Rule: Research first — best practices + complete solutions, zero patches

Before modifying or fixing anything, **research current best practices** for the domain in question. Apply the most advanced, complete solution — never the minimum viable. Zero patches, zero omissions. Quality over speed.

**Why:** Edward (2026-04-22, exact): _"Si arreglar algo implica modificar más código entonces se modifica todo lo que sea necesario y de la mejor manera."_ The scope of a batch is not the number of initial files — it's "all files affected by the correct fix." OmniPost is in development with time available; the cost of parchwork now is refactor later. Apply canon actively: WebFetch docs, Read internal patterns, consult specialists.

**How to apply:**

1. **Before writing the plan**: Bloque "Investigación canon" (before ExitPlanMode):
   - 2-4 WebSearch/WebFetch to official domain sources (docs, RFCs, MDN, maintainer blogs, spec pages).
   - 1 grep + Read of repo to verify canon doesn't already exist and proposal doesn't violate local conventions.
   - Consult specialist agent when domain justifies (react-frontend-specialist, appsec, etc.).
2. **Plan cites sources** — not "I know X is better" but "MDN says Y at [URL], so X."
3. **Options A/B/C reflect found canon** — if canon is more invasive, it appears as Option A with honesty about cost; not hidden.
4. **If investigation reveals initial assumptions incomplete**: re-explore BEFORE writing plan.
5. **For any search of code patterns**: grep the ENTIRE repo by pattern signature (not just obvious directory), report real count vs roadmap count, include all hits in scope or defer with per-site reason.
6. **Anti-patterns to avoid**: "opción mínima" vs "opción completa" — defaulting to minimum (then Edward has to ask for canon); omitting research (proposing based on "knowledge"); override/exception as solution (ESLint `disable` when the issue is architectural).
7. **Refactor-from-scratch check**: before proposing refactor, ask: "Would I design it this way from zero?" If not, present the from-scratch option too.

---

## Rule: Canon over consistency — never propagate a suboptimal pattern just for uniformity

When the repo has an established pattern, but canon offers a better way, **apply the canon**. Do NOT replicate the existing suboptimal pattern for "consistency." The code diverges intentionally; the suboptimal precedent gets migrated to canon later.

**Why:** Edward: _"No me importa mantener una consistencia de algo que puede ser hecho mejor, siempre el canon primero, siempre."_ (2026-05-21). The canon of next-intl App Router is `[locale]` segment + middleware + `generateStaticParams`; admin used inferior cookie-based. Client went canon, not admin-copy.

**How to apply:**

- At recon of a new feature, if you find a precedent: verify the canonical pattern first.
- If precedent diverges from canon, follow canon and treat precedent as debt for backlog migration.
- Consistency is subordinate to correctness canonica.

---

## Rule: Canon check mandatory during revisitado — even if exit criteria pass

When revisiting a batch — even one marked complete — always check canon FIRST before declaring it done. Exit criteria passing means the author's assertions hold; canon alignment is independent and separately enforced.

**Why:** Edward: _"te diste cuenta de lo que sucedió cuando te dije que averiguaras el canon? Aun cuando me dijiste que ya estaba completamente wired de igual forma debiste cambiar muchas cosas y descubriste errores antes no detectados."_ (2026-05-02). During revisitado of T1-B, exit criteria passed but canon research revealed real gaps: `shutdownAll()` without timeout (deadlock risk vs K8s termination), return `void` (callers blind to drain state), background-task section missing from index.

**How to apply:**

- For EACH batch revisitado (even marked ✅):
  1. Read `canon_research_index.md` for the area — if section exists, review entries; if not, research canon new.
  2. Compare implementation against canon point-by-point — present, absent, or decision with tradeoff.
  3. Only then declare revisitado complete.
  4. If gaps with threat model: implement or backlog with justification (not silent skip).
- Exit criteria ≠ canon-aligned. They're independent dimensions.

---

## Rule: OmniPost is black-box — ALWAYS verify canon + runtime, never assume

OmniPost grew organically without guardrails. Code is a **black-box** and very probably not correct. Patterns existing in repo may be the wrong patterns. Never mimetize/propagate existing code without verifying canon + runtime.

**Why:** If you assume instead of verifying, "I lie to myself, I lie to him, and I cost him time and money." Trust is broken (2026-05-23). The code has false-green tests, uncabled services, wrong auth, non-functional realtime. The repo is NOT the source of truth — external canon + runtime verification are.

**How to apply:**

- NEVER copy a pattern because it's in the repo — repo is black-box, assuming it correct is the error.
- Before implementing/improving: (1) read canon_research_index; (2) if not covered, WebSearch + WebFetch official sources; (3) runtime-validity check (smoke test, curl, E2E).
- Don't label inference as canon. Distinguish: verified fact (code/runtime) vs research external (with source) vs judgment/inference.
- If can't verify (service down), say so — don't substitute with assumption.

---

## Rule: Check canon_research_index.md before researching — avoid dupe research and lock canon citations

**Mandatory**: Canon research is part of EVERY plan, not optional. Before doing new research (WebFetch/WebSearch on architecture, caching, libraries, security), MUST:

1. **Read `canon_research_index.md`** and find the relevant area.
2. **If topic is in the index**: refresh memory, cite the URL in plan; if old (6+ months) and fast-moving (LLM, GitHub Actions), re-fetch to validate.
3. **If topic is NEW**: do research, then ADD entry to index BEFORE citing in plan. Required fields:
   - URL, Used in, Date, Summary (1-2 triggers-recall sentences), Key takeaway (1 actionable rule), **Pattern adopted** (exact code pattern the repo standardizes on).
4. **Before citing in plan**: "the entry exists in the index" or "I added it to the index as part of this plan."

**Why:** Every time I research without checking the index, I either waste tokens re-researching or hand-wave with stale memory (2026-05-01, 2026-05-02, 2026-05-22). A plan that "feels sure" without canon has a track record of being wrong.

**How to apply:** While in plan mode, (1) read index for the area, (2) WebSearch to confirm external facts, (3) fold verified canon into plan as "Canon (verificado <date>) [sources]", (4) add index entry during execution. Only then ExitPlanMode.

---

## Rule: Replace incompatible libs, don't patch or cast

When a third-party library is incompatible (types broken with current React/TS, abandoned), the default approach is **search for an alternative compatible library and replace it**. Do NOT cast (`as unknown as ...`), do NOT patch types. Only if no viable alternative exists, ask Edward.

**Why:** Edward (2026-05-21, F1-CLI-1): _"buscar una alternativa a esta y reemplazar, a menos que no haya una alternativa, en ese caso entonces en ese momento veremos qué hacer."_ Coherent with [[no-suppression-no-time-bombs]] and [[feedback_no_patches]]. Examples: `react-diff-viewer` (abandoned) → `@git-diff-view/react`; `recharts` 2.x (broken types) → upgraded to 3.x.

**How to apply:**

- At compatibility error: (1) check if upgrade to compatible version solves it; (2) if lib abandoned, find maintained fork/alternative with clean types, migrate consumer code; (3) NO casts/patches unless no alternative exists (then ask Edward first).

---

## Rule: WebSearch for competition lens — never assume stale knowledge

When evaluating a finding through the "what do competitors offer" lens (Hootsuite, Sprout Social, Buffer, Later, etc.), **always WebSearch + summarize**. Never assume knowledge is current, even for "obvious" items (internal infra, low-relevance features).

**Why:** Edward: _"nunca se sabe lo que puedes encontrar en la web."_ Knowledge may be stale or incomplete. Categories that look non-differentiating (admin tooling) may have recent competitive moves. Search also reveals adjacent features that open scope ideas (2026-04-29).

**How to apply:**

- For EACH finding under competitive lens, WebSearch before verdict.
- Query patterns: `"<feature>" Hootsuite OR "Sprout Social" OR Buffer 2026`, `social media management <capability>`.
- Summarize 3-5 points: what they offer, how they differentiate, gap with OmniPost, implication for verdict.
- Maintain "Sources:" at the end with URLs found.
- Applies to visible UI features AND internal infra.

---

## Rule: Verify canon for literal security parameters — no improvisation, no copying between files

Before hardcoding security parameters (Argon2 cost, JWT algorithm, OAuth scopes, CSP directives, CORS origin, cookie flags, rate-limit thresholds), verify that a canon entry justifies the value. Never improvise with library defaults or copy from another file.

**Why:** Library defaults lag current recommendations (Argon2id RFC 9106 second recommendation: m=64MiB t=3 p=4, not the 4MiB default many libs use). Copying from another file replicates outdated decisions. Improvising is subtle vulnerability introduction (2026-05-01, T4-L).

**How to apply:**

- If a pattern is in `DECISION_PATTERNS` of pre_edit_decision_guard, the hook flags it via context.
- If not in hook but involves literal security values: verify canon-index before hardcoding.
- No canon → ask Edward if you research (preferred) or get explicit authorization.
- When canon research closes: add entry to canon-index with `decisionGuards: ["pattern-id"]`.

---

## Rule: Question the refactor — would you design it this way from scratch?

Before accepting existing code as the starting point for refactoring, always ask: "Is this the best way to do it if starting from zero?" Don't take the easy path without questioning the architecture.

**Why:** Edward identified a pattern — proposing the path of least resistance (soft-deprecate, override keyword, default optional values) without stopping to question the architecture. Refactors that keep design debt because "it's already that way" are incomplete (2026-04-22). Edward repeatedly favors comprehensive canon adoption — but that requires offering the canonical option, not asking him to extract it.

**How to apply:**

1. Before proposing a refactor: make a "from-scratch" mental pass — would you design it this way today?
2. List architectural decisions being accepted without question (singletons, inheritance vs composition, port pattern vs strings, etc.).
3. Expose the more radical alternatives with honest trade-offs — don't assume Edward prefers "minimal change."
4. If the "easy" option leaves design debt visible, flag that the "from-scratch" option exists and why you deferred it (or didn't).
5. Trigger phrases for "easy path bias": "to avoid breaking...", "soft-deprecate", "backwards-compatible default", "@deprecated", "keep singleton for compat", "fitness suppression for legacy" — when you hear these, ask: is this architecturally correct, or just the smallest change?

---

## Rule: Robustness > velocity — don't sacrifice canon/robustness when complexity rises

When the complexity of the canonical/robust option rises, **DO NOT lean toward the quick/simple path** sacrificing robustness, consistency, or canon. The cost is assumed; existing debt is not an excuse.

**Why:** Edward (2026-05-22, F1-API-3, emphatic): _"otra vez te dejaste influenciar por la complejidad y sacrificas la robustez por la velocidad… si hay que tirar todo el código y hacerlo desde cero, se hace por la consistencia, la robustez y sobre todo acorde al canon."_ The complexity of options doesn't justify deviating from canon. And existing debit (workers with prisma-direct instead of DI) is the smell to fix, not the model to follow.

**How to apply:**

- Default recommendation: the option canónica/robust. Cost is assumed, dimensioned, not hidden.
- Never argue "existing code violates DI, so I'll follow the same pattern" — that's how debt propagates, not fixes.
- DI is premise: use cases via container, not direct prisma access outside adapters. Applies to `apps/workers` too.
- If existing code violates this (workers with prisma-direct), it goes to backlog as smell, not as excuse.
- Better to complete a batch with fully-correct architecture than to ship debt "for speed."

---

## Rule: No defer in dev — aggressively close debt

OmniPost is development code, NO production. Upgrades, refactors, debt-closure are executable without production constraints. When a blocker is only "wait for X to change," the correct answer is execute the upgrade/refactor now.

**Why:** Edward (2026-05-06): _"Tarde o temprano vamos a actualizar todos los paquetes que usamos… este es código en desarrollo, no existe tal cosa como producción todavía, así que podemos actualizar, refactorizar… siempre y cuando nos ayude a avanzar y terminar el producto."_ The strategy is aggressively close debt to reach finished product, not defer indefinitely.

**How to apply:**

1. When PR is blocked by "await upgrade X / await feature Y stable" → upgrade/execute now (not defer).
2. If proposing options where one is "defer until prod / until X stabilizes" → that's NOT default recommendation; offer it "for completeness."
3. Preference: combined PRs / aggressive cleanup — upgrade dependency + apply dependent change in one operation.
4. Risks typical of prod (change window, rollback playbook, customer impact) don't apply — pre-prod only.
5. Do apply: don't break main without warning, keep tests green, don't lose Edward's work.
6. When in doubt: aggressive but reasonable — upgrade, execute, validate with tests + smoke. If broken in dev, fix forward.

---

## Rule: No suppression, no time-bombs — fix root causes or state unfixables explicitly

When a CI gate / lint / audit check fails, do NOT make it pass by suppressing: downgrading errors to `warn`, blanket `ignore`/allowlist, raising thresholds to mask debt, or hiding the problem. Fix root causes for real or state unfixables **explicitly and specifically**.

**Why:** A non-blocking warning prevents nothing — future regressions in that category pass green too, making the gate effectively disabled. Hidden debt resurfaces later with less context and more cost. Edward calls this "colocar bombas de tiempo por doquier" (planting time bombs everywhere) and considers it worse than not helping (2026-05-06, 2026-05-23).

**How to apply:**

- Fix the root cause for real (remove dead code, de-dupe, bump dep, repair link).
- If a tool misreports (false positives from DI/dynamic/config blindness): fix the tool's config so findings vanish genuinely (real entry points traced) — not silenced.
- A baseline/ratchet that **fails CI on any NEW finding** is acceptable (prevents regressions); a `warn` that fails nothing is not.
- If something genuinely cannot be fixed (transitive vuln with no upstream patch): state it **explicitly and specifically** with rationale — never bury in broad ignore.
- Don't claim a suppression "prevents regressions" when it doesn't — report what it actually does.

---

## How to extend

Adding a new canon-research rule:

1. Append a `## Rule: <short title>` section here with Rule / **Why** / **How to apply**.
2. If the rule names a SPECIFIC canon resource (web doc, ADR, OSS repo), cite the URL/path.
3. Cross-link with `[[rule-name]]` to related rules.
4. Universal canon rules go to `docs/architecture/ARCHITECTURE_CANON.md` instead (project canon, not personal).
