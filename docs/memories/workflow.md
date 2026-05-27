---
name: feedback-workflow
description: "Edward's workflow + execution discipline canon — planning, asking, branching, commits"
metadata:
  type: feedback-canon
  owner: edward
  loaded: every-session-via-claude-local-md
---

# Workflow & Execution Discipline

> Personal canon: how Edward expects work to be planned, gated, and executed.
> Auto-loaded via `@~/.claude/feedback/workflow.md` in `CLAUDE.local.md`.

**Owner:** Edward
**Loaded:** every session (Claude Code `@`-import, depth 1)

---

## Rule: Always plan first — formal checkpoint before execution

Enter Plan Mode and present plan for approval BEFORE executing any work, even when prompts include complete instructions. The plan is a checkpoint for Edward to review before code is written.

**Why:** Plan = checkpoint for Edward's review. Applies to ALL tasks without exception (Edward 2026-04-13). The purpose is not clarity—it's authority to proceed.

**How to apply:**

- Every new task: read prompt → enter Plan Mode → write plan file → call ExitPlanMode → wait for approval → execute.
- No exceptions, regardless of how detailed the prompt is.

---

## Rule: Check plan file, not context summary, after context compression

After context compression, ALWAYS read the plan file in `.claude/plans/` before resuming — never trust the auto-generated context summary. The summary may be frozen with stale information.

**Why:** Edward changed the plan but the context summary was stale. This caused incorrect information to be repeated multiple times on session resume.

**How to apply:**

- When conversation restores from a summary, the FIRST action is to read the plan file and verify it matches what the summary says.
- If there's discrepancy, the plan file is source of truth.

---

## Rule: Clean memory after plan completion

Before delivering the final report, remove all references to the executed plan from MEMORY.md. Memory should be clean for the next session without carry-over context from completed plans.

**Why:** Previous session information (bug fixes, edits, plan details) mixed with current sprint state caused confusion. The "continuation summary" is not reliable memory — it can contain obsolete context.

**How to apply:**

- At the end of each sprint/plan: (1) execute verification, (2) clean MEMORY.md of plan references, (3) update project state if applicable, (4) THEN deliver final report.

---

## Rule: Ask when in doubt — never assume, never deliberate, never suppress ambiguity

When Edward's response is ambiguous or the context admits multiple interpretations, **ask Edward before acting**. Do not deliberate internally, do not suppress the ambiguity with a chosen interpretation, do not take atajos.

**Why:** Suppressing ambiguity has led to code that was broken, misleading, and low-value — production risk that Edward called "inaceptable" (2026-05-11). Concrete failures: (1) deleting tests without writing replacements → 0 coverage; (2) deleting tests that verified valid contract alongside deprecated tests → loss of useful signal; (3) changing security checks as "side-effect" of test fix → introduced capability leak; (4) documenting code smell as if it were functionality → hidden debit.

**How to apply:**

- When Edward's language uses domain concepts that may be confused (admin/client/shared scope) → ask.
- When multiple technical paths are reasonable for implementing a decision → ask which.
- When workflow rules have ambiguous words ("all tests" = full suite? module suite?) → ask.
- Present 2-3 interpretations with practical effect of each; ask which applies.
- One question per turn if possible — don't spray 5 simultaneous questions.
- Rule applies to product decisions, scope, workflow — NOT to implementation details where there's only one correct way (e.g., TypeScript syntax, naming convention).

---

## Rule: Enumerate chain-deletes explicitly before execution

When a deletion implies chain-orphan cleanup (fields, imports, re-exports, comments that die when the primary method is deleted), enumerate each item in the brief BEFORE executing and ask for approval: bundle, cherry-pick, or preserve.

**Why:** Edward approved "DELETE method X" but I also deleted 7 chain-orphan items without listing them. He said "we were going to review one by one and decide." The chain-deletes happened to all be scope-ROI (verified), so he accepted post-hoc, but the **protocol was violated** — he lost the chance to evaluate each item (2026-05-12).

**How to apply:**

- In the brief before executing, list:
  - The primary item to delete (+ reason).
  - **Table of chain-items** with: use pre-delete, reason why orphan, context if historical/referential.
  - Explicit question: "Bundle (all 1-N), cherry-pick (specify), or preserve all?"
- Verify each chain-item with grep — genuinely orphan, not used by non-obvious consumer.
- If chain-item is a historical comment or ADR-style note, mention separately — may have signal value independent of code.
- If chain-item is a re-export (external boundary), verify zero consumers cross-app/cross-package before including.
- Edward's "Yes" to the enumerated brief = approval bundle. "Only 1,3,5" = cherry-pick.

---

## Rule: Review POST_REMEDIATION_BACKLOG after each batch closes

