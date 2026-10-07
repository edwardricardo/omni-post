---
feature: <slug> # kebab-case, equal to the file name without .md
owner: <team or person> # who answers for this document
status: live # live | partial | planned
verified:
  sha: <40-hex sha> # the commit of main the text was checked against
  date: <YYYY-MM-DD> # the day of that check
  by: <handle> # a GitHub handle or a role
paths:
  - <path> # repository-relative, a directory ends with /, no globs
covers:
  - <capability> # one product capability per item, in the user's words
legal:
  - <reference> # register:<N> for a REGISTER.md section, <inventory>:<row key> for a row; or legal: none
---

<!-- Copy this file to docs/support/<feature>.md and replace every <placeholder> and guidance line. docs/support/README.md says how a document is written and checked. -->

# <Feature name>

## What it does for the user

Two to five sentences in product language: what the user achieves, which role uses it (customer user or admin) and from which screen.

## How it works end to end

The path by code location, route plugin → use case or query → tables written and read → queues and jobs → provider adapters → what the user sees, citing paths and symbols, never line numbers.

## Where to look when a ticket opens

Under fixed bold labels: **Identify the request** (correlation id, log fields), **Metrics** (series names), **Admin screens** (page and filter), **Database** (table, state columns, the query that answers the ticket), **Queues and jobs** (queue, job, failed reason, retries) and **Provider side** (the error codes the adapter maps).

## Known failure modes

A table with one row per mode, `The ticket looks like | Usually because | Check | Fix or escalate`, linking the runbook when an alert covers the mode and naming the defect id when the mode is an open defect.

## Configuration

Env keys by name (read through the typed `env` modules), platform credentials set in Admin, plan limits and feature flags: what each changes, who can change it and where.

## Data and privacy

The personal data the feature stores or sends (fields, tables, third parties) and its retention, linking the legal register entries named in `legal` rather than restating them.

## Related documents

The spec in `docs/features/`, the reference in `docs/api/`, runbooks, ADRs and Master Plan rows; write None when there are none, and keep the heading.

## Verification

Last verified against main <sha> on <date> by <who>
