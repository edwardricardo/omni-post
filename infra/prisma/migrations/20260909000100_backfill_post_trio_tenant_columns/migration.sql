-- Tenant column for the Post trio, step 2 of 6: backfill every existing row.
--
-- ORDER IS LOAD-BEARING. `Post` is filled from `Project."accountId"`; the two children
-- are then filled from `Post."accountId"`. Running a child before its parent would copy
-- NULLs and the final check at the bottom would abort the file.
--
-- NO `deletedAt` FILTER, DELIBERATELY. Soft-deleted rows are still rows: the next
-- migration makes this column NOT NULL, and a NOT NULL constraint does not exempt
-- invisible rows. A backfill scoped to live rows would leave every soft-deleted post
-- NULL and abort step 3 — and worse, a soft-deleted parent is exactly the case the
-- TOTAL (non-partial) unique further down exists to keep referenceable.
--
-- BATCHED IN EVERY ENVIRONMENT, never a single whole-table UPDATE. One statement over
-- an entire table holds every row lock it takes until commit, builds one enormous
-- snapshot, and gives the planner no chance to stop early; the batched form bounds
-- per-statement work and memory instead. The loops below are KEYSET-paged in `id`
-- order: each pass carries the last id it saw and asks only for ids above it, so no
-- pass re-reads what an earlier pass already walked. `OFFSET` would degrade
-- quadratically over the same data.
--
-- HONEST LIMIT, stated rather than implied: Prisma wraps this FILE in ONE transaction,
-- so batching bounds STATEMENTS, not lock lifetime — every row lock taken here is held
-- until the file commits. Batching is not a substitute for a chunked out-of-band
-- backfill; it is what keeps a single statement from being unbounded.
--
-- IDEMPOTENT AND RE-RUNNABLE. Every UPDATE is gated on `"accountId" IS NULL`, and every
-- loop terminates when no NULL rows remain above its cursor. Re-running the file after a
-- partial application does the remaining work and nothing else.
--
-- AN UNMAPPABLE ROW ABORTS THE FILE. If a row's parent is missing, the UPDATE cannot fill
-- it, the cursor still advances past it, and the final block raises. That is the intended
-- behaviour: a post with no resolvable tenant must not be handed an invented value, and it
-- must not slip through into a NOT NULL column by way of some default.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

-- 1. Post <- Project."accountId"
DO $$
DECLARE
  last_id    TEXT   := '';
  batch_ids  TEXT[];
  filled     BIGINT;
  total      BIGINT := 0;
BEGIN
  LOOP
    SELECT array_agg(candidate.id ORDER BY candidate.id)
      INTO batch_ids
      FROM (
        SELECT id
        FROM "Post"
        WHERE id > last_id
          AND "accountId" IS NULL
        ORDER BY id
        LIMIT 10000
      ) AS candidate;

    EXIT WHEN batch_ids IS NULL;

    UPDATE "Post" AS child
       SET "accountId" = parent."accountId"
      FROM "Project" AS parent
     WHERE child.id = ANY (batch_ids)
       AND child."projectId" = parent.id
       AND child."accountId" IS NULL;

    GET DIAGNOSTICS filled = ROW_COUNT;
    total := total + filled;
    last_id := batch_ids[array_length(batch_ids, 1)];
  END LOOP;

  RAISE NOTICE 'Post tenant backfill: % row(s) filled from Project', total;
END $$;

-- 2. PostContent <- Post."accountId"
DO $$
DECLARE
  last_id    TEXT   := '';
  batch_ids  TEXT[];
  filled     BIGINT;
  total      BIGINT := 0;
BEGIN
  LOOP
    SELECT array_agg(candidate.id ORDER BY candidate.id)
      INTO batch_ids
      FROM (
        SELECT id
        FROM "PostContent"
        WHERE id > last_id
          AND "accountId" IS NULL
        ORDER BY id
        LIMIT 10000
      ) AS candidate;

    EXIT WHEN batch_ids IS NULL;

    UPDATE "PostContent" AS child
       SET "accountId" = parent."accountId"
      FROM "Post" AS parent
     WHERE child.id = ANY (batch_ids)
       AND child."postId" = parent.id
       AND child."accountId" IS NULL;

    GET DIAGNOSTICS filled = ROW_COUNT;
    total := total + filled;
    last_id := batch_ids[array_length(batch_ids, 1)];
  END LOOP;

  RAISE NOTICE 'PostContent tenant backfill: % row(s) filled from Post', total;
END $$;

-- 3. PostMedia <- Post."accountId"
DO $$
DECLARE
  last_id    TEXT   := '';
  batch_ids  TEXT[];
  filled     BIGINT;
  total      BIGINT := 0;
BEGIN
  LOOP
    SELECT array_agg(candidate.id ORDER BY candidate.id)
      INTO batch_ids
      FROM (
        SELECT id
        FROM "PostMedia"
        WHERE id > last_id
          AND "accountId" IS NULL
        ORDER BY id
        LIMIT 10000
      ) AS candidate;

    EXIT WHEN batch_ids IS NULL;

    UPDATE "PostMedia" AS child
       SET "accountId" = parent."accountId"
      FROM "Post" AS parent
     WHERE child.id = ANY (batch_ids)
       AND child."postId" = parent.id
       AND child."accountId" IS NULL;

    GET DIAGNOSTICS filled = ROW_COUNT;
    total := total + filled;
    last_id := batch_ids[array_length(batch_ids, 1)];
  END LOOP;

  RAISE NOTICE 'PostMedia tenant backfill: % row(s) filled from Post', total;
END $$;

-- 4. Abort in-transaction if ANY row is still unresolved. This runs inside the same
--    transaction as the loops above, so raising here rolls the entire backfill back
--    rather than leaving a half-filled table for step 3 to trip over.
DO $$
DECLARE
  post_nulls    BIGINT;
  content_nulls BIGINT;
  media_nulls   BIGINT;
BEGIN
  SELECT count(*) INTO post_nulls    FROM "Post"        WHERE "accountId" IS NULL;
  SELECT count(*) INTO content_nulls FROM "PostContent" WHERE "accountId" IS NULL;
  SELECT count(*) INTO media_nulls   FROM "PostMedia"   WHERE "accountId" IS NULL;

  IF post_nulls > 0 OR content_nulls > 0 OR media_nulls > 0 THEN
    RAISE EXCEPTION
      'Post trio tenant backfill incomplete — Post: % unresolved, PostContent: %, PostMedia: %. '
      'Every unresolved row has no reachable parent (an orphaned projectId or postId). '
      'Resolve or remove those rows before migrating; the next migration makes this column '
      'NOT NULL and no value may be invented for them.',
      post_nulls, content_nulls, media_nulls;
  END IF;

  RAISE NOTICE 'Post trio tenant backfill: 0 unresolved rows across all three tables';
END $$;
