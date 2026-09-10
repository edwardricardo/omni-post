-- Rollback for 20260910000200_rls_initplan_sweep (operator-run; Prisma never applies this).
-- Restores the 58 non-trio `tenant_isolation` policies to their unwrapped bodies.
--
-- SCOPE. This reverses THAT migration only, and only its 58 policies. RLS stays ENABLED on
-- every table and every policy stays installed — only the bodies revert, so a plan regression
-- traced to the wrapped form can be backed out WITHOUT reopening cross-tenant reads for one
-- second, which is what dropping or disabling the policies would do. The Post trio is NOT
-- touched: its form belongs to 20260910000000 and reverts through that migration's own
-- down.sql. Running this one leaves a catalog that is 3/61 wrapped, which is exactly the
-- state the sweep found and is therefore the honest inverse.
--
-- THE RESTORED BODIES ARE THE INSTALLING MIGRATIONS' BYTES, not a paraphrase: the standard
-- form is the body 20260527000000_add_rls_tenant_isolation built for its 50-table loop (and
-- the nine later per-table RLS migrations repeated), and the variant is
-- 20260527000000:151-160 verbatim. What a catalog comparison after this rollback matches is
-- the DEPARSED form, because the catalog stores a parse tree rather than source text — the
-- source whitespace of the various installing migrations differs and their deparsed output
-- does not, which is why the assertions below compare `pg_get_expr` output and not bytes.
--
-- WHAT REVERTING COSTS. The unwrapped body re-evaluates `current_setting('app.account_id',
-- true)` once per candidate row. On the ONE corpus this repo can measure — the Post trio —
-- that was roughly a 2.26x scan-node penalty on the row-scanning reads
-- (docs/reports/TENANT_RLS_AB_MEASUREMENT.md). That number is NOT claimed for these 58:
-- most of these tables are empty on every corpus available and their timings were never
-- measured. What IS known for all 58 is that both bodies admit exactly the same rows in all
-- three GUC states, which is what makes this rollback safe to take.
--
-- SYMMETRY IS THE POINT. This script carries the SAME structure as the forward migration —
-- enumeration from the live catalog, a pre-image check per policy, an explicit variant
-- branch, a `polwithcheck IS NULL` branch, and the same count assertions — because a
-- rollback that is verified less thoroughly than the change it reverses is not reversibility,
-- it is a second, unreviewed migration.
--
-- `ALTER POLICY` FAILS ON A MISSING POLICY, DELIBERATELY. There is no `IF EXISTS` form and
-- none is wanted: this script's target state is "the bare policy present", so a policy that
-- is absent when the rollback runs is enrollment drift, and a form that swallowed it would
-- report a clean rollback over a database whose enrollment nobody has verified.
--
-- ATOMICITY WITHOUT A WRAPPING TRANSACTION. A `DO` block is ONE statement, so even run bare
-- from psql it commits or rolls back as a unit: any RAISE below leaves all 58 policies as
-- they were found. That is why the assertions are inside the block rather than around it.

-- Session-level SET, not SET LOCAL: this script is operator-run and is not guaranteed a
-- wrapping transaction, where SET LOCAL would warn and no-op. Values mirror the forward
-- migration. ALTER POLICY takes ACCESS EXCLUSIVE on the table briefly; `lock_timeout` bounds
-- the wait behind a long-running query, not the hold.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $sweep$
DECLARE
  -- The restored bodies — the installing migrations' bytes.
  c_target_standard CONSTANT text := $body$
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  $body$;

  -- The variant's USING keeps its third disjunct on the way back too. A rollback that
  -- returned "AIPromptTemplate" to the STANDARD bare body would revoke global-template
  -- visibility from every tenant while looking like a faithful revert.
  c_target_variant CONSTANT text := $body$
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
    OR "accountId" IS NULL
  $body$;

  -- The expected PRE-images: what the forward migration installed, as this server deparses
  -- it. Compared after whitespace collapse only.
  c_wrapped_standard CONSTANT text :=
    $pre$((( SELECT current_setting('app.account_id'::text, true) AS current_setting) = '__system__'::text) OR ("accountId" = ( SELECT current_setting('app.account_id'::text, true) AS current_setting)))$pre$;
  c_wrapped_variant CONSTANT text :=
    $pre$((( SELECT current_setting('app.account_id'::text, true) AS current_setting) = '__system__'::text) OR ("accountId" = ( SELECT current_setting('app.account_id'::text, true) AS current_setting)) OR ("accountId" IS NULL))$pre$;

  c_trio CONSTANT text[] := ARRAY['Post', 'PostContent', 'PostMedia'];
  c_variant_table CONSTANT text := 'AIPromptTemplate';

  c_expect_total CONSTANT int := 61;
  c_expect_found CONSTANT int := 58;
  c_expect_standard CONSTANT int := 57;
  c_expect_variant CONSTANT int := 1;

  r record;
  v_total int;
  v_found int := 0;
  v_restored int := 0;
  v_standard int := 0;
  v_variant int := 0;
  v_no_with_check int := 0;
  v_using text;
  v_still_wrapped int;
  v_trio_wrapped int;
  v_offenders text;