After closing each roadmap batch, audit `docs/audits/POST_REMEDIATION_BACKLOG.md` and classify each entry as: already closed (FIXED/WONT_FIX), blocked (by Edward decision / cross-batch dep / scope ownership), or newly unblocked. Propose unblocked entries before moving to the next batch.

**Why:** Maintaining active backlog review post-batch avoids invisible debt accumulation and leverages warm context when a PR depends on what just shipped (Edward 2026-04-29).

**How to apply:**

- Trigger: after `chore(remediation): T<n>-<letra>` commit, audit the backlog before proposing next batch.
- Output: classified list (closed / blocked-with-reason / newly-unblocked) with scope/estimat/no-conflict-check.
- If unblocked items exist: ask Edward before executing; offer risk-asc order by default.
- If none exist: state it explicitly and proceed to next batch.
- Verify no-conflict: for each unblocked PR, confirm against next 2-3 batch entries that fix doesn't rewrite files those batches will touch.

---

## Rule: Remediation works in a separate branch with commit gates on tests

All extended workstream work (remediation, horizontal audits, multi-batch cleanup) runs on a dedicated git branch, not main. Within that branch, each batch terminates in a commit ONLY if the full test suite passes 100%. If any test fails, no commit until fixed.

**Why:** Edward requested isolation of extended work from the main line and guarantee that each commit leaves the repo in green state. Prevents invisible regressions that accumulate silently (2026-04-21).

**How to apply:**

- Single branch for the entire workstream cycle (not per-batch, not per-tier). Name to be confirmed by Edward each time.
- One commit per batch completed + tests passing. Interpretation A confirmed.
- Never `git commit` if `pnpm test` reports failures.
- Merge to main only at end of entire cycle, not per-batch.
- Rule applies to extended workstreams. Documentation changes (roadmap, memories) may continue on main.

---

## Rule: No Co-Authored-By on commits

Commits must NOT include the `Co-Authored-By:` trailer (or variants with any Claude model). Edward is the sole repo user; dual attribution adds no operational value and clutters the log.

**Why:** Not a credit issue — Edward knows perfectly well when working with Claude. Dual author attribution doesn't help operationally and adds noise to git history (2026-05-04).

**How to apply:**

- In `git commit -m`, omit `Co-Authored-By: ...` lines entirely.
- HEREDOC for commit message ends with the last line of body description, no trailer.
- Applies to ALL commits in the omni-post repo.

---

## Rule: Don't anchor every observation on the remediation plan

The remediation roadmap is ONE workstream, not THE workstream. OmniPost is broader: product, infra, dev experience, growth. Avoid framing every observation, suggestion, or decision through the lens of remediation batches/phases/backlog.

**Why:** Edward observed that many responses bring up the remediation plan, its batches, or its backlog even when the question is about something else (2026-05-06). This narrows the decision space. The plan is a tracking tool, not the default mental map.

**How to apply:**

- When the question is ambiguous, don't assume the context is remediation — ask or frame broader.
- When proposing actions, don't list them with batch references (T*-*) or PR references (PR-\*) as the primary organization. The plan is one way to organize work, not the only way.
- When recommending next steps, include alternatives that aren't part of the roadmap.
- If the conversation genuinely treats remediation, mentioning it is fine. The rule stops the forced framing.

---

## Rule: Finish before starting new — prefer item-by-item to overlapping epics

Close the current workstream/plan BEFORE proposing another. Don't start parallel épics that overlap without closing the prior one. Prefer the backlog's item-per-item approach with discrete PRs and verifiable verdicts over large épics that blur together.

**Why:** Edward expressed disappointment after chaining Saga Canon Retrofit → horizontal-audits-v1 → smoke-e2e-v1: each started well but none closed cleanly, leaving 2 open PRs with failing CI and diffuse workstreams. His explicit preference: discrete items from backlog (PR-N) with verifiable verdict per item (valid / redundant / dead / unmap / FIXED / DEFERRED). That format lets him go item-by-item, validate, mark, advance (2026-05-10).

**How to apply:**

- Before proposing new plan/workstream: confirm current one is closed (PR merged, tests green, backlog updated). If not, ask if Edward wants to close it first or consciously pivot.
- Prefer backlog item-by-item (one PR-N at a time, verdict on close) over multi-tier épics.
- If a workstream hits a blocker out-of-scope: register as entry in POST_REMEDIATION_BACKLOG, don't start a parallel workstream.
- Each batch closes with: FIXED? DEFERRED? WONT_FIX? — explicit verdict before next item.

---

## Rule: Avoid rework-churn — commit to the genuine plan and execute decisively

