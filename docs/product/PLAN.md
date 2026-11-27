# The plan

OmniPost is, in the Product Owner's words of 2026-11-25, "a manager, creator and planner of content
for social networks". Its scope is everything the networks' APIs allow, by hand and with AI;
whatever the AI model or its provider, "the functionalities must be the same".

This is the one plan for the whole product and, in the Product Owner's words, "the non-negotiable
guide" of what the product is. It holds everything the product must do, ordered by dependency: for
each application, what is built, in which order, and when it is finished. Nothing is built that the
plan does not hold. What it does not contemplate is added to it first, with its
[level of need](#the-level-of-need) and its place.

Every status comes from reading the code, on the date its record gives, and at `main` `a72e0525` on 2026-11-10
where it gives none; nothing was run. A feature's record is read again against the code when the feature opens.

The rules of `CLAUDE.md` send
cross-cutting work and out-of-scope findings here ([ADR-0044](../technical/ADR-0044-feature-ordered-plan.md)).

## How it is organised

| File                                           | What it holds                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| [plan/chain.md](plan/chain.md)                 | Features F-01 to F-18, full records                                              |
| [plan/areas.md](plan/areas.md)                 | Nine areas outside the chain, one line per feature until their turn              |
| [plan/cross-cutting.md](plan/cross-cutting.md) | Work of no feature: CI, gates, dependencies, the test system, the security slice |
| [plan/off-the-map.md](plan/off-the-map.md)     | Rows the code already shows as done, to close                                    |
| [plan/parking.md](plan/parking.md)             | Ideas with no slice                                                              |

## How the plan is queried

The plan's files are read by one parser, run on demand and never stored: every feature and every item is a record
with its id, file, line, title, owner, who, today, need, dependencies, state, evidence, done condition, tags and
mentions. `pnpm plan:show <id>` prints one record, `pnpm plan:list` lists records by kind, file and any field (`--json`,
`--count`), and `pnpm plan:check` fails while a line of these files fits no shape or a part of their structure is
missing. A comparison, a copy, a count or a
filter over the plan runs on these records, and a reader is given the rows it must judge, never a whole file. The
parser is `scripts/plan/plan-records.mjs`. It walks each chain record with the walker the plan-closure check walks a
closed feature's record with, so a line that check refuses fails `pnpm plan:check` too.

## The level of need

Every feature carries one level, in its `Need` field or column.

| Level         | Meaning                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------ |
| Mandatory     | There is no product without it: its absence rules the product out.                         |
| Necessary     | Buyers ask for it. Its absence is a serious objection to buying.                           |
| Commonplace   | Every product has it. Doing it well wins no buyer; doing it badly loses one.               |
| Nice to have  | It adds real value: it keeps customers or raises what they pay. Its absence loses no sale. |
| Interesting   | It is emerging: a bet on a need not yet proven.                                            |
| Waste of time | It returns little or lies outside the product's focus. It does not enter the plan.         |

A rule gives the level. It counts how many of ten competing products offer the feature, in a
comparison of May 2026 repeated on 2026-11-26 with a source and a date for every finding:

- 8 or more: Mandatory when the feature is itself a core job, Commonplace when it is not. The core
  jobs are to sign in, connect an account, create content by hand and with AI, schedule, publish,
  measure results, work for several clients with approval, and pay.
- 5 to 7: Necessary, or Nice to have when nearly all sell it only as an add-on or in their
  enterprise plan.
- 3 or 4: Nice to have.
- 1 or 2: Interesting.
- None of the ten: Interesting or the lowest level, which the Product Owner decides feature by feature; where
  competitors offer a part of the need, the Product Owner may give the level of that part, as decided on
  2026-11-27.

A feature no product publishes, because it serves the operator, takes the first rule that fits:

1. An operator action that stands in for a customer feature takes that feature's level.
2. A legal obligation is Mandatory.
3. What the product cannot start without is Mandatory.
4. The rest is measured against the primary sources of its domain, such as a security standard.

A level is revised by repeating the comparison, never by hand: each product is looked up again,
each finding is recorded with its source and its date, and the rule gives the level. A changed
level goes to the Product Owner with its evidence. A feature added to the plan gets its level the
same way.

## Rules

- A feature is something a person does. A slice is one thin feature in full: its steps go bottom-up, one
  application at a time, and it closes when a proof that crosses the seam between applications passes and its
  four documentation lines (legal, support, developers, deployment) are answered. "Not applicable", with its
  reason, is an answer.
- A slice of the credential model ([ADR-0034](../technical/ADR-0034-credential-model.md)) is sized in lines of
  code, and one of more than about 400 is split: its row names in its done condition the chain of pull requests
  it splits into.
- A proof starts from the state the earlier features leave. It writes no row directly.
- Order: dependency first. Among features that do not depend on each other: on the main journey, then the one
  that unblocks more, then the one closest to done. A tie is the Product Owner's call.
- One slice at a time by default. The order is revisited only when a feature closes; what appears in between
  goes to [parking](plan/parking.md).
- Tracking: the chain table says where each feature stands. `State` is `open` until the feature's first pull
  request; `in progress` from that pull request, which also writes into the feature's record the cut the Product
  Owner confirmed (which attached items enter, which wait); and `closed` when its proof of done passes on `main`.
  The pull request that closes a slice updates, in the same change, the feature's row (`State`, and `Closed by`
  with its own number), the `Today` line of the feature's record and each item it resolved, whose text then
  starts with `Closed by #<n>`, or, when a decision and no pull request resolves it, with
  `Closed by decision of the <Product Owner|Maintainer> on <YYYY-MM-DD>: <the decision>`. Neither form has
  punctuation of its own: the rest of the item's text follows it. The merge commit and the date are read from
  the pull request.
