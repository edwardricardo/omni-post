# ADR-0042: The legal facts register — what it records, and the method that builds it: mechanics first, a machine takes the present, one retro pass, qualitative decisions in sessions

- **Status**: Accepted
- **Date**: 2026-10-04 (the register approved); 2026-10-05 (its place on the route); 2026-10-07 (the
  method, shared with the support documentation, and the ledger's entry rule)
- **Decision-makers**: Product Owner and Maintainer, held by one person (`docs/GOVERNANCE.md`): the
  Product Owner for the register, its place on the route and its qualitative columns, the Maintainer
  for its mechanics (generators, gate and templates)
- **Consulted**: —
- **Informed**: —
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [docs/legal/README.md](../legal/README.md) and
  [REGISTER.md](../legal/REGISTER.md) (the register this method builds);
  [Master Plan](../product/MASTER_PLAN_ES.md) §5.10 (LEGAL-1 to LEGAL-5 and the retro-documentation
  ledger) and §5.15 (the support documentation, which shares this method);
  [ADR-0043](ADR-0043-support-documentation-register.md) (the support register)

## Context

1. **No facts to draft the legal documents from.** The terms of service, the privacy policy, the data
   processing agreement for businesses, the licence if the application is sold to another owner, and
   the acceptable-use and cookie policies would each have to be written from scratch, with no record
   of how the application works.
2. **Its place on the route.** The Product Owner approved the register on 2026-10-04 and on
   2026-10-05 placed it exactly after the Testing Refoundation (N-TEST-1), coupled to the Master Plan:
   "That one does go exactly after the TR, because it is extremely necessary to start modelling it
   right now." It is first in the queue, before Master Plan §5.9 and §5.11, and §5.15 follows it on
   the route, sharing the form of its gate (LEGAL-3 ↔ SUP-3) and the edits of the templates
   (LEGAL-2 ↔ SUP-2).
3. **When the method was set.** Phase 0 of N-TEST-1 closed on 2026-10-06, and the work started on
   2026-10-07 with the method below.

## Decision

1. **The register** (Product Owner, 2026-10-04). A living register in `docs/legal/` with the facts of
   how the application works, from which the documents of Context 1 are drafted later without
   starting from scratch. Each fact cites its source (an ADR or a code path) and the date it was
   verified.
2. **The method** (2026-10-07), shared with the support documentation of Master Plan §5.15, in five
   rules:
   1. **Mechanics first.** One mechanics slice: the generators of LEGAL-4 (personal data from the
      Prisma schema; external SDKs and subprocessors, from the manifests and the lockfile; OAuth
      permissions per provider; the client's cookies and storage) write inventories to
      `docs/legal/inventories/` with their source paths and the fingerprint (sha256) of each source —
      the verification date is the commit that regenerated them —; the skeleton of the register,
      `docs/legal/REGISTER.md`, with the sections of GDPR art. 30; the "Legal impact" sections of
      LEGAL-2 in the templates; and the gate LEGAL-3, with its red proven. The same gate and the same
      templates later serve SUP-3 and SUP-2.
   2. **A machine takes the snapshot of the present, not a session.** What is derived from the code
      has no phase: what already exists enters through the generators, without revisiting closed
      units.
   3. **The narrative of what is already closed is revisited once, guided by the retro-documentation
      ledger** of Master Plan §5.10. One retro pass, in batches of at most 400 lines of evidence,
      prioritized by exposure (credentials, OAuth, billing, mention and analytics ingestion, AI
      subprocessors); each item is read once and feeds both registers, the legal facts and the support
      page. The ledger goes by state, not by position in the phase: what was done before the gate gets
      the retro pass; what is in progress is documented in its closing pull request, and the gate stops
      it if it is not; what is open enters incrementally.
   4. **The qualitative is not drafted now.** The purposes, the legal bases, the retention periods,
      the frameworks beyond the GDPR and the language of the register are the Product Owner's
      decisions: their columns are marked "pending decision" and are closed in short sessions when
      their turn comes. LEGAL-5 waits for the inventory of purposes of LEGAL-1.
   5. **Sequence:** L-0 (this method and the ledger, in the Master Plan since 2026-10-07) → L-1
      (generators and the register's skeleton) → L-2 (gate) → L-3 (templates) → the retro pass by
      batches → LEGAL-5.
3. **What enters the ledger** (2026-10-07). Items of pure process or documentation (templates, gates,
   plan edits) do not enter the ledger, and the rule also applies to the rows already listed. The
   ledger itself, with its entry, marking and Pre-Phase rules, stays in Master Plan §5.10, where
   [docs/legal/README.md](../legal/README.md) points to it.

## Rationale

1. **The register is needed early.** In the Product Owner's words (Context 2), it is extremely
   necessary to start modelling it right now.
2. **What the code says, a machine says** (rule 2): what is derived from the code has no phase, so it
   enters through the generators, without revisiting closed units.
3. **One read per closed item** (rule 3): the same read feeds the legal facts and the support page,
   so closed work is read once for both registers.
4. **The qualitative columns are decisions, not drafting** (rule 4): purposes, legal bases and
   retention are the Product Owner's to decide, so they wait for a decision session instead of being
   written as if decided.

## Alternatives Considered

- **Revisit every closed unit to collect its facts.** Rejected by rule 2: what is derived from the
  code enters through the generators.
- **Draft the qualitative columns now.** Rejected by rule 4: they are decisions, closed in short
  sessions.
- **One read per register.** Rejected by rule 3: each closed item is read once and feeds both.

## Consequences

**Positive**

- The present facts come from generators, and the gate LEGAL-3 (fitness #45) fails when a legally
  relevant surface changes without its inventory.
- The support documentation reuses the same gate form, the same templates and the same retro pass.

**Negative / costs**

- The qualitative columns stay "pending decision" until the Product Owner's sessions close them.
- The retro pass is its own body of work, batch by batch, until the ledger is marked.

## Legal impact

- **Personal data**, **cookies and browser storage**, **OAuth permissions** and **recipients**: none
  changes by this decision; it sets how their inventories are generated (rule 1).
- **Retention and deletion**: none; the retention periods are among the qualitative columns that stay
  "pending decision" (rule 4).
- **Consent and acceptance evidence**: none; LEGAL-5 decides them after LEGAL-1's inventory of
  purposes.
- **Controller or processor role**: none.

The section records facts for the register; it is not legal advice.

## Support impact

`none for legal-facts-register — the register under docs/support/ holds no feature page yet; the
shared retro pass writes those pages (ADR-0043)`

## Deployment impact

`none — documentation and a CI gate in an existing job; no repository variable or secret, runtime
variable, external account or post-deployment check is added, changed or retired`

## Revisit if

- A decision session closes a qualitative column: the register records the decision with its
  source and date, and the column leaves "pending decision".
- The retro pass marks the last ledger row: rule 3 has nothing left to read.

## Risks and Mitigations

| Risk                                          | Mitigation                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| A closed item's facts are never collected     | The ledger lists every closed item that touches data or credentials      |
| An open item ships without its facts          | The gate stops its closing pull request until it documents them (rule 3) |
| A qualitative column is written as if decided | Rule 4: it stays "pending decision" until the Product Owner's session    |

## References

- [Master Plan](../product/MASTER_PLAN_ES.md) §5.10, where these decisions were first recorded, at
  [`32e38081`](https://github.com/edwardricardo/omni-post/blob/32e38081aaed5de2c0dc565e72c468b3bcd621ce/docs/product/MASTER_PLAN_ES.md)
- [docs/legal/README.md](../legal/README.md): the register's conventions and its pending decisions
- GDPR art. 30: the record of processing activities the register's sections follow
