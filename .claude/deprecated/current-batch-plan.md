preflight:
batch_id: PR-45.A.1-slack-teams-httpclientport
scope_summary: Migrar SlackNotifierAdapter + TeamsNotifierAdapter a HttpClientPort (PR-45 Fase 2). DI wire en setupExternalNotificationUseCases.ts. Crear tests (no existían). Aprobado via Plan Mode.
scope_loc_estimate: 280
estimated_duration_min: 90

canon_index_checked: yes
canon_research_completed_at: 2026-05-05T05:46:37Z
canon_entries_consumed: - "HttpClientPort 5-verbs (PR-45.0 commit 3a30980 — extendido + wired DI)" - "InvariantViolationError pattern existente en adapters notification" - "Result<void, DomainError> pattern existente"

ambiguities_detected: []

files_to_modify: - apps/api/src/infrastructure/adapters/SlackNotifierAdapter.ts - apps/api/src/infrastructure/adapters/TeamsNotifierAdapter.ts - apps/api/src/infrastructure/container/setupExternalNotificationUseCases.ts - docs/audits/POST_REMEDIATION_BACKLOG.md
files_to_create: - apps/api/tests/unit/infrastructure/adapters/SlackNotifierAdapter.test.ts - apps/api/tests/unit/infrastructure/adapters/TeamsNotifierAdapter.test.ts

acceptance_criteria: - "Slack + Teams adapters reciben HttpClientPort por constructor" - "fetch() directo eliminado en ambos (grep verifica 0 hits post-fix)" - "DI wire en setupExternalNotificationUseCases.ts pasa HttpClientPort a los 2 adapters" - "Tests nuevos cubren: success path + http>=400 + TIMEOUT/NETWORK/BAD_RESPONSE error mapping" - "Typecheck + lint + tests verdes" - "Backlog PR-45.A.1 ✅ FIXED"

rollback_plan: "git checkout -- apps/api/src/infrastructure/adapters/{Slack,Teams}NotifierAdapter.ts apps/api/src/infrastructure/container/setupExternalNotificationUseCases.ts docs/audits/POST_REMEDIATION_BACKLOG.md && rm apps/api/tests/unit/infrastructure/adapters/{Slack,Teams}NotifierAdapter.test.ts"

pre_delete_gate:
questions: - "Q1: n/a (no eliminación)" - "Q2: n/a" - "Q3: n/a"
decision_rule: "n/a — refactor + add tests, sin eliminación"
