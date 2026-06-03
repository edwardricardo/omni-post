-- Drop the old single-column index; the new unique constraint provides equivalent indexability.
DROP INDEX IF EXISTS "RepurposeProposal_sourcePostId_idx";

-- Add unique constraint to prevent duplicate proposals for the same source post within an account.
-- Backs the idempotency guarantee of DetectRepurposeCandidatesUseCase (closes the TOCTOU window
-- between proposalExistsForPost check and createProposal insert).
ALTER TABLE "RepurposeProposal"
  ADD CONSTRAINT "RepurposeProposal_accountId_sourcePostId_key"
  UNIQUE ("accountId", "sourcePostId");
