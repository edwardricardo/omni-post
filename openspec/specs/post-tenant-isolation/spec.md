# Post Tenant Isolation — Specification

> Living specification for the **post-tenant-isolation** capability: caller-account
> ownership gating on customer-facing post mutation surfaces. Established by change
> `post-delete-ownership-gate` (Slice 0 of the `project-scoped-tenant-guard` workstream),
> archived 2026-07-14. Closes the LIVE cross-tenant IDOR (CWE-639) on `DELETE /posts/:id`
> by gating deletion on caller-account ownership via a REQUIRED caller-context union —
> reaching parity with the Update/Archive/HardDelete/Duplicate routes, but with a
> compiler-enforced (fail-closed) context rather than their optional `callerAccountId?`.
>
> RFC 2119 keywords (MUST / SHALL / SHOULD / MAY) are normative. Each requirement carries
> Given/When/Then acceptance scenarios.
>
> Verification method: the three MERGE-BLOCKING requirements are proven by a real-DB
> two-tenant INTEGRATION test through HTTP (`apps/api/tests/integration/postDeleteOwnership.test.ts`).
> A mocked unit test cannot detect a missing ownership filter.
>
> **Scope note.** This capability currently covers `DELETE /posts/:id` only. The sibling
> Update/Archive/HardDelete/Duplicate routes still use the fail-open optional
> `callerAccountId?` pattern (pre-existing, out of scope for this change) — migrating them
> to the required `caller` union is a tracked follow-up (Slice-6 audit of
> `project-scoped-tenant-guard`). This capability is superseded at the data layer by the
> structural Post guard (Slice 8) of the same workstream.

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
