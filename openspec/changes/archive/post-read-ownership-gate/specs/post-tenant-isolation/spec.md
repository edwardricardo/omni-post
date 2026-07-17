# Delta for post-tenant-isolation

> Change: `post-read-ownership-gate`. Extends the capability from mutation (DELETE,
> Slice 0) to the four customer-facing post **read** surfaces, closing the LIVE
> cross-tenant read IDOR (CWE-639). Ownership is the stored transitive relation
> `post.project.accountId == caller.accountId`; the caller account is server-derived
> from the authenticated session, never client-supplied. RFC 2119 keywords are
> normative. MERGE-BLOCKING requirements are proven by a real-DB two-tenant
> INTEGRATION test through HTTP — a mocked unit test cannot detect a missing
> ownership filter. The global-list requirement is written design-agnostic so BOTH
> candidate designs (scope-by-account or admin-only) satisfy it.

## ADDED Requirements

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