BEGIN
  SELECT count(*) INTO v_total FROM pg_policy WHERE polname = 'tenant_isolation';
  IF v_total <> c_expect_total THEN
    RAISE EXCEPTION
      'tenant_isolation enrollment is % policies, expected %. This rollback reverses a '
      'migration that swept a population of %; against any other number its counts are '
      'meaningless and it would restore a set nobody can name.',
      v_total, c_expect_total, c_expect_total;
  END IF;

  FOR r IN
    SELECT n.nspname,
           c.relname,
           pg_get_expr(p.polqual, p.polrelid) AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS with_check,
           (p.polwithcheck IS NULL) AS declares_no_with_check
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.polname = 'tenant_isolation'
      AND NOT (c.relname = ANY (c_trio))
    ORDER BY n.nspname, c.relname
  LOOP
    v_found := v_found + 1;

    IF regexp_replace(r.qual, '\s+', ' ', 'g') = regexp_replace(c_wrapped_standard, '\s+', ' ', 'g') THEN
      IF r.relname = c_variant_table THEN
        RAISE EXCEPTION
          '"%" holds the STANDARD wrapped body, but it is the global-template table and is '
          'expected to carry the third disjunct. Restoring it through the standard branch '
          'would make this rollback the thing that deleted the third arm.',
          r.relname;
      END IF;
      v_using := c_target_standard;
      v_standard := v_standard + 1;

    ELSIF regexp_replace(r.qual, '\s+', ' ', 'g') = regexp_replace(c_wrapped_variant, '\s+', ' ', 'g') THEN
      IF r.relname <> c_variant_table THEN
        RAISE EXCEPTION
          '"%"."%" carries the three-arm wrapped body that only "%" is known to have. '
          'Restoring it through the standard branch would delete that third arm.',
          r.nspname, r.relname, c_variant_table;
      END IF;
      v_using := c_target_variant;
      v_variant := v_variant + 1;

    ELSE
      RAISE EXCEPTION
        'the tenant_isolation policy on "%"."%" is not in the form the sweep installed, so '
        'this rollback has nothing to reverse there and no target form to restore. Either '
        'the sweep never ran on this database, or something else has since rewritten this '
        'policy. Nothing was changed. catalog holds USING: %',
        r.nspname, r.relname, r.qual;
    END IF;

    IF r.declares_no_with_check THEN
      v_no_with_check := v_no_with_check + 1;
      EXECUTE format(
        'ALTER POLICY tenant_isolation ON %I.%I USING (%s)',
        r.nspname, r.relname, v_using
      );
    ELSE
      IF regexp_replace(r.with_check, '\s+', ' ', 'g')
         <> regexp_replace(c_wrapped_standard, '\s+', ' ', 'g') THEN
        RAISE EXCEPTION
          'the tenant_isolation policy on "%"."%" declares a WITH CHECK the sweep did not '
          'install. Restoring it to the strict bare body could loosen or tighten a write '
          'path set somewhere else. catalog holds WITH CHECK: %',
          r.nspname, r.relname, r.with_check;
      END IF;
      EXECUTE format(
        'ALTER POLICY tenant_isolation ON %I.%I USING (%s) WITH CHECK (%s)',
        r.nspname, r.relname, v_using, c_target_standard
      );
    END IF;

    v_restored := v_restored + 1;
  END LOOP;

  IF v_found <> c_expect_found THEN
    RAISE EXCEPTION 'the rollback enumerated % policies, expected %.', v_found, c_expect_found;
  END IF;
  IF v_restored <> v_found THEN
    RAISE EXCEPTION
      'the rollback restored % of the % policies it found. A partial rollback leaves a '
      'catalog in neither form.',
      v_restored, v_found;
  END IF;
  IF v_standard <> c_expect_standard OR v_variant <> c_expect_variant THEN
    RAISE EXCEPTION
      'the branch split is %/% (standard/variant), expected %/%.',
      v_standard, v_variant, c_expect_standard, c_expect_variant;
  END IF;

  -- Postcondition 1: the variant still carries its third disjunct, and nothing else does.
  SELECT string_agg(format('%s.%s', n.nspname, c.relname), ', ' ORDER BY c.relname)
    INTO v_offenders
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE p.polname = 'tenant_isolation'
    AND (pg_get_expr(p.polqual, p.polrelid) LIKE '%IS NULL%') <> (c.relname = c_variant_table);
  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'after the rollback, the set of policies whose USING carries an IS NULL disjunct is '
      'not exactly {%}. Divergent: %.',
      c_variant_table, v_offenders;
  END IF;

  -- Postcondition 2: the 58 are bare again and the trio is untouched. Both halves matter —
  -- a rollback that also reverted the trio would silently undo a migration nobody asked it
  -- to touch, and one that left a swept policy wrapped would leave the catalog mixed.
  SELECT count(*) FILTER (WHERE NOT (c.relname = ANY (c_trio))
                            AND pg_get_expr(p.polqual, p.polrelid) ~* '\(\s*SELECT\s+current_setting\s*\('),
         count(*) FILTER (WHERE c.relname = ANY (c_trio)
                            AND pg_get_expr(p.polqual, p.polrelid) ~* '\(\s*SELECT\s+current_setting\s*\(')
    INTO v_still_wrapped, v_trio_wrapped
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  WHERE p.polname = 'tenant_isolation';

  IF v_still_wrapped <> 0 THEN
    RAISE EXCEPTION
      '% swept policies still hold a hoisted GUC read after the rollback.', v_still_wrapped;
  END IF;
  IF v_trio_wrapped <> 3 THEN
    RAISE EXCEPTION
      'the Post trio holds % wrapped policies, expected 3. This rollback must not touch the '
      'trio; its form belongs to 20260910000000 and reverts through that migration.',
      v_trio_wrapped;
  END IF;

  RAISE NOTICE
    'tenant_isolation sweep rollback: % policies restored to the bare form (% standard, '
    '% variant), % declaring no WITH CHECK; trio left wrapped (%).',
    v_restored, v_standard, v_variant, v_no_with_check, v_trio_wrapped;
END
$sweep$;
