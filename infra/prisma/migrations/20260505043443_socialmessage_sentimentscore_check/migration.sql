-- Defense-in-depth: enforce sentiment polarity range [-1.00, 1.00] at DB level.
-- Code already validates via Math.max(-1, Math.min(1, ...)) in TriageInboxMessageUseCase,
-- but DB-level CHECK protects against direct INSERT/UPDATE bypassing application layer
-- (raw SQL, future workers, manual ops).

ALTER TABLE "SocialMessage"
  ADD CONSTRAINT "SocialMessage_sentimentScore_range_check"
  CHECK ("sentimentScore" IS NULL OR "sentimentScore" BETWEEN -1.00 AND 1.00);
