# The plan

One plan for the whole product, ordered by dependency: what makes the rest possible goes first. It says, for each
application, what is built, in which order, and when it is finished.

Every status in it comes from reading the code at `main` `a72e0525` on 2026-11-10; nothing was run. A feature's
record is read again against the code when the feature opens.

This plan replaces [MASTER_PLAN.md](MASTER_PLAN.md), the testing refoundation tracker and its fixed plan. The Master
Plan stays in the tree as an archive that takes no new row; the tracker
([TESTING_REFOUNDATION.md](https://github.com/edwardricardo/omni-post/blob/a72e052577f4c74903de2e7b48487daa85658c7f/docs/development/TESTING_REFOUNDATION.md))
and its fixed plan
([TESTING_REFOUNDATION_PLAN.md](https://github.com/edwardricardo/omni-post/blob/a72e052577f4c74903de2e7b48487daa85658c7f/docs/development/TESTING_REFOUNDATION_PLAN.md))
left the tree on 2026-11-10 and are read at those permanent links. Since 2026-11-10 the rules of `CLAUDE.md` send
cross-cutting work and out-of-scope findings here ([ADR-0044](../technical/ADR-0044-feature-ordered-plan.md)).

## How it is organised

| File                                           | What it holds                                                                    |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| [plan/chain.md](plan/chain.md)                 | Features F-01 to F-18, full records                                              |
| [plan/areas.md](plan/areas.md)                 | Nine areas outside the chain, one line per feature until their turn              |
| [plan/cross-cutting.md](plan/cross-cutting.md) | Work of no feature: CI, gates, dependencies, the test system, the security slice |
| [plan/off-the-map.md](plan/off-the-map.md)     | Deletion candidates, and old rows the code already shows as done                 |
| [plan/parking.md](plan/parking.md)             | Ideas with no slice                                                              |

## Rules

- A feature is something a person does. A slice is one thin feature in full: its steps go bottom-up, one
  application at a time, and it closes when a proof that crosses the seam between applications passes and its
  four documentation lines (legal, support, developers, deployment) are answered. "Not applicable", with its
  reason, is an answer.
- A proof starts from the state the earlier features leave. It writes no row directly.
- Order: dependency first. Among features that do not depend on each other: on the main journey, then the one
  that unblocks more, then the one closest to done. A tie is the Product Owner's call.
- One slice at a time by default. The order is revisited only when a feature closes; what appears in between
  goes to [parking](plan/parking.md).
- An old item is attached to its feature first; its viability is decided when the feature opens.
- A finding a task makes outside its scope is attached in the same pull request, with a descriptive upper-case id,
  `path:line` evidence and the task that found it: to its feature, to [cross-cutting](plan/cross-cutting.md) when it
  belongs to no feature, to [parking](plan/parking.md) when it is an idea.
- The accepted decision records under `docs/technical/` are cited, never reopened.
- A feature outside the chain has one line until its turn comes; it gets its full record when it is scheduled.
- Vocabulary (ADR-0031): Organization, Workspace, Member, Channel, Platform.

## The chain

| #    | Feature                                                                           | Today                                      | Old rows attached |
| ---- | --------------------------------------------------------------------------------- | ------------------------------------------ | ----------------- |
| F-01 | The platform starts from an empty database                                        | WORKS                                      | 20                |
| F-02 | The first administrator comes to exist                                            | MISSING outside development                | 1                 |
| F-03 | An administrator signs in, stays signed in and signs out                          | WORKS from page to data                    | 15                |
| F-04 | An administrator recovers a password                                              | PARTIAL                                    | 5                 |
| F-05 | Administrators and their roles are managed                                        | WORKS through the users and security pages | 10                |
| F-06 | What an administrator configures takes effect                                     | PARTIAL                                    | 18                |
| F-07 | The price catalog decides what an Organization pays and gets                      | PARTIAL                                    | 11                |
| F-08 | An Organization comes to exist                                                    | WORKS for self-registration                | 2                 |
| F-09 | An administrator manages an Organization                                          | PARTIAL                                    | 10                |
| F-10 | A Member signs in, stays signed in and signs out                                  | WORKS from page to data                    | 5                 |
| F-11 | A Member recovers or changes a password                                           | PARTIAL                                    | 2                 |
| F-12 | The Organization has a Workspace (create, list, select)                           | PARTIAL                                    | 3                 |
| F-13 | A Channel is connected                                                            | WORKS                                      | 4                 |
| F-14 | A post is written and saved                                                       | PARTIAL                                    | 4                 |
| F-15 | A post is published now                                                           | PARTIAL                                    | 15                |
| F-16 | A post is scheduled and published later                                           | PARTIAL                                    | 2                 |
| F-17 | The result is visible                                                             | PARTIAL                                    | 1                 |
| F-18 | A Channel of a Platform that connects by authorization is connected and publishes | PARTIAL                                    | 2                 |

The order of the Platforms: Bluesky proves the chain first, then X (F-18), Facebook, YouTube, Instagram, TikTok,
and then, by rising complexity, Telegram, LinkedIn, Threads, Pinterest, Snapchat. YouTube is the first that
needs a media file, and takes video, so attaching a media file to a post comes before it.

## Areas outside the chain

| Area                                                         | Features | End to end today | Old rows attached | Refoundation units |
| ------------------------------------------------------------ | -------- | ---------------- | ----------------- | ------------------ |
| A-TEAM Members, roles and access                             | 24       | 1                | 21                | 0                  |
| A-BILLING An Organization's billing                          | 25       | 8                | 24                | 0                  |
| A-CONTENT Content tools                                      | 25       | 1                | 41                | 0                  |
| A-SCHEDULING Scheduling beyond one post                      | 15       | 2                | 15                | 0                  |
| A-AI AI assistance                                           | 17       | 6                | 26                | 1                  |
| A-ANALYTICS Analytics and reports beyond the basic dashboard | 20       | 1                | 22                | 0                  |
| A-ENGAGE Inbox and outside integrations                      | 22       | 2                | 33                | 0                  |
| A-PLATFORMS The ten Platforms other than Bluesky             | 33       | 0                | 32                | 1                  |
| A-ADMIN-OPS Administrator operations outside the base        | 26       | 6                | 32                | 0                  |
| Total                                                        | 207      | 27               | 246               |                    |

## Where the old plans went

| Source                     | Live items | Chain | Areas | Cross-cutting | Off the map | Already done |
| -------------------------- | ---------- | ----- | ----- | ------------- | ----------- | ------------ |
| Master Plan rows           | 562        | 130   | 246   | 141           | 33          | 12           |
| Testing refoundation units | 110        | 27    | 2     | 81            | 0           | 0            |

A live item is a row or a task its source does not mark closed. In the Master Plan that is every open or
partial checkbox row and every bullet row or task that carries no checkbox. Twenty-eight more of its lines are
notes of rows counted here (inputs, amendments, recorded choices); they are read through the row's link.

`MP:<n>` is line `<n>` of the Master Plan as it stood at commit `a72e0525`: [MASTER_PLAN.md at that commit](https://github.com/edwardricardo/omni-post/blob/a72e052577f4c74903de2e7b48487daa85658c7f/docs/product/MASTER_PLAN.md). Unit ids such as `6.E2` are units of the [testing refoundation tracker at that commit](https://github.com/edwardricardo/omni-post/blob/a72e052577f4c74903de2e7b48487daa85658c7f/docs/development/TESTING_REFOUNDATION.md).

## Order of the first slices

F-01, F-02, F-03, then the rest of the chain in order. The security slice of
[plan/cross-cutting.md](plan/cross-cutting.md) is scheduled by the Product Owner.

## Closure

When this plan closes, its state stays in git history; its decisions are the decision records under
`docs/technical/`; its rules are in `CLAUDE.md` and the canon documents; its lessons go to
`docs/development/FOUNDATION_PRACTICES.md`; its pending items move to the plan that replaces it.
