# Post Tenant Isolation — Specification

> Living specification for the **post-tenant-isolation** capability: caller-account
> ownership gating on customer-facing post surfaces — both **mutation** (DELETE) and
> **read** (single-get, thread-expanded get, by-project list, global list). Established by
> change `post-delete-ownership-gate` (Slice 0 of the `project-scoped-tenant-guard`
> workstream), archived 2026-07-14, which closed the LIVE cross-tenant IDOR (CWE-639) on
> `DELETE /posts/:id` by gating deletion on caller-account ownership via a REQUIRED
> caller-context union — reaching parity with the Update/Archive/HardDelete/Duplicate
> routes, but with a compiler-enforced (fail-closed) context rather than their optional
> `callerAccountId?`. Extended by change `post-read-ownership-gate`, archived 2026-07-17,
> which closed the LIVE cross-tenant **read** IDOR (CWE-639) across four customer-facing
> read surfaces by threading a server-derived `callerAccountId` into the read use cases and
> scoping the Prisma WHERE via the transitive `project.accountId` relation (Post has no
> direct `accountId`).
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each requirement carries
> Given/When/Then acceptance scenarios.
>
> Verification method: the MERGE-BLOCKING requirements are proven by real-DB two-tenant
> INTEGRATION tests through HTTP — the DELETE gate by
> `apps/api/tests/integration/postDeleteOwnership.test.ts`, the read gate by
> `apps/api/tests/integration/postReadOwnership.test.ts`. A mocked unit test cannot detect
> a missing ownership filter.
>
> **Scope note.** This capability covers the customer-facing post **read** surfaces
> (`GET /posts/:id` plain + thread, `GET /posts?projectId=<id>`, and the unfiltered
> `GET /posts` global list) and the `DELETE /posts/:id` mutation. The sibling
> Update/Archive/HardDelete/Duplicate mutation routes still use the fail-open optional
> `callerAccountId?` pattern (pre-existing, out of scope) — migrating them to the required
> `caller` union is a tracked follow-up (Slice-6 audit of `project-scoped-tenant-guard`).
> This capability is an app-level, by-convention gate; it is superseded at the data layer
> by the structural Post guard (Slice 8) of the same workstream.

---

## Requirements

### Requirement: Ownership-scoped post deletion [MERGE-BLOCKING]

`DELETE /posts/:id` SHALL delete a post ONLY when the post belongs to the
caller's account. The owning account SHALL be resolved from stored ownership,
not from the request payload. If the post's owner does not match the caller's
account, or the post does not exist, the operation SHALL resolve to NOT_FOUND —
the post SHALL NOT be deleted and its existence SHALL NOT be revealed.

#### Scenario: Owner deletes own post

- GIVEN an authenticated caller in account A owning post P (DRAFT/FAILED/CANCELLED)
- WHEN the caller sends `DELETE /posts/P`
- THEN P is deleted and a success response is returned

#### Scenario: Foreign post id is not deleted

- GIVEN an authenticated caller in account A and post P owned by account B
- WHEN the caller sends `DELETE /posts/P`
- THEN the response is NOT_FOUND (404)
- AND P remains present and unmodified

### Requirement: Anti-enumeration response parity [MERGE-BLOCKING]

A foreign-account post id SHALL produce the SAME NOT_FOUND (404) response as a
genuinely nonexistent id — identical status code and body shape. No signal
(distinct status, message, body field, or error code) SHALL reveal that the id
exists but belongs to another account. Ownership mismatch SHALL NEVER return
FORBIDDEN (403).

#### Scenario: Foreign id is indistinguishable from nonexistent id

- GIVEN a foreign post id F and a random nonexistent id N
- WHEN the caller sends `DELETE /posts/F` and `DELETE /posts/N`
- THEN both responses have identical status (404) and body shape

#### Scenario: No 403 leaks ownership

- GIVEN a caller deleting a post owned by another account
- WHEN the delete is attempted
- THEN the response is 404 NOT_FOUND, never 403 FORBIDDEN

### Requirement: Ownership gate precedes any mutation [MERGE-BLOCKING]

The ownership check SHALL execute BEFORE the delete AND BEFORE the
status/editability check, so a foreign delete never mutates the victim's post
regardless of its status (DRAFT, FAILED, or CANCELLED).

#### Scenario: Foreign deletable-status post is never mutated

- GIVEN post P owned by account B with status DRAFT, FAILED, or CANCELLED
- WHEN a caller in account A sends `DELETE /posts/P`
- THEN the ownership check fails first and P is neither deleted nor mutated
- AND P still exists after the request

### Requirement: Account derived from authenticated principal

The accountId used for the ownership gate SHALL originate from the authenticated
principal (`request.customerUser.accountId`, bound by `requireClientAuth`) and
SHALL NEVER be taken from a route, query, or body parameter.

#### Scenario: Caller cannot override account via input

- GIVEN an authenticated caller whose principal is bound to account A
- WHEN the request supplies any account-like route/query/body parameter
- THEN the gate uses the principal's account A and ignores the supplied value

### Requirement: Caller context is explicit and required

`DeletePostUseCase` SHALL take a REQUIRED caller-context discriminated union —
`{ type: "customer", accountId }` or `{ type: "system", source }` — NOT an
optional `callerAccountId?`. Ownership SHALL be enforced whenever the caller type
is `customer`; the gate SHALL be bypassed ONLY under an explicit
`{ type: "system", source }` context. Omitting the caller context SHALL be a
compile error, so no call site can obtain an ungated delete by forgetting a
parameter. (This deliberately exceeds — and does NOT mirror — the sibling
Update/Archive/HardDelete/Duplicate pattern, whose optional `callerAccountId?`
fails open; migrating the siblings to this shape is a Slice-6 follow-up.)

