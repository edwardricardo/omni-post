-- Rewrite the remaining 58 `tenant_isolation` policies so each `current_setting()` read is
-- hoisted into an InitPlan, evaluated ONCE per statement instead of once per candidate row.
--
-- This finishes what 20260910000000_rls_initplan_post_trio started. That migration moved the
-- three Post-trio policies, explicitly and by name, because they were the tables the A/B
-- corpus could actually measure. This one moves everything else the tenant guard enrolls:
-- 61 policies live in the catalog, 3 are already wrapped, and the remaining 58 are still
-- paying the per-row GUC read. A catalog left half-rewritten is not a smaller version of the
-- repair — it is a form-uniformity gate nobody can write, which is why this migration and the
-- gate that reads its result are the last two links of one change.
--
-- SEMANTICS ARE UNCHANGED, PER POLICY. Same column, same `__system__` cross-tenant escape for
-- withSystemContext() flows, same fail-closed behaviour when the GUC is unset
-- (`current_setting(..., true)` returns NULL, the predicate is not true, no rows are visible
-- and no write is admitted), and — this is the one that is easy to lose in a loop — the same
-- THIRD disjunct on "AIPromptTemplate", whose 6 rows all carry a NULL "accountId" and are
-- visible to every tenant only because of it. The only textual delta on any of the 58 is that
-- each `current_setting('app.account_id', true)` call is wrapped in `(SELECT ...)`.
--
-- THE FORM WAS MEASURED, NOT ARGUED, AND THE MEASUREMENT IS NOT REPEATED HERE. Three candidate
-- bodies were installed and measured against the same corpus, and `W` — the body below — won
-- by a tiebreak declared before the run; docs/reports/TENANT_RLS_AB_MEASUREMENT.md carries the
-- verdict and the adjudications. The trio migration's committed re-run then measured the
-- form's effect on the deployed object: scan-node medians 4.163/4.209/3.808 ms -> 1.834/1.876/
-- 1.707 ms, and `A′`'s InitPlan count moving 0 -> 2 — the planner agreeing that the read is now
-- statement-scoped, which is the claim that does not depend on a clock.
--
-- WHAT THIS MIGRATION'S OWN EVIDENCE CAN AND CANNOT SAY. The trio's 2.2x is NOT inherited by
-- the other 58 and is not asserted for them. Most of these tables are EMPTY on every corpus
-- this repo can build, so their timings would be meaningless; the evidence pass for this
-- migration proves the qual becomes a Param/InitPlan reference in the plan, and that rows are
-- identical in all three GUC states where rows exist. Timing claims remain trio-only. One
-- measured case in this change already showed the wrapper CHANGING a chosen index, so "a moved
-- plan" is a live possibility here and is recorded as a finding when it happens, not omitted
-- because the row set was unchanged.
--
-- ENUMERATION COMES FROM THE LIVE CATALOG. The 61 policies were installed across 10 migrations
-- and one of them carries a different body; a file-derived or hand-written table list is
-- precisely the mechanism by which a policy is missed or a variant's third disjunct is
-- silently deleted. The loop below reads `pg_policy`, and every count it depends on is
-- asserted rather than assumed.
--
-- THE BRANCH IS CHOSEN BY THE PRE-IMAGE, NOT BY THE TABLE NAME ALONE. A loop that special-cases
-- "AIPromptTemplate" by name is correct exactly as long as nobody else ever grows a third
-- disjunct. So each policy's existing deparsed body is matched against the two forms this
-- catalog is known to hold, the branch is selected from THAT, and the table name is then
-- cross-checked against it: a three-armed policy on any other table, or a two-armed one on
-- "AIPromptTemplate", ABORTS the migration instead of being flattened into the standard body.
-- The pinned pre-images are the deparsed strings read back from this project's own PostgreSQL
-- 16.14 (`pg_get_expr`), not the bytes of the installing migrations — the catalog stores a
-- parse tree and re-prints it with its own casts and spacing, so the source bytes are the wrong
-- thing to compare against.
--
-- `ALTER POLICY`, NOT `DROP POLICY` + `CREATE POLICY`, AND THIS DIVERGES FROM THE TRIO
-- MIGRATION DELIBERATELY. A policy is a 5-tuple — (qual, with_check, permissive, cmd, roles) —
-- and only the first two are what this change is about. Re-creating 58 policies means
-- re-declaring the other three 58 times, and a `CREATE POLICY` that forgets `WITH CHECK`
-- leaves `qual` byte-identical while silently dropping the mutation gate: that exact defect is
-- what advisory 1.4 of this change was written to catch, after it passed a qual-only restore
-- proof. `ALTER POLICY ... USING (...)` cannot touch `permissive`, `cmd` or `roles` at all, and
-- a form that omits `WITH CHECK` leaves an absent one absent rather than synthesizing it. The
-- trio migration names three tables in nine lines and was verified by eye; a 58-iteration loop
-- is not, so it uses the DDL whose blast radius is bounded by construction. The 5-tuple is
-- STILL asserted before and after, because a guarantee by construction that nobody checks is
-- an argument, not evidence.
--
-- A POLICY THAT DECLARES NO `WITH CHECK` KEEPS DECLARING NONE. Vacuous on this catalog — all
-- 61 declare one, measured — but the invariant is structural rather than incidental: an
-- unspecified `WITH CHECK` inherits the `USING` expression BY SPECIFICATION, so synthesizing
-- one would change the effective write-path predicate of a policy that deliberately had none.
-- The branch exists so that the first policy to need it is not rewritten by a loop that never
-- considered the case.
--
-- ROLE POSTURE is unchanged: migrations and the seed connect on the owner channel, which is
-- not subject to these policies (the tables are not FORCE'd — see
-- docs/technical/ADR-0022-rls-enforcement-posture.md); application traffic connects as
-- `omnipost_app`, which is NOSUPERUSER / NOBYPASSRLS and IS subject to them.
--
-- FAILURE IS TOTAL, NEVER PARTIAL. Every assertion below RAISEs, and Prisma runs this file in
-- one transaction, so a catalog that does not match what this migration was written against is
-- left exactly as it was found. A partial sweep SHALL NOT commit.
--
-- Rollback: the companion down.sql, which Prisma never applies automatically.

