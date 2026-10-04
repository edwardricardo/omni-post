# ADR-0031: Domain vocabulary — Organization, Workspace, Member, Channel

- **Status**: Accepted
- **Date**: 2026-10-04
- **Deciders**: Edward
- **Supersedes**: —
- **Superseded by**: —
- **Related**: [ADR-0030](ADR-0030-pricing-model.md) (the pricing model written in this vocabulary)

## Context

While the pricing model of [ADR-0030](ADR-0030-pricing-model.md) was being decided on 2026-10-04,
one question could not be answered from the code: what the "account" in the pricing multiplier
counts. Measured on `main` at `bad953f2`, the word means three different things:

- **The customer who signs up and pays.** The `Account` model (`infra/prisma/schema.prisma:12`) and
  the `accountId` column that every tenant-scoped table carries; tenant isolation is keyed on it,
  from the `TENANT_SCOPED_MODELS` set of `infra/prisma/src/extensions/tenantGuard.ts` to the
  row-level-security setting `app.account_id`.
- **A connected social account.** The client's pricing slider is labelled "Social accounts", from 1
  to 20 (`apps/client/app/[locale]/dashboard/settings/billing/components/CustomPlanTab.tsx:82-91`).
  In the schema this is a `Channel`.
- **An agency's client.** The investor document's "multi-account pricing uses a multiplier that
  decreases with scale, incentivizing agencies to consolidate all clients on the platform"
  (`docs/product/INVESTOR_EN.md:261`, §Provider-Based Pricing). In the schema this is closest to a
  `Project`.

