-- Adopt the event store tables into Prisma migrations.
--
-- `stored_events` was previously created at runtime by
-- `EventStore.ensureTable()`; that runtime DDL is being removed in this
-- batch. `event_snapshots` was referenced by `EventStore.createSnapshot` /
-- `getSnapshot` but never existed in any environment.
--
-- IF NOT EXISTS makes the migration idempotent so environments that already
-- have `stored_events` (created by the legacy runtime DDL) accept the
-- migration without churn; environments that don't get both tables created
-- atomically.

CREATE TABLE IF NOT EXISTS "stored_events" (
  "id"             TEXT        PRIMARY KEY,
  "stream_id"      TEXT        NOT NULL,
  "event_type"     TEXT        NOT NULL,
  "event_data"     TEXT        NOT NULL,
  "metadata"       TEXT        NOT NULL DEFAULT '{}',
  "version"        INTEGER     NOT NULL,
  "sequence"       BIGINT      NOT NULL,
  "timestamp"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "correlation_id" TEXT,
  "causation_id"   TEXT
);

CREATE INDEX IF NOT EXISTS "idx_stored_events_stream_id"
  ON "stored_events" ("stream_id");

CREATE INDEX IF NOT EXISTS "idx_stored_events_sequence"
  ON "stored_events" ("sequence");

CREATE UNIQUE INDEX IF NOT EXISTS "idx_stored_events_stream_version"
  ON "stored_events" ("stream_id", "version");

CREATE TABLE IF NOT EXISTS "event_snapshots" (
  "stream_id"  TEXT        PRIMARY KEY,
  "version"    INTEGER     NOT NULL,
  "data"       TEXT        NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
