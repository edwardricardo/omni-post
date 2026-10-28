# Governance

Two roles decide in this repository. Every other artifact names a role, never a person; this page is
the one place where each role resolves to the person who holds it, by design
([ADR-0040](technical/ADR-0040-artifact-language-and-role-attribution.md)).

## The roles

| Role          | Decides                       | For example                                                      |
| ------------- | ----------------------------- | ---------------------------------------------------------------- |
| Product Owner | What the product does         | Priorities, the route, product decisions, legal decisions        |
| Maintainer    | How it is built and delivered | Architecture, merges, releases, the grant authority of the hooks |

- Stakeholders are not decision-makers. An ADR lists them in MADR's `consulted` (two-way
  communication) and `informed` (one-way); its `decision-makers` field names a role.
- A document's `**Owner:**` field names a role; the canon documents name `Maintainers`.
- The data controller of the processing register (GDPR art. 30) is the legal entity, not a
  repository role.

## Who holds each role

| Role          | Holder           | GitHub          | Since      | Until |
| ------------- | ---------------- | --------------- | ---------- | ----- |
| Product Owner | Edward Velasquez | `edwardricardo` | 2026-03-08 | —     |
| Maintainer    | Edward Velasquez | `edwardricardo` | 2026-03-08 | —     |

One person holds both roles, since the repository's first commit (`5603d6be`, 2026-03-08). The table
keeps every holder a role has had: a role named in an ADR or any other artifact resolves to the row
whose dates contain that artifact's date.

## Where decisions are recorded

- **ADRs** under [`technical/`](technical/) record architecture and convention decisions. Their
  `decision-makers` field names the role that decided (ADR-0001 holds the template).
- **Pull request approvals** record the decision to merge each change.
- **Git** keeps the commit author of every change.

## The hooks' grant issuer

The Maintainer holds the grant authority of the hooks. Only the Maintainer issues, extends and
revokes grants for sensitive operations, with `.claude/bin/omnipost-allow` from their own terminal;
no session can ([CLAUDE.md](../CLAUDE.md) §Bypass via authorization token).

- The grant files live under `.claude/.allowed/`, which git ignores, and a grant file is deleted
  once no grant remains in it.
- Every write of a grant file stamps `authorized_by` with the value of `GRANT_ISSUER` in
  `.claude/hooks-py/_common.py` (`_store_grants`), today `"edward"`. It names the holder, not the
  role.
- Nothing reads `authorized_by` back, and `.claude/hooks.log` does not record the issuer, so the
  field is a label on a local file, not an audit record.

## How a role changes hands

1. A pull request edits the holder table above: it sets the outgoing holder's `Until` date and adds
   a row for the incoming holder, with its `Since` date.
2. The outgoing holder approves it. The change takes effect when it merges.
3. A change of Maintainer also changes the grant issuer, so the same pull request sets
   `GRANT_ISSUER` to the incoming holder's identity. That edit touches `.claude/hooks-py/**`, a
   sensitive path, so the pull request needs a `sensitive-edit` grant, which the outgoing holder
   issues while still the Maintainer.