Iteration-after-iteration and repeated recalibration are exhausting. Diagnose thoroughly upfront; choose the genuinely-correct approach (not the quick/suppressive one) and commit to it. Avoid: re-litigating decided decisions, presenting option-menus at every fork, recalibrating scope repeatedly, proposing a path then walking it back.

**Why:** Each round-trip costs Edward energy and trust. He wants a correct, durable outcome, not a negotiation. Frequent "which option?" prompts read as offloading judgment back onto him (2026-05-23). Edward said explicitly: _"continuamos, yo te digo cuando parar"_ — once a plan is approved, execute through ALL its phases with checkpoint commits + brief progress notes, and do NOT ask "continue or stop?" at each phase boundary. He will say when to stop.

**How to apply:**

- Diagnose thoroughly upfront; choose the correct approach (not the quick one) and commit to it.
- Execute end-to-end; only pause for true external blockers (push-grant) or genuinely irreversible/ambiguous decisions.
- When work is large, say so once and set expectations, then proceed — don't keep returning for permission to continue.
- Don't overstate what a change accomplishes; the user will catch it and trigger another correction loop.
- Once a multi-phase workstream is approved, execute through ALL phases with checkpoint commits + brief notes. Asking at each boundary is itself the churn.

---

## Rule: Enumerate all impacted sites via grep before scope-lock

Audit method discipline: a roadmap finding name is the FLOOR, not ceiling. Always grep repo-wide by pattern signature BEFORE locking scope. Document audit method (regex, filters, raw count) in every plan.

**Why:** Roadmap entries name one instance. The bug is the pattern, not the instance. Example: L-538 "Invoice.amount Float" is one hit; the pattern is "money-as-Float". Audit must find ALL instances before scope-lock. Edward asked "¿Hasta cuando te seguirás confiando y equivocando en diagnosticar?" — recurring failure of method, not instances (2026-05-01).

**How to apply:**

- Roadmap entry name describes one instance. Audit must find ALL instances of the pattern.
- Run broad-pattern grep as the FIRST step of every plan, not the last. The grep output appears in plan's "estado verificado" as the basis for scope.
- Filters are scrutinized, not data-shopping. If you write `grep ... | grep -v "external_pattern"`, justify each `-v` with code evidence.
- Document raw-count BEFORE filters, in-scope count AFTER filters, justification for each filter. Example format:
  ```
  Pattern: money-as-Float
  Raw grep: 7 hits
  Excluded: 4 (Stripe IDs documented as loose-by-design, verified [path:line])
  In-scope: 3
  ```
- Double-pass: first by name, second by behavior signature. The second pass catches misses.
- Re-audit before closing batch. If in-scope count > 0 still, batch is not done.

---

## Rule: When to use turbo vs single-package testing (memory-constrained environment)

Use `pnpm test` (incremental turbo with HEAD^1 filter) for routine testing. Use `pnpm --filter @apps/X test` only when explicitly needing a full suite re-run. **BUT**: due to LXC memory limit (9GB), running the full suite often collapses the box. Prefer tests by-file in day-to-day work.

**Why:** `pnpm test` leverages turbo cache and orders of magnitude faster on no-op runs. Edward called out repeated full-suite runs instead of leveraging turborepo (2026-05-06). However, the homelab has 9GB RAM and baseline ~1.4GB; full suite OOMs consistently (2026-05-23).

**How to apply:**

- **Default**: run only affected packages + test by-file: `pnpm --filter @apps/api exec vitest run <path/to/file.test.ts>`.
- Use `pnpm test` for incremental cached runs (good for verifying impact of a narrow change).
- Use `pnpm test:all` ONLY when suspecting regressions from cross-cutting changes (shared types, major refactor). Warn Edward first.
- Never `pnpm --filter @apps/api test` on full suite in day-to-day; that's the OOM pattern.
- Cap Node heap: `tsc --noEmit` ≤ 5120 MB, `vitest` ≤ 3072 MB. Never `--max-old-space-size=8192` on this box.
- If OOM occurs, file is recoverable but timeouts the flow — use per-file tests instead.

---

## How to extend

Adding a new workflow rule:

1. Append a `## Rule: <short title>` section here with Rule statement / **Why** / **How to apply** subsections, mirroring existing entries.
2. If the rule supersedes an existing one, mark the older one as `**Status:** Superseded by [[<new-rule>]]` rather than deleting — preserves the "why we changed" trail.
3. If the rule is universal (not Edward-specific), promote it to a CLAUDE.md canon child instead (ARCHITECTURE_CANON / CODING_STANDARDS / SECURITY_CANON / LOGGING_CANON).
4. Cross-link with `[[rule-name]]` to related rules in any of the 5 feedback canon files (this, `canon-research.md`, `audit-deletion.md`, `runtime-contract.md`, `tools-infra.md`).