-- 58 `ALTER POLICY` statements run inside ONE `DO` statement, each taking ACCESS EXCLUSIVE on
-- its table and holding it to commit. `lock_timeout` bounds the wait behind any one
-- long-running query; `statement_timeout` bounds the whole block. 60s rather than the trio
-- migration's 30s because the block is one statement covering 58 tables — the value is the
-- design's, kept unchanged even though `ALTER POLICY` halved the DDL count from the 116 that
-- number was sized for, so the headroom is now larger than the estimate rather than tighter.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $sweep$
DECLARE
  -- The target bodies. These are the BYTES of 20260910000000_rls_initplan_post_trio, carried
  -- across in a nested dollar-quoted literal rather than re-typed with doubled quotes, so the
  -- 58 policies below are installed with the expression the trio's three were installed with
  -- and a diff between the two files is a diff of prose only.
  c_target_standard CONSTANT text := $body$
    (SELECT current_setting('app.account_id', true)) = '__system__'
    OR "accountId" = (SELECT current_setting('app.account_id', true))
  $body$;

  -- The variant's USING, and the ONLY place in this migration where the third disjunct
  -- exists. `AIPromptTemplate."accountId" IS NULL` means "global system template, visible to
  -- every tenant" (20260527000000). Its WITH CHECK stays strict — reading a global template is
  -- everyone's, writing one is `__system__`'s — which is why the variant needs two constants
  -- and not one.
  c_target_variant CONSTANT text := $body$
    (SELECT current_setting('app.account_id', true)) = '__system__'
    OR "accountId" = (SELECT current_setting('app.account_id', true))
    OR "accountId" IS NULL
  $body$;

  -- The expected PRE-images, as this server deparses them. Read back from pg_policies on
  -- PostgreSQL 16.14 before this migration was authored; CI runs pgvector/pgvector:pg16, the
  -- same major. Compared after whitespace collapse only — casts and identifier case stay
  -- pinned, because `("accountid" = ...)` would be a different column and must not match.
  c_bare_standard CONSTANT text :=
    $pre$((current_setting('app.account_id'::text, true) = '__system__'::text) OR ("accountId" = current_setting('app.account_id'::text, true)))$pre$;
  c_bare_variant CONSTANT text :=
    $pre$((current_setting('app.account_id'::text, true) = '__system__'::text) OR ("accountId" = current_setting('app.account_id'::text, true)) OR ("accountId" IS NULL))$pre$;
  c_wrapped_standard CONSTANT text :=
    $pre$((( SELECT current_setting('app.account_id'::text, true) AS current_setting) = '__system__'::text) OR ("accountId" = ( SELECT current_setting('app.account_id'::text, true) AS current_setting)))$pre$;

  c_trio CONSTANT text[] := ARRAY['Post', 'PostContent', 'PostMedia'];
  c_variant_table CONSTANT text := 'AIPromptTemplate';

  -- Every count this migration depends on, declared where a reader can see them together.
  c_expect_total CONSTANT int := 61;
  c_expect_trio CONSTANT int := 3;
  c_expect_found CONSTANT int := 58;
  c_expect_standard CONSTANT int := 57;
  c_expect_variant CONSTANT int := 1;

  r record;
  v_total int;
  v_trio int := 0;
  v_found int := 0;
  v_rewritten int := 0;
  v_standard int := 0;
  v_variant int := 0;
  v_no_with_check int := 0;
  v_using text;
  v_reads int;
  v_hoisted int;
  v_offenders text;
