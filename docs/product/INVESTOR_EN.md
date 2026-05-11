# OmniPost -- Investor Brief

**Multi-channel social media management built for agencies.**
**Production-grade infrastructure. AI-native from day one.**

---

## Table of Contents

1. [The Opportunity](#the-opportunity)
2. [The Product](#the-product)
3. [The AI Moat](#the-ai-moat)
4. [Autonomous Features](#autonomous-features)
5. [Business Model](#business-model)
6. [Technical Foundation](#technical-foundation)
7. [Competitive Analysis](#competitive-analysis)
8. [Go-to-Market](#go-to-market)
9. [Current Status](#current-status)

---

## The Opportunity

### Market Size

The global social media management software market surpassed **$23 billion in 2024** and continues to grow at 23.6% CAGR. The segment is dominated by legacy platforms -- Hootsuite (18M users, $99--$249/month), Sprout Social, Buffer, Later -- all built on architectures from the early 2010s. None were designed for AI-native workflows, and none price fairly for the agency use case.

### Why Now

Three structural shifts have created a window for a new entrant:

1. **Platform fragmentation is accelerating.** Bluesky, Threads, TikTok's expansion, LinkedIn's creator push, and Telegram's channel growth mean agencies now manage 8--12 platforms per client, up from 3--5 five years ago. Legacy tools cap at 6--8 integrations and charge per seat, punishing agencies that scale.

2. **AI has crossed the usefulness threshold.** GPT-4-class models can generate platform-specific copy, analyze performance data, and triage inbox messages at production quality. But no major SMM platform has built an AI pipeline that feeds real performance data back into generation. They bolt on basic "AI assist" features without a data flywheel.

3. **Agency economics demand per-provider pricing.** Agencies manage multiple clients across multiple platforms. Seat-based pricing (Hootsuite, Sprout Social) creates perverse incentives -- agencies limit team access to control costs, reducing adoption and increasing churn. Provider-based pricing aligns cost with value delivered.

### Target Customer

Digital marketing agencies with 5--50 people managing social media for multiple clients. These agencies:

- Manage 5--30+ client accounts across 5--10 platforms each
- Need multi-level approval workflows (junior creates, senior reviews, client approves)
- Require CRM integration to connect social performance to sales pipeline
- Want AI that understands their clients' brand voice, not generic suggestions
- Are underserved by seat-based pricing that punishes team growth

---

## The Product

### What OmniPost Does

OmniPost is a multi-tenant social media content management platform that lets agencies create, schedule, approve, and publish content across every major social platform from a single interface -- with AI that learns from each account's performance data.

### 10 Provider Integrations

OmniPost ships with production adapters for every platform agencies need:

| Provider  | Content Types               | API Version   |
| --------- | --------------------------- | ------------- |
| X/Twitter | Text, images, videos, polls | v2            |
| Instagram | Posts, stories, reels       | Graph API     |
| Facebook  | Posts, images, videos       | Graph API v18 |
| YouTube   | Videos, community posts     | Data API v3   |
| TikTok    | Videos                      | Business API  |
| LinkedIn  | Posts, articles, images     | v2            |
| Pinterest | Pins, boards                | v5            |
| Snapchat  | Stories, ads                | Marketing API |
| Telegram  | Channel posts, media        | Bot API       |
| Bluesky   | Posts, images               | AT Protocol   |

Each provider is implemented as an isolated package (`packages/providers/{name}/`) behind a unified `ProviderAdapter` port interface. Adding a new platform requires implementing a single interface -- zero changes to core application logic.

### Core Features

#### Content Management

- Rich content editor with per-platform preview and character-count validation
- Content library with tagging, search, and bulk operations
- Template system with variable interpolation and automation rules
- CSV bulk upload for campaign scheduling

#### Scheduling and Publishing

- Visual calendar with drag-and-drop scheduling
- Recurring post templates with cron-based scheduling
- Optimal time suggestions based on historical engagement data
- Publishing queue with retry logic and dead-letter handling
- 14 BullMQ queues processing content through the pipeline

#### Collaboration and Approvals

- Multi-level approval workflows (configurable per project)
- @mention support in comments and review threads
- Task management with assignment and due dates
- Real-time notification system with email and webhook delivery

#### Analytics

- Cross-platform analytics dashboard with date-range filtering
- Performance insights: audience analysis, hashtag performance, optimal timing
- Custom report builder with scheduled generation
- Analytics ingestion pipeline updating every 6 hours

#### Integrations

- CRM: HubSpot and Salesforce with real contact sync
- Automation: Zapier and Make (generic webhook integration)
- Storage: Google Drive import for media assets
- SSO: SAML 2.0 and OIDC for enterprise single sign-on
- Payments: Stripe and Paddle (swappable via environment variable)

### Architecture

OmniPost is built on Hexagonal Architecture (Ports and Adapters) with Domain-Driven Design, CQRS, the Saga pattern for distributed workflows, and the Transactional Outbox pattern for reliable event delivery.

```
Routes -> Application -> Domain <- Infrastructure
             |               |           |
          Use Cases      Entities    Prisma, Redis,
          Commands       Value Obj   BullMQ, S3,
          Queries        Events      Provider SDKs
```

**Why this matters to investors:** This architecture makes the codebase maintainable at scale. New features are additive -- they don't require modifying existing code. New providers, new AI models, new payment processors, new CRM integrations all plug in through port interfaces. The team can ship fast without accumulating technical debt.

**Key architectural decisions:**

- **Dependency inversion everywhere.** Domain code imports nothing external. Infrastructure adapters are injected via a DI container with 130+ tokens. Swapping PostgreSQL for another database, Redis for another cache, or Stripe for another payment processor requires changing one adapter -- zero application logic changes.

- **CQRS separation.** Commands (state changes) and queries (reads) are strictly separated. Commands go through aggregates and emit domain events. Queries read from optimized projections. This enables independent scaling of read and write paths.

- **Transactional Outbox.** Domain events are written to an outbox table in the same database transaction as the aggregate save. A relay process reads the outbox and dispatches events to BullMQ queues. This guarantees exactly-once processing even if the message broker fails.

- **Saga orchestration.** Multi-step workflows (publish to 5 platforms, update analytics, notify team) use the Saga pattern with compensating transactions. If step 3 fails, steps 1 and 2 are automatically compensated. Every saga step is idempotent.

- **Unit of Work.** Every mutating use case executes within a database transaction via Unit of Work. Repository writes and event dispatch happen atomically. No partial state changes reach the database.

---

## The AI Moat

Most social media tools that advertise "AI features" offer a thin wrapper around a language model: paste your text, get a rewrite. OmniPost's AI is fundamentally different because it is built on a closed-loop data pipeline that gets smarter with every post published.

### The Data Pipeline

```
Provider APIs -> Analytics Ingestion (every 6h) -> AnalyticsDailySummary
     |                                                      |
     v                                                      v
Performance Data                              GetTopPerformersContext
(impressions, clicks,                         (extracts winning patterns:
 engagement rate)                              tone, length, hashtags,
                                               posting time, media type)
                                                            |
                                                            v
                                              buildEnhancedSystemPrompt
                                              (injects performance context
                                               into LLM system prompt)
                                                            |
                                                            v
                                              AI Generation / Optimization
                                              (content that matches what
                                               actually works for THIS account)
```

**Step 1: Analytics Ingestion.** A background worker (`analyticsIngestWorker`) pulls engagement data from every connected provider every 6 hours and writes it to `AnalyticsDailySummary` records in PostgreSQL.

**Step 2: Performance Context Extraction.** `GetTopPerformersContextUseCase` queries the analytics data to identify each account's highest-performing content. It extracts patterns: which topics resonate, what tone works, optimal post length, best-performing hashtags, peak engagement windows, which media types drive clicks.

**Step 3: Enhanced Prompt Construction.** `buildEnhancedSystemPrompt` takes the performance context and constructs a system prompt that tells the LLM: "This account's audience responds best to [specific patterns]. Generate content that matches these patterns while maintaining the brand voice defined in [BrandKit settings]."

**Step 4: Task-Specific Model Routing.** Three LLM providers are integrated, each selected for its strength:

| Provider   | Model            | Used For                                      |
| ---------- | ---------------- | --------------------------------------------- |
| OpenAI     | GPT-4            | Content generation, brand voice adaptation    |
| Google     | Gemini 1.5 Flash | Fast analytics summarization, content scoring |
| Perplexity | Sonar            | Trend analysis, real-time topic research      |

The AI orchestrator (`apps/api/src/ai/orchestrator.ts`) routes each request to the optimal model based on the task type. Content generation goes to GPT-4 for quality. Analytics queries go to Gemini for speed. Trend research goes to Perplexity for real-time web access.

### Why Competitors Cannot Replicate This Quickly

1. **Data gravity.** The analytics pipeline requires connected provider accounts generating real engagement data. A new entrant has zero performance data. OmniPost's AI improves with every post published by every customer -- a compounding advantage.

2. **Architecture lock-in at incumbents.** Hootsuite, Sprout Social, and Buffer have monolithic architectures built before AI was viable. Retrofitting a real-time analytics-to-AI pipeline requires rearchitecting their data layer. OmniPost was designed for this pipeline from the start.

3. **Brand voice is account-specific.** Generic AI assistants produce generic content. OmniPost's AI generates content tuned to each account's audience behavior and brand guidelines. This specificity is the difference between "AI-assisted" and "AI-native."

4. **Three-model routing is non-trivial.** Most competitors use a single LLM provider. OmniPost's task-specific routing (quality model for generation, fast model for analytics, web-access model for trends) delivers better results at lower cost. Building this routing layer requires deep understanding of model strengths.

---

## Autonomous Features

Beyond AI-assisted content creation, OmniPost includes three fully autonomous features that operate without human intervention, creating value even when no team member is actively using the platform.

### 1. Post Repurposing Engine

**Queue:** `detect-repurpose` -> `generate-repurpose`

The system continuously monitors published content performance. When a post significantly outperforms its account's baseline (e.g., 3x average engagement), the repurposing engine:

1. Detects the high performer via the analytics pipeline
2. Analyzes what made it work (topic, tone, format, timing)
3. Generates adapted variants for platforms where it has not been posted
4. Presents proposals to the team for one-click approval and scheduling

A tweet that goes viral gets automatically proposed as a LinkedIn article, an Instagram carousel, and a TikTok script -- each adapted to platform conventions and the account's brand voice on that platform.

### 2. Inbox Triage

**Queue:** `triage-inbox`

Agencies managing 20+ client accounts receive hundreds of comments, DMs, and mentions daily. The inbox triage system:

1. Ingests all incoming messages via the inbox sync pipeline
2. Classifies each message by urgency (crisis, complaint, question, praise, spam)
3. Routes urgent messages to designated team members with priority notifications
4. Auto-archives spam and low-value interactions
5. Suggests response drafts for common question patterns

This turns a firehose of notifications into an organized, prioritized action queue. Agencies report that inbox management is their single largest time sink -- this feature directly addresses that pain point.

### 3. Trend Radar

**Queue:** `trend-radar`

The trend radar continuously monitors trending topics across connected platforms using Perplexity Sonar's real-time web access:

1. Fetches trending topics relevant to each account's industry and audience
2. Scores each trend for relevance, momentum, and brand fit
3. Generates content suggestions that capitalize on trending topics
4. Alerts team members when a high-relevance trend is detected

Agencies can ride trends within minutes of emergence rather than discovering them hours later through manual monitoring.

### Why Autonomous Features Matter

These features transform OmniPost from a tool that agencies use into a system that works for agencies. Every hour of autonomous operation deepens engagement, increases content output, and raises switching costs. An agency that relies on autonomous triage and repurposing would lose significant productivity by switching to a competitor that lacks these capabilities.

---

## Business Model

### Provider-Based Pricing

OmniPost uses provider-based pricing instead of seat-based pricing. Customers pay per social media platform connected, with volume discounts and account multipliers. This aligns cost with the value agencies actually receive -- the ability to publish across platforms -- rather than punishing them for having large teams.

**Per-Provider Pricing (monthly, per account):**

| Providers Connected | Price Per Provider |
| ------------------- | ------------------ |
| 1--3                | $12/provider       |
| 4--6                | $10/provider       |
| 7--9                | $8/provider        |
| 10+                 | $6/provider        |

Multi-account pricing uses a multiplier that decreases with scale, incentivizing agencies to consolidate all clients on the platform.

**Pre-Built Bundles:**

| Bundle      | Providers | Monthly Price | Target                |
| ----------- | --------- | ------------- | --------------------- |
| Creator     | 3         | $25           | Freelancers           |
| Social Pro  | 5         | $32           | Small agencies        |
| Agency Full | 10        | $55           | Mid-to-large agencies |

### Unit Economics

Illustrative monthly revenue by customer segment:

| Segment      | Providers | Accounts | Monthly Revenue |
| ------------ | --------- | -------- | --------------- |
| Freelancer   | 3         | 1        | $30             |
| Small agency | 5         | 5        | ~$156           |
| Mid agency   | 8         | 15       | ~$468           |
| Large agency | 10        | 30       | ~$990           |

The pricing model creates natural expansion revenue: as agencies win new clients and add accounts, revenue grows without any upsell effort. A mid-sized agency growing from 15 to 30 accounts doubles their spend automatically.

### Customer-Friendly Policies

- **Grandfathering:** Existing customers receive 60--90 days notice before any price change takes effect, with the option to lock in current pricing for an additional period.
- **Referral program:** 30 days of free service per successful referral conversion. Agency networks are tight-knit -- referral loops are the primary organic growth channel.
- **No seat limits:** Unlimited team members on all plans. This removes adoption friction within agencies and ensures the platform becomes embedded in team workflows.

### Payment Infrastructure

Dual payment processor support via the `PaymentAdapter` port interface:

- **Stripe** for primary payment processing (cards, ACH, SEPA)
- **Paddle** as an alternative processor (handles sales tax/VAT compliance globally)

Switching between processors requires changing a single environment variable -- zero code changes. This de-risks payment processor dependency and enables geographic optimization (Paddle for EU VAT compliance, Stripe for US direct processing).

---

## Technical Foundation

### Codebase Metrics

| Metric                     | Value                                                    |
| -------------------------- | -------------------------------------------------------- |
| **Prisma Models**          | 97                                                       |
| **Test Suite**             | 7,159 tests, 0 failures                                  |
| **BullMQ Queues**          | 14                                                       |
| **Active Workers**         | 6 (publish, analytics, inbox, repurpose, triage, trends) |
| **Client Dashboard Pages** | 41                                                       |
| **Admin Dashboard Pages**  | 11                                                       |
| **Provider Adapters**      | 10                                                       |
| **DI Container Tokens**    | 130+                                                     |
| **Mutating Use Cases**     | 56 (100% Unit of Work coverage)                          |
| **API Routes**             | 45 (44 authenticated, 1 health check)                    |
| **SSO Protocols**          | 2 (SAML 2.0, OIDC)                                       |
| **CRM Integrations**       | 2 (HubSpot, Salesforce)                                  |
| **AI Providers**           | 3 (OpenAI GPT-4, Gemini 1.5 Flash, Perplexity Sonar)     |
| **Payment Processors**     | 2 (Stripe, Paddle)                                       |

### Technology Stack

| Layer           | Technology                                                 |
| --------------- | ---------------------------------------------------------- |
| **Runtime**     | Node.js 24, TypeScript 6.0.2                               |
| **API**         | Fastify 5.6.1                                              |
| **Frontend**    | Next.js 16.1.6, React 19.2.4, Tailwind CSS, Radix UI       |
| **ORM**         | Prisma 7.4.1                                               |
| **Database**    | PostgreSQL 16                                              |
| **Cache/Queue** | Redis 7, BullMQ 5.58.9                                     |
| **Storage**     | S3-compatible (AWS S3, MinIO, Cloudflare R2)               |
| **Monitoring**  | Prometheus metrics, Pino structured logging, OpenTelemetry |
| **Testing**     | Vitest, node:test, Playwright                              |
| **CI/CD**       | GitHub Actions                                             |

### Quality Indicators

- **Zero `any` types** in production code (TypeScript strict mode with `exactOptionalPropertyTypes`)
- **Zero `@ts-ignore`** directives in production source
- **Zero test failures** across the entire suite
- **100% Unit of Work** coverage on all mutating use cases
- **OpenAPI schemas** on 44 of 45 routes (the exception is the health check endpoint)
- **Result type** for all fallible operations -- no thrown exceptions crossing layer boundaries
- **Correlation ID** propagation from HTTP request through domain events, outbox, and BullMQ jobs to error responses

### Multi-Tenant Security

OmniPost is multi-tenant by design. Every database query is scoped to `accountId`. The system enforces tenant isolation at multiple levels:

- **Separate JWT secrets** for AdminUser (internal) and CustomerUser (client-facing) authentication
- **Row-level tenant scoping** on every repository query -- no cross-tenant data leakage is architecturally possible
- **SAML 2.0 and OIDC** support for enterprise SSO, enabling agencies to use their existing identity provider
- **Multi-level approval workflows** ensuring content goes through the right review chain before publication

---

## Competitive Analysis

| Capability                | OmniPost                         | Hootsuite              | Sprout Social          | Buffer                |
| ------------------------- | -------------------------------- | ---------------------- | ---------------------- | --------------------- |
| **Platform integrations** | 10                               | 8                      | 9                      | 6                     |
| **AI content generation** | Brand voice + perf data pipeline | Basic AI assist        | Basic AI assist        | Basic AI assist       |
| **AI model routing**      | 3 models, task-specific          | Single model           | Single model           | Single model          |
| **Autonomous features**   | 3 (repurpose, triage, trends)    | Roadmap                | Roadmap                | None announced        |
| **Pricing model**         | Per-provider (no seat limit)     | Per-seat ($99--$249+)  | Per-seat ($199--$399+) | Per-channel ($5--$10) |
| **Multi-level approvals** | Configurable N-level             | Basic (1 level)        | 2-level                | None                  |
| **CRM integration**       | HubSpot + Salesforce             | HubSpot (add-on)       | HubSpot + Salesforce   | None                  |
| **SSO**                   | SAML 2.0 + OIDC                  | SAML (Enterprise only) | SAML (Enterprise only) | None                  |
| **Architecture**          | Hexagonal + DDD + CQRS           | Monolith               | Monolith               | Monolith              |
| **Open platforms**        | Bluesky, Telegram                | Neither                | Neither                | Neither               |

### Key Differentiators

1. **AI that learns from your data.** Every other tool offers generic AI. OmniPost's AI pipeline ingests each account's real performance data and generates content tuned to what actually works for that specific audience. This is not a feature -- it is a compounding data advantage.

2. **Provider-based pricing eliminates seat tax.** Agencies with 20 team members pay the same as agencies with 5 on OmniPost. On Hootsuite, that same team would pay $4,980/month on the Enterprise plan. OmniPost's large agency tier costs ~$990/month for 30 accounts across all 10 platforms.

3. **Autonomous features create value without human input.** The repurposing engine, inbox triage, and trend radar operate continuously. An agency's OmniPost instance generates content proposals, prioritizes messages, and surfaces trends even when no team member is logged in.

4. **Decentralized platform support.** OmniPost is the only enterprise SMM tool with native Bluesky (AT Protocol) and Telegram support. As social media decentralizes, agencies need tools that support emerging platforms on day one, not 18 months after launch.

5. **Architecture enables velocity.** The hexagonal architecture with port interfaces means adding a new platform, AI model, or payment processor is a matter of implementing a single interface. Competitors with monolithic codebases measure new integrations in quarters. OmniPost measures them in days.

---

## Go-to-Market

### Phase 1: Agency Direct (Months 1--6)

**Target:** Digital marketing agencies managing 5--30 client social media accounts.

**Channel strategy:**

- Direct outreach to agency networks and communities (Agency Collective, AMMA, local digital marketing associations)
- Content marketing demonstrating AI capabilities with real before/after comparisons
- Free 14-day trial with full feature access (no credit card required)
- Referral program: 30 days free per successful conversion

**Why agencies first:** Agencies are the highest-LTV segment in SMM software. A single mid-sized agency generates ~$468/month. Agencies also serve as distribution -- every agency that adopts OmniPost exposes the platform to their clients, creating inbound demand for direct accounts.

### Phase 2: Referral Expansion (Months 3--9)

Agency teams are interconnected. Social media managers move between agencies. Agency owners attend the same conferences and communities. The referral program leverages this network effect:

- Each referral gives the referrer 30 days of free service
- Referred agencies get an extended 30-day trial
- No cap on referral rewards -- power users can earn months of free service

The goal is to achieve a referral coefficient above 0.3 (every 10 customers bring in 3 new ones) within the first 6 months.

### Phase 3: Brand Direct and Enterprise (Months 6--12)

As the AI pipeline accumulates performance data and the autonomous features mature, OmniPost becomes viable for in-house brand teams:

- Enterprise SSO (SAML 2.0 + OIDC) is already built
- CRM integration (HubSpot + Salesforce) connects social performance to revenue
- Custom report builder enables executive-level reporting
- Multi-level approvals support corporate governance requirements

### Growth Levers

1. **Provider expansion.** Each new platform integration (Threads, Mastodon, WhatsApp Business) attracts agencies that manage presence on that platform. The provider adapter architecture makes this a repeatable, low-cost growth lever.

2. **AI improvements compound.** More customers generate more performance data. Better data improves AI output quality. Better AI output increases customer retention and word-of-mouth. This flywheel accelerates over time.

3. **Account expansion is automatic.** As agencies grow their client base, they add accounts to OmniPost. Revenue grows proportionally without sales effort. The provider-based pricing model turns customer success into revenue expansion by default.

---

## Current Status

### Production-Ready

OmniPost is not a prototype or MVP. The platform is production-grade:

- **97 database models** covering every aspect of multi-tenant social media management
- **7,159 automated tests** with zero failures across unit, integration, and end-to-end suites
- **14 background job queues** handling publishing, analytics, inbox sync, AI processing, and autonomous features
- **41 client dashboard pages** providing a complete user experience
- **11 admin dashboard pages** for platform operations and monitoring
- **Full observability stack** with OpenTelemetry tracing, Prometheus metrics, and structured logging with correlation ID propagation
- **CI/CD pipeline** with automated testing, linting, and quality gates on every commit

### What Has Been Built

| Area                  | Status      | Detail                                                   |
| --------------------- | ----------- | -------------------------------------------------------- |
| Core platform         | Complete    | Content creation, scheduling, publishing, analytics      |
| Provider integrations | 10 of 10    | All major platforms plus Bluesky and Telegram            |
| AI pipeline           | Complete    | 3 providers, performance data loop, brand voice          |
| Autonomous features   | 3 of 3      | Repurposing, inbox triage, trend radar                   |
| Approval workflows    | Complete    | Multi-level, configurable per project                    |
| CRM integration       | Complete    | HubSpot and Salesforce with contact sync                 |
| SSO                   | Complete    | SAML 2.0 and OIDC                                        |
| Payment processing    | Complete    | Stripe and Paddle with adapter pattern                   |
| Admin dashboard       | Complete    | Accounts, security, compliance, billing, webhooks        |
| Testing               | 7,159 tests | Unit (Vitest), integration (node:test), E2E (Playwright) |

### What Comes Next

**Near-term (next quarter):**

- WhatsApp Business and Threads provider adapters
- Advanced AI: auto-scheduling based on predicted engagement
- White-label option for agencies to resell under their own brand
- Mobile companion app for approvals and inbox triage

**Medium-term (6 months):**

- Marketplace for community-built provider adapters and AI templates
- Advanced analytics with cohort analysis and attribution modeling
- Multi-language AI content generation with cultural adaptation
- Video-first content creation with AI-assisted editing

---

## Investment Thesis

OmniPost is positioned to capture significant share of the $23B+ social media management market by combining three advantages that no incumbent currently offers:

1. **An AI data flywheel** that improves content quality with every post published, creating a compounding competitive advantage that widens over time.

2. **A pricing model aligned with agency economics** that enables land-and-expand revenue growth without active sales effort.

3. **A modern architecture** that enables rapid platform expansion and feature development at a fraction of the engineering cost of competitors burdened by legacy codebases.

The platform is not a concept or early-stage prototype. It is a production-grade system with 97 database models, 7,159 tests, 10 provider integrations, 3 AI providers, and autonomous features already operational. The engineering risk is behind us. The execution path ahead is distribution and growth.

---

**Contact:** [team@omni-post.com]

**Documentation:** [docs.omni-post.com]

**Repository:** Private -- available for technical due diligence upon request.