- A verdict that an item is fixed counts only when the fixing commit is an ancestor of `main`
  (`git merge-base --is-ancestor <sha> main` exits 0). A report that verified a fix on another branch names that
  branch, and the item stays open until the fix reaches `main`.
- A closed feature holds no open item: every item of its record is closed in one of those two forms, and fitness #56
  (`pnpm check:plan-closure`, [ADR-0046](../technical/ADR-0046-feature-closes-with-no-open-item.md)) fails
  while one is not. A feature with an open item stays `in progress`. The areas outside the chain have no state,
  so the check judges a feature of an area once it joins the chain table.
- An item with code closes only when lint shows zero warnings, the typecheck, every fitness check and every test
  are green, the open items of its record are closed and the dependency-freshness walk of ADR-0018 has passed.
  Its evidence meets three rules: a fitness the item relies on was measured against the real sites it must catch,
  a test of an operation called atomic exercises the staggered interleaving, and the closing verdict names the ref
  it was verified against, which is `main`.
- An old item is attached to its feature first; its viability is decided when the feature opens.
- When a feature opens, its approach is checked against the current documentation of the vendor APIs, models and
  libraries it uses, which change fast. A new Platform adapter reuses the inbox and outbox, the Unit of Work
  and the scheduler, and opens no parallel path.
- A finding a task makes outside its scope is attached in the same pull request, with a descriptive upper-case id,
  `path:line` evidence and the task that found it: to its feature, to [cross-cutting](plan/cross-cutting.md) when it
  belongs to no feature, to [parking](plan/parking.md) when it is an idea.
- A finding recorded only on a branch that has not reached `main` is not a row of the plan. The pull request that
  lands such a branch attaches each open finding the branch records as a row, under a descriptive upper-case id, in
  the same change, and does not carry over the branch's own finding numbers. The branches
  `workstream/admin-scheduling-tenant-scope`, `workstream/ncor8-1b`, `workstream/ncor8-1c-10`, `tmp/order12-full`,
  `workstream/publish-job-id-contract`, `workstream/saga-failure-names-its-step` and
  `feature/post-publish-partial-failure` record such findings, numbered from SMELL-140.
- The accepted decision records under `docs/technical/` are cited, never reopened.
- A feature outside the chain has one line until its turn comes; it gets its full record when it is scheduled.
- An item's id never changes once given and is never given to another item. When an item splits, one part keeps
  the id and each other part takes a new one.
- Vocabulary (ADR-0031): Organization, Workspace, Member, Channel, Platform.

## What the product does not build

Unless the ideal customer profile changes, the product builds none of these and no item is opened for them:

- AI voiceover.
- A meme generator.
- Influencer marketing.
- Blog to video.
- Full ad management, a separate product category that includes campaign optimization recommendations and branded
  hashtag challenges.
- Shops and catalogues on the networks: catalogues, products, variants, collections, sections and product tagging
  in Facebook and Instagram Shops posts.