`AccountPricingTier`, the multiplier itself, could mean any of them, and the read-only explorer that
mapped the plan model listed it as undetermined (research
[Report 5](../reports/research-2026-10-04-billing.md#report-5-plan-model-map)).

The other words drift too. Edward calls a project an "equipo" or a "subcuenta": a space per client
or brand, with its own members and platforms. The code's `packages/core/team` module, however,
manages the account's users (`InviteTeamMemberUseCase`, `RemoveTeamMemberUseCase`,
`UpdateTeamMemberRoleUseCase`), so "team" in the code is not a project. A person is a
`CustomerUser` (`schema.prisma:342`), and a person's assignment to a project is a `ProjectMember`
(`schema.prisma:399`).

## Decision

1. **One ubiquitous language across code, database, UI and documentation** (2026-10-04, option B):

   | Term             | Meaning                                                                                                                                      |
   | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
   | **Organization** | The customer who signs up and pays. It owns the subscription, the workspaces and the members                                                 |
   | **Workspace**    | A space per client or brand inside an organization, with its own members and channels. Edward's "equipo" or "subcuenta"                      |
   | **Member**       | A person who belongs to an organization and is assigned to one or more of its workspaces                                                     |
   | **Channel**      | One connected social account on a platform. It belongs to one workspace, and it is the unit of price ([ADR-0030](ADR-0030-pricing-model.md)) |

   The "account" of the pricing multiplier is a **workspace**.

2. **Documentation and the pricing model use these terms from now on.** [ADR-0030](ADR-0030-pricing-model.md)
   and [billing-gateways.md](../features/billing-gateways.md) are written in them. Until the rename
   lands, documents that name code use today's identifiers through the mapping below.
3. **The rename of the code and the database is its own workstream.** It changes the Prisma models
   and columns with a migration, and every file that uses them. It carries the tenant-isolation
   machinery keyed on `accountId` in the same change.
4. **"Team" never maps to Workspace.** The existing `packages/core/team` module manages an
   organization's members, so its name follows **Member**, not Workspace.

### Mapping to today's code names

| Term                   | Today in code                                                                                                     | Today in the UI and documents                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Organization           | `Account` model and `accountId` columns; `AccountSubscription`; the `app.account_id` row-level-security setting   | "account"                                     |
| Workspace              | `Project` model and `projectId` columns; `AccountPricingTier` is the workspace volume tier                        | "project"; the investor document's "accounts" |
| Member                 | `CustomerUser` (the person) plus `ProjectMember` (the assignment to a workspace), managed by `packages/core/team` | "team member", "user"                         |
| Channel                | `Channel` (with `projectId` and `provider`); `ProviderPricingTier` becomes the per-channel tier                   | "channel"; the client's "Social accounts"     |
| Platform (not renamed) | The `Provider` enum, 11 values (`infra/prisma/schema.prisma:1174`, `packages/shared/src/types.ts:197-209`)        | "provider", "network"                         |

"Platform" is how the pricing documents name a social network; it is listed for reading the code,
and is not part of the four terms Edward decided.

## Rationale

1. **A word with three meanings cannot carry a price.** The multiplier's unit was unknowable from
   the code; a pricing model written in that word would inherit the ambiguity.
2. **One name per concept in every layer** is what Domain-Driven Design calls a ubiquitous language:
   the word a customer reads on the bill is the word in the code that computes it.
3. **The new words match how customers describe the product.** An agency has an organization and a
   workspace per client; "project" and "account" do not say that.
4. **Keeping the rename separate keeps it reviewable.** It touches tenant isolation, which the
   Security canon allows no exception for, and it should not ride inside a billing change.

## Alternatives Considered

- **Keep today's names** (`Account`, `Project`). Rejected: "account" keeps its three meanings.
- **New names in the UI and documents only, today's names in the code for good.** Not chosen: the
  decision is one language across code, database, UI and documents.
- **Rename inside the billing work.** Not chosen: the rename is large and touches tenant isolation;
  it is its own workstream.

## Consequences

**Positive**

- The pricing model has one meaning per word, and the bill can be read in the customer's words.
- "Team" stops competing with "workspace".

**Negative / costs**

- **The rename is large.** The decision record estimated 50 or more files; measured on `bad953f2`,
  `accountId` appears in 948 `.ts`, `.tsx` and `.prisma` files under `apps/`, `packages/` and
  `infra/` (generated code, builds and dependencies excluded), `projectId` in 594, `CustomerUser` in
  37 and `ProjectMember` in 6.
- **Tenant isolation is keyed on the old names.** `TENANT_SCOPED_MODELS`, the `app.account_id`
  setting (107 references in migrations), fitness checks #38, #39 and #40, and
  `docs/security/MULTI_TENANT_GUARDS.md` change with the rename, under the Security canon.
- **Until the rename lands, documents and code use different words** for the same thing, bridged by
  the mapping table.

## Open points

- **Names in code written before the rename.** Whether new code uses today's names, so the code
  keeps one name per concept until the rename, or the new terms from now on, is not decided.
- **The rename's plan**: the order of models, the migration strategy, and how the row-level-security
  setting and the fitness checks move without a window where tenant isolation is weaker.

## Revisit if

- A new concept appears that none of the four terms covers, for example a level above the
  organization.

## Risks and Mitigations

| Risk                                                                    | Mitigation                                                                                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A document mixes the old and new names and is read wrongly              | Documents use the new terms and name code through the mapping table                                                            |
| The rename weakens tenant isolation for a moment                        | The rename carries `TENANT_SCOPED_MODELS`, the row-level-security setting and fitness #38–#40 in the same change; no exception |
| "Team" is renamed to "Workspace" by analogy with Edward's word "equipo" | Point 4: the `team` module follows Member                                                                                      |

## References

- [ADR-0030](ADR-0030-pricing-model.md) — the pricing model.
- Research: [research-2026-10-04-billing.md](../reports/research-2026-10-04-billing.md), Report 5
  (the plan model, "what an account means in the multiplier").
- Code: `infra/prisma/schema.prisma` (`model Account`, `model Project`, `model CustomerUser`,
  `model ProjectMember`, `model Channel`, `enum Provider`);
  `infra/prisma/src/extensions/tenantGuard.ts`; `packages/core/team/src/`.
- Canon: `docs/security/SECURITY_CANON.md` §Multi-Tenant Isolation;
  `docs/security/MULTI_TENANT_GUARDS.md`.
- Evans, _Domain-Driven Design_ (2003), ch. 2, "Communication and the Use of Language".
