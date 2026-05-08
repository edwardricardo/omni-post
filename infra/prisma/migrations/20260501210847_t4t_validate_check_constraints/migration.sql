-- Validate the 13 CHECK constraints added with NOT VALID in the previous
-- migration. Data audit performed pre-migration: 0 violations across all
-- 13 tables. Validation now blocks future writes that would violate the
-- range invariants on legacy rows as well as new ones.

ALTER TABLE "Account" VALIDATE CONSTRAINT "Account_trial_date_range_check";
ALTER TABLE "VideoSegment" VALIDATE CONSTRAINT "VideoSegment_time_range_check";
ALTER TABLE "InstagramAnalytics" VALIDATE CONSTRAINT "InstagramAnalytics_period_range_check";
ALTER TABLE "ABTest" VALIDATE CONSTRAINT "ABTest_date_range_check";
ALTER TABLE "TemplateAnalytics" VALIDATE CONSTRAINT "TemplateAnalytics_date_range_check";
ALTER TABLE "Campaign" VALIDATE CONSTRAINT "Campaign_date_range_check";
ALTER TABLE "RecurringPost" VALIDATE CONSTRAINT "RecurringPost_date_range_check";
ALTER TABLE "CustomReport" VALIDATE CONSTRAINT "CustomReport_date_range_check";
ALTER TABLE "ProviderPricingTier" VALIDATE CONSTRAINT "ProviderPricingTier_count_range_check";
ALTER TABLE "AccountPricingTier" VALIDATE CONSTRAINT "AccountPricingTier_count_range_check";
ALTER TABLE "AccountSubscription" VALIDATE CONSTRAINT "AccountSubscription_period_range_check";
ALTER TABLE "Invoice" VALIDATE CONSTRAINT "Invoice_period_range_check";
ALTER TABLE "SystemAnnouncement" VALIDATE CONSTRAINT "SystemAnnouncement_window_range_check";
