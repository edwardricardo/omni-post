# ADR-0043: The support documentation register — one page per feature for whoever answers a ticket, in English, stamped and kept fresh by a gate

- **Status**: Accepted
- **Date**: 2026-10-06 (the register and the answers Q1 to Q5, recorded in #433); 2026-10-07 (the
  method and ledger shared with the legal register, and `EXCEPTIONS.md` retired)
- **Decision-makers**: Product Owner and Maintainer, held by one person (`docs/GOVERNANCE.md`): the
  Product Owner for the register and the answers Q1 to Q4, the Maintainer for the thresholds of Q5
  and the gates
- **Consulted**: —
- **Informed**: —
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [docs/support/README.md](../support/README.md) (the generated index) and
  [\_TEMPLATE.md](../support/_TEMPLATE.md) (the page template);
  [Master Plan](../product/MASTER_PLAN_ES.md) §5.15 (SUP-1 to SUP-7);
  [ADR-0042](ADR-0042-legal-facts-register-method.md) (the method and the ledger this flow shares)

## Context

1. **The request** (Product Owner, 2026-10-06): a flow like the legal one, but for the technical
   documentation — record how each feature works, so that the support operators know how it works and
   where or what to look at when a ticket is opened — and, in the same flow, keep `docs/product/`
   current, except the Master Plan.
2. **Its place on the route.** It goes right after the legal facts register (Master Plan §5.10), with
   which it shares the gate machinery.

## Decision

1. **The register.** A living register in `docs/support/`, one page per feature, with mandatory
   sections in a fixed order:
   - what it does for the user;
   - how it works end to end, by code paths;
   - where to look when a ticket is opened: log fields and the correlation id, metrics, Admin
     screens, tables and columns, queues and jobs, provider error codes;
   - known failure modes, as "the ticket looks like this → the cause is usually → verify → fix or
     escalate";
   - configuration;
   - data and privacy, with a link to the legal register;
   - related documents;
   - verification.

   Each page carries a stamp `Last verified against main <sha> on <date> by <who>` and the `paths:`
   list of the files it describes, which is the input of the freshness gate. One home per kind of
   truth: `docs/runbooks/` keeps the per-alert procedures, `docs/features/` the specifications and
   `docs/api/` the endpoint reference; a support page links to them and does not repeat them.

2. **Q1 — language.** The pages are written in English, like the rest of `docs/`; a translation, if
   the support team needs one, is a later derivative and never a second source.
3. **Q2 — the operator-only pieces.** The three pieces only an operator sees — queues, outbox and
   system health — enter the register with their own page, and the runbooks keep the per-alert
   procedures and link to them.
4. **Q3 — product documents.** The docs role corrects every product document without the Product
   Owner's approval, because during construction they are reference material, and the final wording
   of those that speak for the company is adjusted at the end.
5. **Q4 — the claims register's scope.**
   [`IMPLEMENTATION_PLAN_ES.md`](https://github.com/edwardricardo/omni-post/blob/2ec1562180ebf61835140dc4f81e70db3d646b89/docs/archive/IMPLEMENTATION_PLAN_ES.md)
   was archived in `docs/archive/` (deleted from the tree on 2026-10-17) and stays out of the claims
   register, which covers seven documents.
6. **Q5 — thresholds.** A page fails with 5 commits on its `paths` after its stamp, or at 90 days,
   and warns from the first commit, or at 60 days. A product document's header fails at 60 days, or
   when it predates the last change of the Master Plan rows it cites. The numbers are reviewed three
   months after the gates land, with the measured trigger counts.
7. **The method and ledger of the legal register** (2026-10-07). This flow follows the method of
   ADR-0042 and its retro-documentation ledger: the retro pass reads each closed item once and, in that
   same read, fills its support page (the ledger's "Soporte" column) as well as its legal facts. SUP-2
   reuses the sections of LEGAL-2 in the templates, and SUP-3 the form of the gate of LEGAL-3.
8. **No dated exceptions table** (2026-10-07). `EXCEPTIONS.md` is retired: `NON_FEATURES.md`, where
   every candidate of the tree is `documented`, `non-feature` with its reason, or `pending`, and the
   grammar of `## Support impact`, which declares `none for <feature> — <reason>` in each pull
   request, absorb it.

## Rationale

1. **One source per truth.** A translation is a derivative, never a second source (Q1), and a support
   page links to the runbook, the specification or the endpoint reference instead of repeating it
   (decision 1).
2. **Product documents are reference material while the product is built** (Q3), so they are
   corrected without waiting for an approval, and the wording that speaks for the company is adjusted
   once, at the end.
3. **The thresholds answer to measurement** (Q5): they are reviewed three months after the gates
   land, with the counts of how often they fired.
4. **One read per closed item** (decision 7), shared with the legal register.

## Alternatives Considered

None recorded: the plan records the answers, not the options weighed. What each answer excludes:

- Q1 excludes a translation as a second source;
- Q2 excludes documenting the operator-only pieces in the runbooks alone;
- Q3 excludes an approval for each correction of a product document;
- decision 8 retires the table of dated exceptions, `EXCEPTIONS.md`.

## Consequences

**Positive**

- Whoever answers a ticket has one page per feature, with where to look and the known failure modes.
- Once the freshness gate lands (SUP-3), a page whose `paths` change after its stamp warns or fails
  by the thresholds of Q5.

**Negative / costs**

- The initial load (SUP-4) is its own work, page by page.

## Legal impact

None: documentation and the gates that keep it current. Each page's data-and-privacy section links to
the legal register (`docs/legal/REGISTER.md`) instead of restating its facts; no personal data,
cookie or storage key, OAuth scope, recipient, retention period, acceptance record or controller
role changes.

The section records facts for the register; it is not legal advice.

## Support impact

`none for support-documentation-register — this decision defines the register itself; no feature page
exists yet, and the template, the generated index and the non-features list are SUP-1's`

## Deployment impact

`none — documentation and CI gates; no repository variable or secret, runtime variable, external
account or post-deployment check is added, changed or retired`

## Revisit if

- Three months after the gates land: the thresholds of Q5 are reviewed with the measured trigger
  counts.
- The support team needs a translation: it is made as a derivative of the English page (Q1).

## Risks and Mitigations

| Risk                                                 | Mitigation                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| A page goes stale while its feature changes          | The freshness gate reads its `paths` and its stamp (Q5)         |
| A support page repeats a runbook and drifts from it  | One home per kind of truth: the page links instead (decision 1) |
| A candidate of the tree stays without a page or note | `NON_FEATURES.md` classifies every candidate (decision 8)       |

## References

- [Master Plan](../product/MASTER_PLAN_ES.md) §5.15, where these decisions were first recorded, at
  [`32e38081`](https://github.com/edwardricardo/omni-post/blob/32e38081aaed5de2c0dc565e72c468b3bcd621ce/docs/product/MASTER_PLAN_ES.md)
- The full plan `support-docs-flow-plan.md` (`/root/.claude/omnipost-tools/research-2026-10-06/`,
  outside the repository; engram 1310 to 1313, 1315 and 1316)
- [ADR-0042](ADR-0042-legal-facts-register-method.md): the shared method and ledger