BEGIN
  ---------------------------------------------------------------------------
  -- Precondition 1: the population this migration was written against.
  ---------------------------------------------------------------------------
  SELECT count(*) INTO v_total FROM pg_policy WHERE polname = 'tenant_isolation';
  IF v_total <> c_expect_total THEN
    RAISE EXCEPTION
      'tenant_isolation enrollment is % policies, expected %. This migration was authored '
      'against a catalog of % and its counts below would be meaningless against any other. '
      'If a policy was legitimately added or removed, that change owns updating these '
      'constants and re-running the sweep evidence — not this migration silently sweeping a '
      'population nobody measured.',
      v_total, c_expect_total, c_expect_total;
  END IF;

  ---------------------------------------------------------------------------
  -- Precondition 2: the trio really is already wrapped.
  --
  -- The loop below excludes three tables on the stated grounds that
  -- 20260910000000 already rewrote them. That is a claim about the database,
  -- so it is checked against the database. If an operator has run the trio's
  -- down.sql, this migration would otherwise commit a catalog that is 58/61
  -- uniform and read as complete.
  ---------------------------------------------------------------------------
  FOR r IN
    SELECT c.relname,
           pg_get_expr(p.polqual, p.polrelid) AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    WHERE p.polname = 'tenant_isolation'
      AND c.relname = ANY (c_trio)
    ORDER BY c.relname
  LOOP
    v_trio := v_trio + 1;
    IF regexp_replace(r.qual, '\s+', ' ', 'g') <> regexp_replace(c_wrapped_standard, '\s+', ' ', 'g')
       OR regexp_replace(coalesce(r.with_check, ''), '\s+', ' ', 'g')
          <> regexp_replace(c_wrapped_standard, '\s+', ' ', 'g') THEN
      RAISE EXCEPTION
        'the trio policy on "%" is not in the wrapped form this migration assumes it already '
        'holds. This sweep excludes Post/PostContent/PostMedia because 20260910000000 '
        'rewrote them; if that migration was rolled back, re-apply it before sweeping, or the '
        'catalog ends 58/61 uniform and reads as finished. catalog holds USING: %',
        r.relname, r.qual;
    END IF;
  END LOOP;
  IF v_trio <> c_expect_trio THEN
    RAISE EXCEPTION
      'the exclusion predicate matched % trio policies, expected %. The sweep counts below '
      'are derived from that exclusion, so a different number means the enrollment moved '
      'under the trio and the 58 is no longer 58.',
      v_trio, c_expect_trio;
  END IF;

  ---------------------------------------------------------------------------
  -- The sweep.
  ---------------------------------------------------------------------------
  FOR r IN
    SELECT n.nspname,
           c.relname,
           pg_get_expr(p.polqual, p.polrelid) AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS with_check,
           (p.polwithcheck IS NULL) AS declares_no_with_check,
           p.polpermissive,
           p.polcmd,
           p.polroles
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.polname = 'tenant_isolation'
      AND NOT (c.relname = ANY (c_trio))
    ORDER BY n.nspname, c.relname
  LOOP
    v_found := v_found + 1;

    -- The three members of the 5-tuple this migration does NOT move. ALTER POLICY cannot
    -- change them, so this is not a guard on what follows — it is a guard on what came
    -- BEFORE: a policy that is already RESTRICTIVE, or scoped to a command or a role, is not
    -- the object these constants describe and must not be swept as if it were.
    IF NOT r.polpermissive OR r.polcmd <> '*' OR r.polroles <> '{0}'::oid[] THEN
      RAISE EXCEPTION
        'the tenant_isolation policy on "%"."%" is not PERMISSIVE/ALL/PUBLIC (permissive=%, '
        'cmd=%, roles=%). Every enrolled policy was installed that way; one that is not was '
        'installed for a reason this sweep does not know, and rewriting its body would carry '
        'that reason along unexamined.',
        r.nspname, r.relname, r.polpermissive, r.polcmd, r.polroles;
    END IF;

    -- Branch on the PRE-IMAGE, then cross-check the name against it.
    IF regexp_replace(r.qual, '\s+', ' ', 'g') = regexp_replace(c_bare_standard, '\s+', ' ', 'g') THEN
      IF r.relname = c_variant_table THEN
        RAISE EXCEPTION
          '"%" holds the STANDARD two-arm body, but it is the global-template table and is '
          'expected to carry the third disjunct ("accountId" IS NULL). Its third arm is what '
          'makes global templates visible to every tenant; it was already missing before this '
          'migration ran, so the sweep stops rather than freezing the loss into the new form.',
          r.relname;
      END IF;
      v_using := c_target_standard;
      v_standard := v_standard + 1;

    ELSIF regexp_replace(r.qual, '\s+', ' ', 'g') = regexp_replace(c_bare_variant, '\s+', ' ', 'g') THEN
      IF r.relname <> c_variant_table THEN
        RAISE EXCEPTION
          '"%"."%" carries the three-arm body that only "%" is known to have. A second '
          'NULL-visible table is a deliberate product decision this migration has never been '
          'told about; sweeping it through the standard branch would delete that third arm '
          'and no row-digest bound to a tenant would notice.',
          r.nspname, r.relname, c_variant_table;
      END IF;
      v_using := c_target_variant;
      v_variant := v_variant + 1;

    ELSE
      RAISE EXCEPTION
        'the tenant_isolation policy on "%"."%" holds a body this migration does not '
        'recognise, so it has no target form to be rewritten INTO. Nothing was changed. '
        'catalog holds USING: %',
        r.nspname, r.relname, r.qual;
    END IF;

    -- WITH CHECK. Strict two-arm for BOTH branches — reading a global template is everyone's,
    -- writing one is `__system__`'s — and emitted only where one is already declared.
    IF r.declares_no_with_check THEN
      v_no_with_check := v_no_with_check + 1;
      EXECUTE format(
        'ALTER POLICY tenant_isolation ON %I.%I USING (%s)',
        r.nspname, r.relname, v_using
      );
    ELSE
      IF regexp_replace(r.with_check, '\s+', ' ', 'g')
         <> regexp_replace(c_bare_standard, '\s+', ' ', 'g') THEN
        RAISE EXCEPTION
          'the tenant_isolation policy on "%"."%" declares a WITH CHECK this migration does '
          'not recognise. Every enrolled policy, variant included, gates mutation with the '
          'strict two-arm body; rewriting an unrecognised one to the strict form could tighten '
          'or loosen a write path deliberately set elsewhere. catalog holds WITH CHECK: %',
          r.nspname, r.relname, r.with_check;
      END IF;
      EXECUTE format(
        'ALTER POLICY tenant_isolation ON %I.%I USING (%s) WITH CHECK (%s)',
        r.nspname, r.relname, v_using, c_target_standard
      );
    END IF;

    v_rewritten := v_rewritten + 1;
  END LOOP;

  ---------------------------------------------------------------------------
  -- Count assertions. rewritten = found = 58, and the split inside it.
  ---------------------------------------------------------------------------
  IF v_found <> c_expect_found THEN
    RAISE EXCEPTION
      'the sweep enumerated % policies, expected %. % total minus % already-wrapped trio '
      'policies is %; a different number means the enrollment moved and the evidence pass '
      'for this migration covered a different set than the one being rewritten.',
      v_found, c_expect_found, c_expect_total, c_expect_trio, c_expect_found;
  END IF;
  IF v_rewritten <> v_found THEN
    RAISE EXCEPTION
      'the sweep rewrote % of the % policies it found. A partial sweep leaves a catalog that '
      'is neither the old form nor the new one and that no gate can describe.',
      v_rewritten, v_found;
  END IF;
  IF v_standard <> c_expect_standard OR v_variant <> c_expect_variant THEN
    RAISE EXCEPTION
      'the branch split is %/% (standard/variant), expected %/%. The totals can be right '
      'while the split is wrong — that is exactly the shape of a variant swept through the '
      'standard branch — so the split is asserted separately rather than inferred from the '
      'total.',
      v_standard, v_variant, c_expect_standard, c_expect_variant;
  END IF;

  ---------------------------------------------------------------------------
  -- Postcondition 1: the variant kept its third disjunct, and nothing else grew one.
  --
  -- Read back from the catalog, not from the branch counter above: the counter says which
  -- body was SENT, this says which body the database now HOLDS.
  ---------------------------------------------------------------------------
  SELECT string_agg(format('%s.%s', n.nspname, c.relname), ', ' ORDER BY c.relname)
    INTO v_offenders
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE p.polname = 'tenant_isolation'
    AND (pg_get_expr(p.polqual, p.polrelid) LIKE '%IS NULL%') <> (c.relname = c_variant_table);
  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'after the rewrite, the set of policies whose USING carries an IS NULL disjunct is not '
      'exactly {%}. Divergent: %. The variant losing its third arm returns identical rows to '
      'every bound tenant and would ship green.',
      c_variant_table, v_offenders;
  END IF;

  ---------------------------------------------------------------------------
  -- Postcondition 2: every GUC read in every enrolled policy is now hoisted.
  --
  -- The same rule the form-uniformity gate will apply from the test suite, applied here so
  -- the migration cannot commit a state that gate would red-line. A HALF-wrapped policy still
  -- pays the per-row cost on its bare arm and would satisfy any "contains a sub-select" check.
  ---------------------------------------------------------------------------
  FOR r IN
    SELECT n.nspname,
           c.relname,
           pg_get_expr(p.polqual, p.polrelid) AS qual,
           coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS with_check
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.polname = 'tenant_isolation'
    ORDER BY n.nspname, c.relname
  LOOP
    v_reads := (SELECT count(*) FROM regexp_matches(r.qual || ' ' || r.with_check,
                                                    'current_setting\s*\(', 'gi'));
    v_hoisted := (SELECT count(*) FROM regexp_matches(r.qual || ' ' || r.with_check,
                                                      '\(\s*SELECT\s+current_setting\s*\(', 'gi'));
    IF v_reads = 0 OR v_reads <> v_hoisted THEN
      RAISE EXCEPTION
        'the tenant_isolation policy on "%"."%" holds % GUC read(s) of which % are hoisted. '
        'Every read in both clauses must sit inside a sub-select, or the policy still pays '
        'per row on whichever arm was left bare. USING: % / WITH CHECK: %',
        r.nspname, r.relname, v_reads, v_hoisted, r.qual, r.with_check;
    END IF;
  END LOOP;

  RAISE NOTICE
    'tenant_isolation sweep: % policies rewritten (% standard, % variant), % trio policies '
    'already wrapped, % policies declaring no WITH CHECK, % enrolled and uniform.',
    v_rewritten, v_standard, v_variant, v_trio, v_no_with_check, v_total;
END
$sweep$;
