# OmniPost — Post-Implementation Sprint Backlog

Generated: 2026-03-10
Review after: All 30 tasks in MASTER_DEVELOPMENT_PLAN.md are complete

This file contains every capability deferred from the master plan (Appendix A).
Review these as candidates for the next sprint once the platform reaches ~80% audit score.

---

## HOW TO USE THIS FILE

1. After completing Phase 11, run a fresh audit against `.audit/conceptual-audit.md`
2. Score each deferred item against current user demand, effort, and revenue impact
3. Assign each item a tier: **Must Have Next** / **Should Have** / **Nice to Have** / **Still Defer**
4. Create GitHub issues for items promoted to **Must Have Next**

---

## TECHNICAL DEBT — REVIEW REQUIRED

> **Identified: 2026-03-10** — During lint cleanup, variables silenced with `_` prefix were found in test files. These may represent incomplete test teardown (missing `afterEach` restore logic) rather than intentional no-ops.

| File                                                              | Variable               | Issue                                           | Action Required                                                                  |
| ----------------------------------------------------------------- | ---------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/providers/linkedin/tests/LinkedInAdapter.test.ts:728`   | `_originalGetComments` | Method overridden but never restored after test | Add `afterEach(() => { adapter.getComments = _originalGetComments; })`           |
| `packages/providers/linkedin/tests/LinkedInAdapter.test.ts:857`   | `_originalPostReply`   | Method overridden but never restored after test | Add `afterEach(() => { adapter.postReply = _originalPostReply; })`               |
| `packages/providers/linkedin/tests/LinkedInAdapter.test.ts:815`   | `_mockPostComment`     | Mock created in `beforeEach` but never asserted | Either assert it was called or remove if not needed                              |
| `packages/providers/pinterest/tests/PinterestAdapter.test.ts:758` | `_originalEnv`         | `process.env` snapshot taken but never restored | Add `afterEach(() => { process.env = _originalEnv; })` to prevent test pollution |

---

## DEFERRED CAPABILITIES

### UX / Composer

| ID      | Capability                        | Domain | Effort | Reason for Deferral                                                        | Review Notes |
| ------- | --------------------------------- | ------ | ------ | -------------------------------------------------------------------------- | ------------ |
| D-UX-01 | Emoji Picker in composer          | D1     | XS     | OS paste works fine for launch                                             |              |
| D-UX-02 | @Mention autocomplete             | D1     | M      | Requires Social Inbox contact data first; build after Phase 3 is live ≥30d |              |
| D-UX-03 | Canva / Adobe Express integration | D1     | L      | Partnership + API approval required; timeline unknown                      |              |

---

### Social Listening & Monitoring

| ID      | Capability                            | Domain | Effort | Reason for Deferral                                                                            | Review Notes |
| ------- | ------------------------------------- | ------ | ------ | ---------------------------------------------------------------------------------------------- | ------------ |
| D-SL-01 | Keyword monitoring (social listening) | D5     | XL     | Platform APIs rate-limited; not worth effort for launch. Requires dedicated ingestion pipeline |              |
| D-SL-02 | Sentiment analysis                    | D5     | L      | Blocked on D-SL-01 (Social Listening)                                                          |              |
| D-SL-03 | Competitor tracking                   | D5     | XL     | Requires external data source or paid license                                                  |              |

---

### Analytics

| ID      | Capability                        | Domain | Effort | Reason for Deferral                                                            | Review Notes |
| ------- | --------------------------------- | ------ | ------ | ------------------------------------------------------------------------------ | ------------ |
| D-AN-01 | Custom report builder (drag-drop) | D7     | L      | Static dashboards cover 90% of need; build when users request specific reports |              |
| D-AN-02 | Industry benchmark data           | D7     | L      | Requires large account base or paid data license                               |              |

---

### Team Collaboration

| ID      | Capability                            | Domain | Effort | Reason for Deferral                                                             | Review Notes |
| ------- | ------------------------------------- | ------ | ------ | ------------------------------------------------------------------------------- | ------------ |
| D-TC-01 | Multi-level approval chains           | D8     | M      | Enterprise-only; build after single-level approval is proven in production ≥60d |              |
| D-TC-02 | Task assignment                       | D8     | M      | Approval workflow covers team coordination needs for launch                     |              |
| D-TC-03 | Internal notes on inbox conversations | D4     | S      | New Prisma model needed; low urgency; add to Phase 3 backlog                    |              |

---

### Employee Advocacy

| ID      | Capability               | Domain | Effort | Reason for Deferral                                     | Review Notes |
| ------- | ------------------------ | ------ | ------ | ------------------------------------------------------- | ------------ |
| D-EA-01 | Employee advocacy module | D10    | XL     | Enterprise-only; not in target market for current phase |              |
| D-EA-02 | Advocacy leaderboard     | D10    | M      | Depends on D-EA-01                                      |              |
| D-EA-03 | Advocacy content library | D10    | M      | Depends on D-EA-01                                      |              |

---

### Social Advertising / Post Boosting

| ID      | Capability                                   | Domain | Effort | Reason for Deferral                                                                     | Review Notes |
| ------- | -------------------------------------------- | ------ | ------ | --------------------------------------------------------------------------------------- | ------------ |
| D-AD-01 | Post boosting (Meta Ads)                     | D11    | L      | Meta API approval timeline unknown; cannot plan around it                               |              |
| D-AD-02 | Full ad campaign management                  | D11    | XL     | Separate product category; out of scope for CMS                                         |              |
| D-AD-03 | TikTok Marketing API (createPromotedContent) | D11    | L      | TikTok Ads API requires advertiser account approval; stub replaced with NOT_IMPLEMENTED |              |

---

### Asset Library

| ID      | Capability                       | Domain | Effort | Reason for Deferral               | Review Notes |
| ------- | -------------------------------- | ------ | ------ | --------------------------------- | ------------ |
| D-AL-01 | Brand Kit (colors, fonts, logos) | D9     | M      | No BrandKit model; post-launch    |              |
| D-AL-02 | Google Drive import              | D9     | S      | Convenience feature; not blocking |              |
| D-AL-03 | Dropbox import                   | D9     | S      | Convenience feature; not blocking |              |

---

### Enterprise / Security

| ID       | Capability | Domain | Effort | Reason for Deferral                                  | Review Notes |
| -------- | ---------- | ------ | ------ | ---------------------------------------------------- | ------------ |
| D-ENT-01 | SSO / SAML | D12    | L      | Enterprise-only; add when first customer requires it |              |
| D-ENT-02 | OIDC       | D12    | M      | Enterprise-only; add when first customer requires it |              |

---

### Integrations

| ID       | Capability                            | Domain | Effort | Reason for Deferral                               | Review Notes |
| -------- | ------------------------------------- | ------ | ------ | ------------------------------------------------- | ------------ |
| D-INT-01 | CRM integration (HubSpot, Salesforce) | D13    | L      | Enterprise feature; L scope per CRM               |              |
| D-INT-02 | Zapier connector                      | D13    | M      | Depends on API docs (Phase 10); build post-launch |              |
| D-INT-03 | Make (Integromat) connector           | D13    | M      | Depends on API docs (Phase 10); build post-launch |              |
| D-INT-04 | Integration marketplace               | D13    | XL     | Premature until 10+ integrations exist            |              |

---

### AI / ML

| ID      | Capability                                | Domain | Effort | Reason for Deferral                                                | Review Notes |
| ------- | ----------------------------------------- | ------ | ------ | ------------------------------------------------------------------ | ------------ |
| D-AI-01 | Brand Voice fine-tuning (model fine-tune) | D6     | XL     | System prompts chosen for now (Task 11.7); fine-tuning post-launch |              |

---

## PRIORITY SCORING TEMPLATE

When reviewing, score each item 1–5 on:

- **Demand**: How many users have requested this?
- **Revenue**: Does this unlock a pricing tier or deal?
- **Effort**: Inverse of complexity (5 = easy, 1 = very hard)
- **Dependency**: Is this blocking other work?

**Priority score = (Demand × 2) + Revenue + Effort + Dependency**

Items with score ≥ 10 should be promoted to **Must Have Next**.

---

## CHANGE LOG

| Date       | Change                                       |
| ---------- | -------------------------------------------- |
| 2026-03-10 | Initial creation from master plan Appendix A |