The internal CQRS/saga path is the ONLY non-customer dispatcher and is provably
system-only today: the sole production constructor of a `post.delete` command is
the PostPublishingSaga compensation, whose target is the post the saga itself
created (a caller-supplied preexisting post is never deleted), and the CQRS
command surface (`CQRSIntegration`) is unmounted dead code (never instantiated).
Its structural closure at the DB layer lands with the Post guard (Slice 8).

#### Scenario: Customer route builds a customer caller context

- GIVEN the `DELETE /posts/:id` route under `requireClientAuth`
- WHEN the handler invokes `DeletePostUseCase`
- THEN it passes `{ type: "customer", accountId: request.customerUser.accountId }`
- AND ownership is enforced against stored ownership

#### Scenario: System bypass is explicit and auditable

- GIVEN the saga compensation path invoking `DeletePostUseCase`
- WHEN it deletes the post the saga itself created
- THEN it passes an explicit `{ type: "system", source: "..." }` context
- AND no customer-controlled input can select the system variant (omitting the
  context is a compile error, not a silent ungated delete)

<!-- Read surfaces added by change `post-read-ownership-gate` (archived 2026-07-17).
     Ownership is the stored transitive relation `post.project.accountId == caller.accountId`;
     the caller account is server-derived from the authenticated session, never client input.
     Enforced inside the scoped read query (no separate existence lookup) so foreign rows never
     match: single-gets → EntityNotFoundError → NOT_FOUND; lists → empty page (200 + []). -->

### Requirement: Ownership-scoped single-post read [MERGE-BLOCKING]

`GET /posts/:id` — both the plain read and the thread-expanded read — SHALL return
a post ONLY when the post belongs to the caller's account, where ownership is the
stored transitive relation `post.project.accountId == caller.accountId`. If the post
is owned by another account, or does not exist, the operation SHALL resolve to
NOT_FOUND — the post and its thread SHALL NOT be returned and their existence SHALL
NOT be revealed.

#### Scenario: Owner reads own post

- GIVEN an authenticated caller in account A owning post P
- WHEN the caller sends `GET /posts/P` (with or without thread expansion)
- THEN the post (and its thread, if requested) is returned with 200

#### Scenario: Foreign post read resolves to NOT_FOUND

- GIVEN an authenticated caller in account A and post P owned by account B
- WHEN the caller sends `GET /posts/P` (plain or thread)
- THEN the response is NOT_FOUND (404) and no post or thread data is returned
- AND P remains readable to account B

### Requirement: Anti-enumeration read parity [MERGE-BLOCKING]

A foreign-account post id SHALL produce the SAME NOT_FOUND (404) response as a
genuinely nonexistent id — identical status code and body shape. No signal (distinct
status, message, body field, error code, or FORBIDDEN 403) SHALL reveal that the id
exists but belongs to another account. This mirrors Slice 0's DELETE gate. The gate
SHOULD be enforced inside the scoped read query rather than a separate existence
lookup, so no observable difference distinguishes the two ids.

#### Scenario: Foreign id is indistinguishable from nonexistent id

- GIVEN a foreign post id F and a random nonexistent id N
- WHEN the caller sends `GET /posts/F` and `GET /posts/N`
- THEN both responses have identical status (404) and body shape
- AND neither returns 403 FORBIDDEN

### Requirement: Ownership-scoped by-project list [MERGE-BLOCKING]

`GET /posts?projectId=<id>` SHALL return posts ONLY when the caller owns the supplied
project (`project.accountId == caller.accountId`). A client-supplied `projectId`
belonging to another account SHALL yield an empty result or NOT_FOUND — NEVER that
account's posts. Ownership SHALL be verified server-side; a `projectId` being
client-supplied SHALL NOT by itself grant access to it.

#### Scenario: Foreign projectId returns no foreign posts

- GIVEN a caller in account A and project Q owned by account B
- WHEN the caller sends `GET /posts?projectId=Q`
- THEN the response is empty or NOT_FOUND and contains no posts from account B

#### Scenario: Owner lists own project's posts

- GIVEN a caller in account A owning project Q
- WHEN the caller sends `GET /posts?projectId=Q`
- THEN only account A's posts in Q are returned with 200

### Requirement: Global unfiltered list is not cross-tenant reachable [MERGE-BLOCKING]

`GET /posts` with no `projectId` SHALL NOT be reachable by a customer in any way that
returns posts outside the caller's account. A conforming implementation MAY satisfy
this by scoping the list to the caller's account (returning only own posts) OR by
restricting the unfiltered global list to admin principals (returning 403 to
customers). In neither case SHALL a customer receive posts belonging to another
account.

#### Scenario: Customer global list never leaks other accounts

- GIVEN an authenticated customer in account A while account B also has posts
- WHEN the caller sends `GET /posts` with no `projectId`
- THEN the response either contains only account A's posts, or is 403 FORBIDDEN
- AND it NEVER contains any post owned by account B

### Requirement: Read account derived from authenticated principal

The account used for every read ownership gate SHALL originate from the authenticated
principal (`request.customerUser.accountId`, bound by `requireClientAuth`) and SHALL
NEVER be taken from a route, query, or body parameter — including a client-supplied
`projectId`, which is validated for ownership, not trusted as a scope selector.

#### Scenario: Caller cannot widen scope via input

- GIVEN an authenticated caller whose principal is bound to account A
- WHEN the request supplies any account-like parameter, or a `projectId` for account B
- THEN the gate uses account A and returns no account B data
