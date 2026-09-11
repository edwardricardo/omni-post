# Post Tenant Isolation — Delta Spec (tenant-rls-cost-repair)

> **MODIFIED capability** for change `tenant-rls-cost-repair`. Exactly ONE requirement of the
> living `post-tenant-isolation` capability changes: the **global unfiltered list**'s scoping
> MECHANISM moves from the transitive `project.accountId` relation to the post's LOCAL
> `accountId` column. **The rows returned are unchanged** — this is a mechanism change with a
> row-equivalence obligation, not a behaviour change.
>
> **Why the mechanism can move now.** When this capability was written, Post carried no tenant
> column, so the transitive relation was the ONLY expression of ownership — the living spec's
> preamble says exactly that. The A′ slice gave the trio a local `accountId` and a **composite
> foreign key**, which makes a post whose `accountId` disagrees with its project's `accountId`
> **unrepresentable**. The relation's `accountId` therefore became a redundant join predicate
> rather than a second check, and the join it forces is what keeps the read off the
> tenant-leading index. The living capability's preamble parenthetical — "(Post has no direct
> `accountId`)" — is superseded by that column for this surface; the sibling read surfaces are
> untouched by this change.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Requirements marked
> **[MERGE-BLOCKING]** gate the PR of the slice that owns them.
>
> **Scenario tags** are as defined in the `rls-policy-form` delta of this change: `[static]`,
> `[integration]`, `[evidence]`.
>
> **Non-goals (from the proposal, restated so they are not re-litigated here):** this delta does
> NOT move `filterIdsByAccount` or `findOwnerAccountId` — for those the join IS the semantics
> and they are off-limits. It does NOT move the point reads (`getById`,
> `getByIdWithThread`), whose docblock corrections are tidies rather than scoping changes, and
> it does NOT move the three unmeasured feed-shaped siblings, which are a named follow-up.

---

## MODIFIED Requirements

### Requirement: Global unfiltered list is not cross-tenant reachable [MERGE-BLOCKING]

`GET /posts` with no `projectId` SHALL NOT be reachable by a customer in any way that
returns posts outside the caller's account. A conforming implementation MAY satisfy
this by scoping the list to the caller's account (returning only own posts) OR by
restricting the unfiltered global list to admin principals (returning 403 to
customers). In neither case SHALL a customer receive posts belonging to another
account.

Where the implementation satisfies this by SCOPING, the tenant predicate SHALL be the post's
**local `accountId` column**, not the transitive `project.accountId` relation. The two are not
independent facts: the composite foreign key makes disagreement between them unrepresentable,
so carrying both is a redundant join predicate rather than a second guarantee. The account
value SHALL continue to be server-derived from the authenticated principal — the port already
receives it, so this move SHALL NOT change any call signature or introduce a client-supplied
scope selector.

The **project-liveness predicate SHALL be RETAINED**. Soft deletion does not cascade from a
project to its posts, so `project.deletedAt IS NULL` is load-bearing: it is what excludes the
posts of a soft-deleted project, and it is NOT part of what moves local. Dropping it would
change the returned rows, which this requirement forbids.

The returned row set SHALL be **unchanged** by this move, across every measured case.
**Row-equivalence is the HARD GATE; timing is evidence.** A faster shape that returns a
different row set FAILS this requirement.

(Previously: the global list's scoping was expressed through the transitive `project.accountId`
relation, because Post carried no local tenant column and the relation was the only stored
expression of ownership.)

#### Scenario: Customer global list never leaks other accounts [integration]

- GIVEN an authenticated customer in account A while account B also has posts
- WHEN the caller sends `GET /posts` with no `projectId`
- THEN the response either contains only account A's posts, or is 403 FORBIDDEN
- AND it NEVER contains any post owned by account B

#### Scenario: the scoping predicate is the local column [static]

- GIVEN the global-list read after this change
- WHEN its tenant predicate is inspected
- THEN it filters on the post's own `accountId` column and no longer carries the relation's `accountId`
- AND the account value still originates from the authenticated principal

#### Scenario: rows are identical before and after the reshape [integration]

- GIVEN the same corpus and the same caller account
- WHEN the global list (and its count) is executed under the pre-reshape and post-reshape forms
- THEN both return the identical row set and the identical count — any divergence FAILS the reshape

#### Scenario: posts of a soft-deleted project stay excluded [integration]

- GIVEN a caller in account A owning project Q, where Q is soft-deleted while its posts are not
- WHEN the caller sends `GET /posts` with no `projectId`
- THEN Q's posts are absent from the result, exactly as before the reshape

#### Scenario: timing evidence does not gate the reshape [evidence]

- GIVEN the reshape's measured re-run
- WHEN a case moves outside the ≤6 µs / <1 % band
- THEN it is recorded with an adjudication and does not by itself block the change
- AND a case returning different rows blocks it regardless of how it timed
