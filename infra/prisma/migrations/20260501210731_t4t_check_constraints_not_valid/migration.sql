-- Add 13 CHECK constraints as NOT VALID. New writes are enforced from this
-- migration onwards; legacy data is exempted until VALIDATE CONSTRAINT runs
-- in a later migration after a data-integrity audit.

-- Account: trial date range
ALTER TABLE "Account"
    ADD CONSTRAINT "Account_trial_date_range_check"
    CHECK ("trialStartDate" IS NULL OR "trialEndDate" IS NULL OR "trialStartDate" <= "trialEndDate")
    NOT VALID;

-- VideoSegment: video timestamp range
ALTER TABLE "VideoSegment"
    ADD CONSTRAINT "VideoSegment_time_range_check"
    CHECK ("startTime" <= "endTime")
    NOT VALID;

-- InstagramAnalytics: period date range
ALTER TABLE "InstagramAnalytics"
    ADD CONSTRAINT "InstagramAnalytics_period_range_check"
    CHECK ("periodStart" <= "periodEnd")
    NOT VALID;

-- ABTest: experiment date range
ALTER TABLE "ABTest"
    ADD CONSTRAINT "ABTest_date_range_check"
    CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate")
    NOT VALID;

-- TemplateAnalytics: query date range
ALTER TABLE "TemplateAnalytics"
    ADD CONSTRAINT "TemplateAnalytics_date_range_check"
    CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate")
    NOT VALID;

-- Campaign: campaign date range
ALTER TABLE "Campaign"
    ADD CONSTRAINT "Campaign_date_range_check"
    CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate")
    NOT VALID;

-- RecurringPost: schedule date range
ALTER TABLE "RecurringPost"
    ADD CONSTRAINT "RecurringPost_date_range_check"
    CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate")
    NOT VALID;

-- CustomReport: dateRange filter
ALTER TABLE "CustomReport"
    ADD CONSTRAINT "CustomReport_date_range_check"
    CHECK ("dateRangeStart" IS NULL OR "dateRangeEnd" IS NULL OR "dateRangeStart" <= "dateRangeEnd")
    NOT VALID;

-- ProviderPricingTier: provider count tier
ALTER TABLE "ProviderPricingTier"
    ADD CONSTRAINT "ProviderPricingTier_count_range_check"
    CHECK ("minProviders" <= "maxProviders")
    NOT VALID;

-- AccountPricingTier: account count tier
ALTER TABLE "AccountPricingTier"
    ADD CONSTRAINT "AccountPricingTier_count_range_check"
    CHECK ("minAccounts" <= "maxAccounts")
    NOT VALID;

-- AccountSubscription: billing period range
ALTER TABLE "AccountSubscription"
    ADD CONSTRAINT "AccountSubscription_period_range_check"
    CHECK ("currentPeriodStart" <= "currentPeriodEnd")
    NOT VALID;

-- Invoice: billing period range
ALTER TABLE "Invoice"
    ADD CONSTRAINT "Invoice_period_range_check"
    CHECK ("periodStart" <= "periodEnd")
    NOT VALID;

-- SystemAnnouncement: announcement window
ALTER TABLE "SystemAnnouncement"
    ADD CONSTRAINT "SystemAnnouncement_window_range_check"
    CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "startsAt" <= "endsAt")
    NOT VALID;
