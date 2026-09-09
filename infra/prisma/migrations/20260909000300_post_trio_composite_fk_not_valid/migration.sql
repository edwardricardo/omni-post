-- Tenant column for the Post trio, step 4 of 6: swap each single-column parent FK for the
-- composite tenant FK. This is the migration that turns the guarantee on.
--
-- WHAT CHANGES. Today "Post" references "Project"(id) and the two children reference
-- "Post"(id); the tenant is not part of any of those keys, so nothing at the engine level
-- stops a post from being written into another account's project. After this file the
-- reference is (parentFk, "accountId") -> parent(id, "accountId"), so a row whose tenant
-- disagrees with its parent's is refused by PostgreSQL itself — independently of the ORM
-- guard, independently of RLS, and independently of whether the connecting role holds
-- BYPASSRLS.
--
-- ON UPDATE NO ACTION, NOT THE PRISMA DEFAULT CASCADE. Under CASCADE, re-pointing a
-- project's "accountId" would silently rewrite the tenant key of every post beneath it —
-- a whole subtree changing owner with no application code involved and no error. Under NO
-- ACTION that UPDATE is refused while children reference the row, which keeps a tenant
-- move loud. The integration suite pins this directly ("project accountId update is
-- refused while posts reference it"); it is the one arm whose pre-migration failure is a
-- SUCCESS rather than an error, because today the constraint being replaced here is
-- ON UPDATE CASCADE.
--
-- ON DELETE CASCADE is inherited unchanged from the adjudicated convention for required-FK
-- owned children (docs/architecture/schema-conventions.md, "Choosing the ON DELETE
-- action"): soft delete is the product path, and this fires only on an administrative hard
-- delete.
--
-- NOT VALID, AND WHAT IT DOES AND DOES NOT BUY. NOT VALID skips the scan of existing rows,
-- so each ADD is catalog-only and the whole file is milliseconds. The constraint is
-- nevertheless FULLY LIVE FOR NEW WRITES the moment it is added — it is only the
-- historical rows that are not yet proven to satisfy it. Step 5 validates them under a
-- weaker lock. Until that runs, the guarantee is forward-only and must never be reported
-- as covering existing data; the suite asserts `convalidated` for exactly this reason.
--
-- CONSTRAINT NAMES. The dropped names are the real ones currently in the database
-- (`Post_projectId_fkey`, `PostContent_postId_fkey`, `PostMedia_postId_fkey`, last
-- rewritten by 20260830220417_ondelete_convention_alignment). The added names are the ones
-- `prisma migrate dev` derives from the composite relations, so the schema and the
-- migration history agree.
--
-- LOCKS. Each DROP + ADD pair takes ACCESS EXCLUSIVE on both child and parent for the
-- catalog update only. An abort rolls the whole file back and leaves a failed ledger row:
-- recover with `migrate resolve --rolled-back`, never a bare re-run.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "Post" DROP CONSTRAINT "Post_projectId_fkey";
ALTER TABLE "Post" ADD CONSTRAINT "Post_projectId_accountId_fkey"
  FOREIGN KEY ("projectId", "accountId") REFERENCES "Project" ("id", "accountId")
  ON UPDATE NO ACTION ON DELETE CASCADE NOT VALID;

ALTER TABLE "PostContent" DROP CONSTRAINT "PostContent_postId_fkey";
ALTER TABLE "PostContent" ADD CONSTRAINT "PostContent_postId_accountId_fkey"
  FOREIGN KEY ("postId", "accountId") REFERENCES "Post" ("id", "accountId")
  ON UPDATE NO ACTION ON DELETE CASCADE NOT VALID;

ALTER TABLE "PostMedia" DROP CONSTRAINT "PostMedia_postId_fkey";
ALTER TABLE "PostMedia" ADD CONSTRAINT "PostMedia_postId_accountId_fkey"
  FOREIGN KEY ("postId", "accountId") REFERENCES "Post" ("id", "accountId")
  ON UPDATE NO ACTION ON DELETE CASCADE NOT VALID;
