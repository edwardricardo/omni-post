# Legal facts register

`docs/legal/` records facts about how OmniPost handles data — what it stores, what it sets in the browser, what it sends and to whom — so that the terms of service, the privacy notice and the data processing agreement are written from facts kept with the code, not reconstructed from it. It holds no legal text and no legal advice.

| Path                              | What it is                                                                                       | Who writes it                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------- |
| [`REGISTER.md`](REGISTER.md)      | The record of processing activities, one section per element of GDPR art. 30(1), with its status | By hand: facts and links only     |
| `inventories/<name>.generated.md` | The generated snapshot of one surface of the code                                                | A generator; never edited by hand |
| `classification/<name>.json`      | The curated classification of every row of that inventory                                        | By hand: one entry per row        |

## When `pnpm check:legal` fails

`pnpm check:legal` regenerates every inventory in memory and compares it with the committed page. It exits 1 when a page is stale or missing, a candidate has no classification entry, an entry names a row that no longer exists, an OAuth scope's declared `sources` differ from the scan, a service lacks one of its fields, a manual service names a declared package, a `pending` count differs from the file's `pendingBaseline`, or a scan read nothing.

1. Run `pnpm legal:inventory`: it rewrites every page and prints each problem as `legal-inventory <name>: <problem>`.
2. Classify each new row in `classification/<name>.json`: its status, the fields the generator requires (category and subject for a personal field, lifetime for a cookie, sources and grants for an OAuth scope, vendor, purpose, envToggle, dataSent and productionPath for a service) and a note stating what the code does with it.
3. Run `pnpm check:legal` again until every page reports `is current`, and commit the classification and the page with the change that moved them.

**Not applicable is a row, never a sentence.** A touched surface that holds nothing legally relevant is declared in its classification file — `not-personal` for a schema field, `library` for a dependency — with a note that says why. A pull request description or a label is never read by any check.

## Inventories

The current figures are each page's Summary table.

| Inventory             | Generator                                                                | Classification                                                        | Page                                                 | Covers                                                                                                                                                 | Statuses                                                       |
| --------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `personal-data`       | [`personal-data.mjs`](../../scripts/legal/personal-data.mjs)             | [`personal-data.json`](classification/personal-data.json)             | [page](inventories/personal-data.generated.md)       | Fields of `infra/prisma/schema.prisma` whose name may hold personal data                                                                               | `personal`, `not-personal`, `pending`                          |
| `cookies-and-storage` | [`cookies-and-storage.mjs`](../../scripts/legal/cookies-and-storage.mjs) | [`cookies-and-storage.json`](classification/cookies-and-storage.json) | [page](inventories/cookies-and-storage.generated.md) | Cookies and `localStorage` / `sessionStorage` keys of the API, both portals and `packages/ui`                                                          | `essential`, `functional`, `analytics`, `marketing`, `pending` |
| `oauth-scopes`        | [`oauth-scopes.mjs`](../../scripts/legal/oauth-scopes.mjs)               | [`oauth-scopes.json`](classification/oauth-scopes.json)               | [page](inventories/oauth-scopes.generated.md)        | OAuth scopes each provider connection requests or declares: the connect flows, the adapters, the shared provider metadata and the CRM authorize routes | `required`, `optional`, `unused`, `pending`                    |
| `subprocessors`       | [`subprocessors.mjs`](../../scripts/legal/subprocessors.mjs)             | [`subprocessors.json`](classification/subprocessors.json)             | [page](inventories/subprocessors.generated.md)       | Direct dependencies of the root and every workspace manifest, and the services the code reaches by `fetch`                                             | `service`, `library`, `pending`                                |

After the generators, the check becomes a gate: a fitness check and a battery step that run `pnpm check:legal`, so a pull request that adds a personal field, a dependency, a scope or a cookie stays red until its row is classified. A later unit adds a `## Legal impact` section to the ADR and specification templates; ADR-0034 and ADR-0035 already carry one.

## Pending decisions

Every qualitative item is a decision for Edward, taken in short sessions when it falls due. Until then its place in [`REGISTER.md`](REGISTER.md) stays empty with the status `pending decision (owner: Edward)`.

| Decision                                                   | Where it lands                                     |
| ---------------------------------------------------------- | -------------------------------------------------- |
| Identity of the controller and its role per processing     | Register, section 1                                |
| Purposes of processing                                     | Register, section 2 (LEGAL-1 inventories them)     |
| Legal basis per purpose                                    | Register, section 3                                |
| Transfers to third countries and their safeguards          | Register, section 7                                |
| Retention period per data class                            | Register, section 8                                |
| Consent policy and the fate of `ConsentRecord`             | Register, section 12 (LEGAL-5)                     |
| Frameworks beyond the GDPR; final language of the register | The whole register                                 |
| The `pending` rows of each inventory                       | Its classification file, held by `pendingBaseline` |

## Retro-documentation ledger

The facts of work closed before the gate existed are collected once, through the retro-documentation ledger in [Master Plan](../product/MASTER_PLAN_ES.md) §5.10, shared with the support documentation of §5.15. It has one row per closed item, and its `Legal`, `Soporte` and `Lote` columns start empty.

A retro batch takes ledger rows in order of exposure (credentials, OAuth, billing, mention and analytics ingestion, AI subprocessors), at most 400 lines of evidence. It reads each item once, writes its legal facts here and its support page under `docs/support/`, and marks the row with the batch's pull request number. An item with nothing to record is marked not applicable, with its reason, in the batch's pull request. Work closed after the gate documents itself in its own pull request, because the gate fails until it does.

## Conventions

- **English.** Everything under `docs/legal/` is written in English.
- **Generated pages are never edited by hand.** `pnpm legal:inventory` writes them and `pnpm check:legal` fails on any difference.
- **No timestamps.** A page carries the sha256 prefix of its classification file and of the facts its generator extracted, never of a source file (`personal-data` and `oauth-scopes` hash their normalized scan result, and `cookies-and-storage` lists every site it found on the page itself), so a page changes only when a fact it records changes, the commit that regenerated it is its provenance, and a clean checkout reproduces it byte for byte.
- **Notes are facts.** A classification note says what the code holds, sets or sends and where; it never argues a legal basis, a lawfulness or a recommendation.
- **Link, do not restate.** The register points at the document that is the source of truth (the [retention calendar](../compliance/RETENTION_CALENDAR.md), an ADR, a canon) instead of copying it.

## How to extend: add a generator

1. Write `scripts/legal/<name>.mjs` exporting `generator = { name, generate }` on [`lib/inventory.mjs`](../../scripts/legal/lib/inventory.mjs), and on [`lib/source-scan.mjs`](../../scripts/legal/lib/source-scan.mjs) when it scans source files; a scan that reads nothing must return a scope error.
2. Register it in `GENERATORS` in [`scripts/legal/run.mjs`](../../scripts/legal/run.mjs).
3. Add `classification/<name>.json` (`generator`, `pendingBaseline`, `entries`) and write the page with `pnpm legal:inventory`.
4. Add its suite under `apps/api/tests/unit/scripts/`, including the red paths: a planted row changes the page, and `--check` exits 1 on a stale page, an unclassified row and a `pending` count over its baseline.
5. Add the script to the root `entry` list of [`knip.json`](../../knip.json).
6. Move M1 in [`TESTING_REFOUNDATION.md`](../development/TESTING_REFOUNDATION.md): every new test file moves it.
7. Add its row to the inventories table above, and set its section of [`REGISTER.md`](REGISTER.md) to `generated` with a link to the page.
