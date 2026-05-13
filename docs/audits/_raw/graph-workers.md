# Graph Report - workers (2026-05-12)

## Corpus Check

- 24 files · ~16,369 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary

- 281 nodes · 416 edges · 15 communities (11 shown, 4 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness

- Built from commit: `edc8ab61`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)

- [[_COMMUNITY_Job Handler Test Fixtures|Job Handler Test Fixtures]]
- [[_COMMUNITY_Instagram Worker Integration Tests|Instagram Worker Integration Tests]]
- [[_COMMUNITY_Graceful Shutdown & Auth Failures|Graceful Shutdown & Auth Failures]]
- [[_COMMUNITY_Worker Metrics & Observability|Worker Metrics & Observability]]
- [[_COMMUNITY_Instagram Publishing Worker|Instagram Publishing Worker]]
- [[_COMMUNITY_Publish Handler Contracts|Publish Handler Contracts]]
- [[_COMMUNITY_Worker Bootstrap & Credentials|Worker Bootstrap & Credentials]]
- [[_COMMUNITY_Publish Handler Edge Tests|Publish Handler Edge Tests]]
- [[_COMMUNITY_Publish Handler Core|Publish Handler Core]]
- [[_COMMUNITY_Vitest Config|Vitest Config]]
- [[_COMMUNITY_Worker Smoke Test|Worker Smoke Test]]
- [[_COMMUNITY_Stryker Mutation Config|Stryker Mutation Config]]
- [[_COMMUNITY_Community 12|Community 12]]

## God Nodes (most connected - your core abstractions)

1. `WorkerMetrics` - 23 edges
2. `InstagramPublishingWorker` - 18 edges
3. `createTestDeps()` - 12 edges
4. `PublishHandler` - 12 edges
5. `registerGracefulShutdown()` - 12 edges
6. `ChannelAuthFailureRecorder` - 8 edges
7. `handleProviderAuthError()` - 6 edges
8. `main()` - 5 edges
9. `CredentialResolver` - 5 edges
10. `ShutdownTarget` - 5 edges

## Surprising Connections (you probably didn't know these)

- `processJob()` --calls--> `handleProviderAuthError()` [EXTRACTED]
  src/analyticsIngestWorker.ts → src/lib/handleProviderAuthError.ts
- `processJob()` --calls--> `handleProviderAuthError()` [EXTRACTED]
  src/inboxSyncWorker.ts → src/lib/handleProviderAuthError.ts
- `start()` --calls--> `registerGracefulShutdown()` [EXTRACTED]
  src/analyticsIngestWorker.ts → src/lib/gracefulShutdown.ts
- `start()` --calls--> `registerGracefulShutdown()` [EXTRACTED]
  src/inboxSyncWorker.ts → src/lib/gracefulShutdown.ts
- `startPublishWorker()` --calls--> `registerGracefulShutdown()` [EXTRACTED]
  src/publishWorker.ts → src/lib/gracefulShutdown.ts

## Communities (15 total, 4 thin omitted)

### Community 0 - "Job Handler Test Fixtures"

Cohesion: 0.05
Nodes (33): circuitBreaker, InstagramPublishPayload, enqueueCall, expectedRetryTime, failingEnqueue, failingLogPublish, health, logCall (+25 more)

### Community 1 - "Instagram Worker Integration Tests"

Cohesion: 0.06
Nodes (45): instagramProvider, logStatuses, match, okIdx, plan, post, rendered, renderErr (+37 more)

### Community 2 - "Graceful Shutdown & Auth Failures"

Cohesion: 0.09
Nodes (28): registerGracefulShutdown(), RegisterGracefulShutdownOptions, ShutdownLogger, ShutdownTarget, handleProviderAuthError(), AGGREGATE_TYPE, ChannelAuthFailureRecorder, ChannelAuthFailureRecorderOptions (+20 more)

### Community 3 - "Worker Metrics & Observability"

Cohesion: 0.06
Nodes (14): WorkerMetrics, WorkerMetricsCollector, finish, finish1, finish2, finish3, id, id1 (+6 more)

### Community 4 - "Instagram Publishing Worker"

Cohesion: 0.15
Nodes (19): BusinessKPITracker, CredentialsLookup, DatabaseInstrumentation, PublishHandlerDeps, PublishInstrumentation, PublishJobInput, PublishProvider, PublishRepo (+11 more)

### Community 5 - "Publish Handler Contracts"

Cohesion: 0.11
Nodes (13): ChannelCredentialsRepository, CredentialResolver, consumer, credentialResolver, handler, logger, notifyRedis, providerRegistry (+5 more)

### Community 7 - "Publish Handler Edge Tests"

Cohesion: 0.12
Nodes (15): errMatch, failMatch, igJob, igOk, igProvider, job, logStatuses, match (+7 more)

### Community 8 - "Publish Handler Core"

Cohesion: 0.29
Nodes (5): create, ids, MockTxOps, update, updates

### Community 10 - "Worker Smoke Test"

Cohesion: 0.33
Nodes (4): connection, logger, queue, worker

## Knowledge Gaps

- **127 isolated node(s):** `root`, `job`, `match`, `sagaMessages`, `parsed` (+122 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **Why does `WorkerMetrics` connect `Worker Metrics & Observability` to `Instagram Worker Integration Tests`, `Instagram Publishing Worker`, `Publish Handler Contracts`?**
  _High betweenness centrality (0.123) - this node is a cross-community bridge._
- **Why does `PublishHandler` connect `Vitest Config` to `Instagram Worker Integration Tests`, `Instagram Publishing Worker`, `Publish Handler Contracts`, `Publish Handler Edge Tests`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Why does `registerGracefulShutdown()` connect `Graceful Shutdown & Auth Failures` to `Worker Smoke Test`, `Publish Handler Contracts`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **What connects `root`, `job`, `match` to the rest of the system?**
  _127 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Job Handler Test Fixtures` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Instagram Worker Integration Tests` be split into smaller, more focused modules?**
  _Cohesion score 0.06 - nodes in this community are weakly interconnected._
- **Should `Graceful Shutdown & Auth Failures` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
