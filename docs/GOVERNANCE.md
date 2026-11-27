# Governance

Two roles decide in this repository. Every other artifact names a role, never a person; this page is
the one place where each role resolves to the person who holds it, by design
([ADR-0040](technical/ADR-0040-artifact-language-and-role-attribution.md)).

## The roles

| Role          | Decides                       | For example                                                      |
| ------------- | ----------------------------- | ---------------------------------------------------------------- |
| Product Owner | What the product does         | Priorities, the route, product decisions, legal decisions        |
| Maintainer    | How it is built and delivered | Architecture, merges, releases, the grant authority of the hooks |

- Stakeholders are not decision-makers. An ADR lists them in MADR's `consulted` (two-way
  communication) and `informed` (one-way); its `decision-makers` field names a role.
- A document's `**Owner:**` field names a role; the canon documents name `Maintainers`.
- The data controller of the processing register (GDPR art. 30) is the legal entity, not a
  repository role.

## Who holds each role

| Role          | Holder           | GitHub          | Since      | Until |
| ------------- | ---------------- | --------------- | ---------- | ----- |
| Product Owner | Edward Velasquez | `edwardricardo` | 2026-03-08 | —     |
| Maintainer    | Edward Velasquez | `edwardricardo` | 2026-03-08 | —     |

One person holds both roles, since the repository's first commit (`5603d6be`, 2026-03-08). The table
keeps every holder a role has had: a role named in an ADR or any other artifact resolves to the row
whose dates contain that artifact's date.

## Where decisions are recorded

- **ADRs** under [`technical/`](technical/) record architecture and convention decisions. Their
  `decision-makers` field names the role that decided (ADR-0001 holds the template).
- **Pull request approvals** record the decision to merge each change.
- **Git** keeps the commit author of every change.

## The hooks' grant issuer

The Maintainer holds the grant authority of the hooks. Only the Maintainer issues, extends and
revokes grants for sensitive operations, with `.claude/bin/omnipost-allow` from their own terminal;
no session can ([CLAUDE.md](../CLAUDE.md) §Bypass via authorization token, the paragraph "Only
the Maintainer issues grants").

- The grant files live under `.claude/.allowed/`, which git ignores, and a grant file is deleted
  once no grant remains in it.
- Every write of a grant file stamps `authorized_by` with the value of `GRANT_ISSUER` in
  `.claude/hooks-py/_common.py` (`_store_grants`), today `"edward"`. It names the holder, not the
  role.
- Nothing reads `authorized_by` back, and `.claude/hooks.log` does not record the issuer, so the
  field is a label on a local file, not an audit record.

**Push grants.** `omnipost-allow push --count K --ttl N` leaves K consecutive windows of N minutes (`--count` defaults to 1 and is at most 12; each operation keeps its default TTL, 15 minutes). Each push window allows one publication: pre-bash allows a push while a window contains now and records the command on that window's grant, and post-bash consumes that grant once the push succeeds, even when it finishes after the window closed. A failed push consumes nothing, so a retry in the same window is allowed; a grant used early does not open the next window early. Run again while grants are pending, it appends its windows after the last pending one. Grants whose window is over are pruned on every read. `omnipost-allow status` lists the pending grants with their windows, and `omnipost-allow revoke <operation>` deletes them. `sensitive-edit` takes the same `--count` and stays valid for its whole window; using it consumes nothing. Every create, claim, consumption, prune and revoke goes to `.claude/hooks.log`.

## How a role changes hands

1. A pull request edits the holder table above: it sets the outgoing holder's `Until` date and adds
   a row for the incoming holder, with its `Since` date.
2. The outgoing holder approves it. The change takes effect when it merges.
3. A change of Maintainer also changes the grant issuer, so the same pull request sets
   `GRANT_ISSUER` to the incoming holder's identity. That edit touches `.claude/hooks-py/**`, a
   sensitive path, so the pull request needs a `sensitive-edit` grant, which the outgoing holder
   issues while still the Maintainer.

## Deleting code

Removing something from the product takes two steps and two roles. The Product Owner decides
whether it is part of the product: it is implemented, or it is removed. The Maintainer validates the
deletion itself: when and how the code leaves. Neither step stands in for the other; a validation of
the Maintainer recorded before the Product Owner's decision waits for it.

That nothing consumes a piece of code does not prove it dead: before any destructive action the code
is classified in one of four classes, and only `DEAD_CODE` that the Maintainer confirms is deleted.

- **`PLANNED`**: code built for an intentional future feature.
- **`INFRASTRUCTURE_READY`**: infrastructure waiting for its integration or wiring.
- **`LEGACY`**: code that had consumers, lost them, and remains for a gradual migration.
- **`DEAD_CODE`**: code with no use and no plan, confirmed as such by the Maintainer.

Exempt from the Maintainer's validation, though never deleted automatically: `.bak` and `.old`
backups, one-off debug scripts, superseded configurations, and commented-out blocks whose history
git keeps.

A deletion unit (DC-1 to DC-14, rows of [the plan](product/PLAN.md)) is one pull request of about
400 lines of code, a size that is a heuristic and not a rule, split by module group when it exceeds
them. In the same pull request it updates its rows of `docs/reports/UNUSED_CODE_INVENTORY.md` and
passes `pnpm lint` with no warning, `pnpm exec tsc -b --force`, `node scripts/knip-ratchet.mjs`
(with `--write` to shrink the ledger), `pnpm check:duplicates`,
`apps/api/scripts/typecheck-tests-ratchet.mjs`, `pnpm check:architecture` and the suites of each
package it touches; a unit that touches the schema runs `pnpm db:up` first and passes its migration
and the RLS coverage gate. Lowering the `TEST_FILE_FLOOR` of `apps/api` requires its written reason.
Units with disjoint files can run in parallel; DC-13 edits `apps/api/src/index.ts`, as DC-2 does,
and the schema, as DC-7, DC-8 and DC-9 do, so it runs in series with them.
