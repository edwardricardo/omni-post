# ADR-0040: Artifact language and role-based attribution

- **Status**: Accepted
- **Date**: 2026-10-28
- **Decision-makers**: Product Owner and Maintainer, held by one person
  ([GOVERNANCE.md](../GOVERNANCE.md)); decisions D1 to D7 of the artifact-language plan, 2026-10-28
- **Consulted**: —
- **Informed**: every contributor and agent session, through [CLAUDE.md](../../CLAUDE.md)
  §Documentation Policy, which every session loads
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [GOVERNANCE.md](../GOVERNANCE.md);
  [FOUNDATION_PRACTICES.md](../development/FOUNDATION_PRACTICES.md) FP-025; ADR-0001 (the template)

## Context

1. **Two languages in one tree.** Measured on 2026-10-28 against `main @ 4e73e6dc`, with a heuristic
   that gives a floor, 83 tracked files held 2,975 Spanish lines: plans (9 files, 1,094 lines),
   product locale data (18, 827), dated history (20, 353), production-facing text such as alert
   texts and runbooks (18, 347), living documents (12, 270), documents with an English twin (2, 70)
   and tool data (4, 14).
2. **A person where a role decides.** The same day, 187 files held 887 mentions of the person who
   took the repository's decisions: 713 where a role decides (for example the `Deciders` field of
   ADR-0018 to ADR-0022), 130 in `github.com/edwardricardo/...` permalinks, 11 identities (8 in
   `.github/dependabot.yml`, `CODEOWNERS`, the hooks' `GRANT_ISSUER`, one openspec design line), 22
   quotes and 11 test fixtures. 27 ADRs carry 93 of them. A name records who decided, not by which
   authority, and nothing in the tree mapped a name to an authority.
3. **The workflow wrote Spanish into new documents.** The ODD protocol quotes each request
   verbatim in the user's language, so a feature document started bilingual whenever the request
   was made in Spanish.
4. **Plans outlive their purpose.** A closed plan or tracker stays in the tree, so its language and
   its names would be swept like a living document's, although nothing reads it any more: the
   Testing Refoundation tracker alone carries 97 mentions of the person.

## Decision

1. **Language.** English is the only language of every tracked artifact: code, comments,
   configuration, CI, documentation and plans. Four classes are exempt, and no others:
   - product locale data (`apps/admin/messages/es.json`, `apps/client/messages/es.json`, the i18n
     fixtures, a language's name written in that language, and test fixtures whose subject is
     non-English text);
   - a document with an English twin (`docs/product/INVESTOR_ES.md` beside `INVESTOR_EN.md`,
     `docs/product/MARKETING_ES.md` beside `MARKETING_EN.md`);
   - immutable or third-party content, such as an applied Prisma migration, whose checksum Prisma
     verifies (for example a Spanish comment in
     `infra/prisma/migrations/20260505050405_templateanalytics_revenuegenerated_decimal/migration.sql`),
     or vendored third-party data;
   - detector vocabulary, such as the bilingual tripwire word list of
     `.claude/hooks-py/pre_edit_tripwire_blocker.py` and its mirror in the tripwire table of
     CLAUDE.md, which must name the Spanish words it detects, or the artifact-language gate and
     its suite, which name the words they count.

   Two kinds of file are left out of the count without being exempt: a generated record is
   counted at its source, never a second time; and a file holding a recorded defect carries that
   defect's ID as its reason until the defect closes.

   A person's identity stays only where the roles rule requires it (decision 2). A chat session is
   not an artifact. Spanish product text outside the locale files, such as the notification strings
   of `packages/core/inbox/src/handlers/InboxEventHandlers.ts`, is a defect (DEF-151), not an
   exception.

2. **Roles.** An artifact names the role that decides, never the person who holds it. There are
   two roles:
   - **Product Owner** decides what the product does: priorities, the route, product and legal
     decisions.
   - **Maintainer** decides how it is built and delivered: architecture, merges, releases, and the
     grant authority of the hooks (`omnipost-allow`).

   A canon document's `**Owner:**` is `Maintainers`. Stakeholders are not decision-makers: an ADR
   lists them in MADR's `consulted` (two-way communication) and `informed` (one-way). The data
   controller of the processing register (GDPR art. 30) is the legal entity, not a repository
   role. A person's identity stays only where it is required: `github.com/edwardricardo/...`
   permalinks, `CODEOWNERS`, `.github/dependabot.yml`, `GRANT_ISSUER` (the issuer identity the
   hooks stamp on their grant files), and
   [GOVERNANCE.md](../GOVERNANCE.md), which maps each role to its holder and the dates they held
   it. A quote of a person becomes an English translation attributed to the role. The ADR template
   (ADR-0001) replaces `Deciders` with MADR's `decision-makers`, `consulted` and `informed`.

3. **Accepted ADRs.** An accepted ADR may swap a person for the role that decided, in its metadata
   and in its prose. Its decision, its status and its rationale are untouched. The edited ADRs
   carry no per-file note: this ADR is the record of the rule. GOVERNANCE.md records who held each
   role and since when, so a role named in an old ADR resolves to the person who held it on the
   ADR's date, and git keeps the commit author and the pull request approval.
4. **Requests in feature documents (ODD option (b)).** This repository overrides two clauses of
   the ODD protocol: `L1` quoting the request verbatim in the user's language, and each `S#`
   quoting the user's exact strings verbatim. A feature document carries only an English
   translation of each request and of each later correction, and its `S#` quote that
   translation. The originals are kept
   verbatim in one Engram observation per feature, under topic `odd/<feature>/requests`, which
   holds every `L#` and is replaced whole on each update: a save under an existing topic key
   replaces the observation, so a separate save per `L#` would lose the earlier ones. Feature
   documents live under `odd/`, which git ignores, so no pull request shows them. The pull request
   that implements a request therefore quotes in its body the translated `L#` it implements, and
   the Product Owner's approval of that pull request approves the translation, which is then the
   contract. Product data, such as `es` locale text, is copied as is.
5. **Plan closure.** Every tracked plan or tracker (a document whose purpose is to schedule or
   track work: the Master Plan, a roadmap, a tracker) carries a fixed `## Closure` heading that
   names where its state, decisions, rules, lessons and pending items go when it closes; one that
   predates this rule gains the heading at its closure at the latest. When it closes, each of
   them moves to the home its `## Closure` names, the file leaves the tree, and every place that
   cites it gets a permalink of the form
   `https://github.com/edwardricardo/omni-post/blob/<sha>/<path>`, where `<sha>` is a commit that
   still holds the file. Only what survives is translated. The Testing Refoundation tracker is the
   first to close this way: its state goes to `TESTING_INFRASTRUCTURE.md`, its binding decisions to
   ADRs or the canon, its lessons to `FOUNDATION_PRACTICES.md` and its pending items to the Master
   Plan.
6. **A gate holds the debt.** The artifact-language gate counts, per tracked file, Spanish lines and
   personal-name mentions against a baseline that must equal the count in both directions: a file
   whose count rises fails, and a file whose count falls lowers its baseline in the same change. It
   fails closed when it cannot read its baseline. Its allowlist names every exempt file with its
   reason. The baseline is deleted once every count reaches zero, and the gate then requires zero.

## Rationale

1. **One language is one reading.** The operator who reads an alert text or a runbook during an
   incident, the reviewer of a pull request and the agent session that loads the canon all read the
   same tree. Most of the Spanish lines sit in plans, history and prose (Context 1), around code
   whose identifiers are English.
2. **A role survives a change of holder; a name does not.** A role says by which authority a
   decision was taken. When a second person joins, only GOVERNANCE.md changes. The terms are
   standard: Scrum's Product Owner, a repository's maintainer, and MADR's decision-makers,
   consulted and informed.
3. **ADR immutability protects the decision, not the form of its metadata.** Nygard's and MADR's
   immutability guards what was decided and why. Swapping a name for the role that decided changes
   neither, so it needs no superseding ADR, and 27 per-file notes would repeat this ADR 27 times.
4. **Option (b) removes the source of new Spanish without losing the original.** Engram keeps the
   request verbatim, and the Product Owner, who made the request, approves the translation by
   approving the pull request that quotes it, so a mistranslation is caught by the one reader who
   can judge it.
5. **Translating a plan that is about to leave is waste.** Its living content survives in its
   permanent homes, which are the only parts translated.
6. **A convention nothing checks drifts back.** omni-post made method-level JSDoc canon with
   nothing enforcing it, and later measured 35% of public methods with no JSDoc at all (FP-006). A
   baseline equal in both directions stops the debt growing on its first day, and each sweep lowers
   it in the same diff.

## Alternatives Considered

- **Keep both languages and translate on demand.** Rejected: every pull request that touches a
  plan or a tracker adds to the debt, and a reader of one language cannot tell which half they
  missed.
- **One role, "Owner", or "Stakeholders" as the decision-maker.** Rejected: one role cannot say
  whether a decision is about what the product does or how it is built, and stakeholders are
  consulted or informed, not deciders.
- **Keep the names and add a page that explains them.** Rejected: every artifact would still go
  stale when a holder changes; the role in the artifact and the holder in one page is the same
  information with one place to update.
- **A per-file note in each edited ADR.** Rejected: 27 notes saying what this ADR says once.
- **Keep the ODD verbatim quote, with its translation beside it.** Rejected: the tree would stay
  bilingual by construction, which is the problem this decision closes.
- **A convention without a gate.** Rejected: see Rationale 6.

## Consequences

**Positive**

- A new artifact has one language and names a role from the day it is written; the gate refuses
  the rest.
- A decision in an old ADR resolves to a person through GOVERNANCE.md and to an exact change through
  git, without the ADR naming anyone.
- Plans close by moving their living content, so the tree keeps what is still true.

**Negative / costs**

- The sweep of the existing debt is a workstream of its own, delivered as chained pull requests, and
  until it ends the gate carries a per-file baseline.
- A translation can lose nuance. The Engram original, and the Product Owner's approval of the pull
  request that quotes the translation, bound that loss to one review.
- The gate is a heuristic: unaccented Spanish with fewer than two stopwords is invisible to it, so
  its count is a floor.

## Legal impact

None: documentation, governance and a CI gate. No personal data, cookie or storage key, OAuth scope,
recipient, retention period, acceptance record or controller role changes; the controller of the
processing register stays the legal entity.

## Support impact

`none for artifact-language-and-role-attribution — no support document under docs/support/ lists
the paths this decision touches (CLAUDE.md, docs/)`

## Deployment impact

`none — documentation and a CI step change; no repository variable or secret, runtime variable,
external account or post-deployment check is added, changed or retired`

## Revisit if

- A second person joins: GOVERNANCE.md gets a row per role they hold, and nothing else changes.
- Every count of the gate reaches zero: its baseline is deleted and the gate requires zero.
- The notification defect (DEF-151) is fixed: `InboxEventHandlers.ts` leaves the gate's allowlist.

## Risks and Mitigations

| Risk                                                       | Mitigation                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A role named in an old ADR cannot be resolved to a person  | GOVERNANCE.md keeps every holder with their dates; git keeps the author      |
| A translation changes what a request asked for             | Engram keeps the original; the PR that implements it quotes it for approval  |
| Spanish the heuristic cannot see stays in the tree         | The count is a floor; review reads the diff, and each sweep reads its files  |
| A plan leaves while a living document still stands on it   | The closure moves the living content first, then replaces each citation      |
| The allowlist grows into a place to park untranslated text | Each entry carries its reason; an entry with a defect ID leaves with its fix |

## References

- [CLAUDE.md](../../CLAUDE.md) §Documentation Policy: the artifact-language, roles, feature-document
  request and plan-closure rules
- [GOVERNANCE.md](../GOVERNANCE.md): the roles and their holders
- ADR-0001: the template, with the MADR fields
- [FOUNDATION_PRACTICES.md](../development/FOUNDATION_PRACTICES.md) FP-025 and FP-006
- MADR template — https://github.com/adr/madr/blob/develop/template/adr-template.md
- Nygard, Documenting Architecture Decisions —
  https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