- Facebook events (create, edit, cancel, invite, manage attendance), revisited if Meta reopens page-event
  management to third-party applications with a documented create operation or permission.
- An in-application emergency mode of the limiter (decision PREG-8, recorded in AUTH-RL-1 of
  [cross-cutting](plan/cross-cutting.md)): the answer to an attack is at the edge with its runbook and, inside the
  application, the per-route switch and shadow launch of AUTH-RL-1. Revisited if the production edge has no attack
  mode or overload incidents appear that the edge does not see.

## The chain

| #    | Feature                                                                           | Today   | Items attached | State       | Closed by |
| ---- | --------------------------------------------------------------------------------- | ------- | -------------- | ----------- | --------- |
| F-01 | The platform starts from an empty database                                        | WORKS   | 20             | in progress | —         |
| F-02 | The first administrator comes to exist                                            | WORKS   | 1              | closed      | #980      |
| F-03 | An administrator signs in, stays signed in and signs out                          | PARTIAL | 15             | open        | —         |
| F-04 | An administrator recovers a password                                              | PARTIAL | 5              | open        | —         |
| F-05 | Administrators and their roles are managed                                        | PARTIAL | 10             | open        | —         |
| F-06 | What an administrator configures takes effect                                     | PARTIAL | 18             | open        | —         |
| F-07 | The price catalog decides what an Organization pays and gets                      | PARTIAL | 11             | open        | —         |
| F-08 | An Organization comes to exist                                                    | PARTIAL | 2              | open        | —         |
| F-09 | An administrator manages an Organization                                          | PARTIAL | 10             | open        | —         |
| F-10 | A Member signs in, stays signed in and signs out                                  | PARTIAL | 5              | open        | —         |
| F-11 | A Member recovers or changes a password                                           | PARTIAL | 2              | open        | —         |
| F-12 | The Organization has a Workspace (create, list, select)                           | PARTIAL | 3              | open        | —         |
| F-13 | A Channel is connected                                                            | PARTIAL | 4              | open        | —         |
| F-14 | A post is written and saved                                                       | PARTIAL | 5              | open        | —         |
| F-15 | A post is published now                                                           | PARTIAL | 17             | open        | —         |
| F-16 | A post is scheduled and published later                                           | PARTIAL | 3              | open        | —         |
| F-17 | The result is visible                                                             | PARTIAL | 1              | open        | —         |
| F-18 | A Channel of a Platform that connects by authorization is connected and publishes | PARTIAL | 2              | open        | —         |

The order of the Platforms: Bluesky proves the chain first, then X (F-18), Facebook, YouTube, Instagram, TikTok,
and then, by rising complexity, Telegram, LinkedIn, Threads, Pinterest, Snapchat. YouTube is the first that
needs a media file, and takes video, so attaching a media file to a post comes before it.

## Areas outside the chain

| Area                                                         | Features | End to end today | Items attached | Refoundation units |
| ------------------------------------------------------------ | -------- | ---------------- | -------------- | ------------------ |
| A-TEAM Members, roles and access                             | 26       | 1                | 21             | 0                  |
| A-BILLING An Organization's billing                          | 25       | 8                | 24             | 0                  |
| A-CONTENT Content tools                                      | 28       | 1                | 46             | 0                  |
| A-SCHEDULING Scheduling beyond one post                      | 16       | 2                | 20             | 0                  |
| A-AI AI assistance                                           | 21       | 6                | 32             | 1                  |
| A-ANALYTICS Analytics and reports beyond the basic dashboard | 22       | 1                | 24             | 0                  |
| A-ENGAGE Inbox and outside integrations                      | 30       | 2                | 39             | 0                  |
| A-PLATFORMS The ten Platforms other than Bluesky             | 34       | 0                | 33             | 1                  |
| A-ADMIN-OPS Administrator operations outside the base        | 26       | 6                | 39             | 0                  |
| Total                                                        | 228      | 27               | 278            |                    |

## Order of the first slices

F-01, F-02, F-03, then the rest of the chain in order. The security slice of
[plan/cross-cutting.md](plan/cross-cutting.md) is scheduled by the Product Owner.

## Closure

When this plan closes, its state stays in git history; its decisions are the decision records under
`docs/technical/`; its rules are in `CLAUDE.md` and the canon documents; its lessons go to
`docs/development/FOUNDATION_PRACTICES.md`; its pending items move to the plan that replaces it.
