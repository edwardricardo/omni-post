/**
 * @file insightsHelpers.ts
 * @description Helper/utility functions for processing Facebook Insights API data.
 * Extracted from FacebookInsightsApi to keep each file under 600 lines.
 * These are pure data-processing functions with no API calls.
 */

/** Represents a single metric entry from Facebook Insights API. */
interface InsightMetric {
  name: string;
  values?: Array<{ value: unknown; end_time?: string }>;
}

/** A Facebook post object with engagement data. */
interface FacebookPostData {
  id?: string;
  type?: string;
  created_time?: string;
  reach?: number;
  engagements?: number;
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  shares?: { count?: number };
  attachments?: { data?: Array<{ type?: string }> };
}

/** A competitor data entry used for benchmarking. */
interface CompetitorData {
  avgEngagementRate: number;
  followers: number;
  postFrequency: number;
}

/** Processed age-group breakdown keyed by age range. */
interface AgeGroupBreakdown {
  [ageRange: string]: { male: number; female: number; unknown: number };
}

/** Gender totals. */
interface GenderTotals {
  male: number;
  female: number;
  unknown: number;
}

/** A peak hour/day entry. */
interface PeakEntry {
  hour?: number;
  day: string;
  activity: number;
}

/** Likes sources breakdown. */
interface LikesSources {
  organic: number;
  paid: number;
  viral: number;
}

/** Processed post insights. */
interface PostInsightsResult {
  reach: number;
  impressions: number;
  clicks: number;
  videoViews: number;
  reactions: Record<string, unknown>;
}

/** Content summary statistics. */
interface ContentSummary {
  totalPosts: number;
  avgReach: number;
  avgEngagements: number;
  avgEngagementRate: number;
  topPerformingPost: string;
  topPostType: string;
  bestPostingTime: { hour: number; day: string };
}

/** Content category statistics. */
interface ContentCategory {
  category: string;
  postCount: number;
  avgEngagement: number;
  avgReach: number;
}

/** Best posting time result. */
interface BestPostingTime {
  hour: number;
  day: string;
}

/** Retention data point. */
interface RetentionPoint {
  timestamp: number;
  percentage: number;
}

/** Drop-off data point. */
interface DropOffPoint {
  timestamp: number;
  dropOffRate: number;
}

/** Demographics result shape. */
interface DemographicsResult {
  ageGroups: AgeGroupBreakdown;
  genders: GenderTotals;
  countries: Record<string, unknown>;
  cities: Record<string, unknown>;
  locales: Record<string, unknown>;
}

/** Activity data result shape. */
interface ActivityResult {
  peakHours: PeakEntry[];
  peakDays: PeakEntry[];
  timeZones: Record<string, never>;
}

/** Fan acquisition data result. */
interface FanAcquisitionResult {
  totalNewLikes: number;
  totalUnlikes: number;
  netLikeChange: number;
  likesSources: LikesSources;
}

/** Video demographics result. */
interface VideoDemographicsResult {
  ageGroups: Record<string, unknown>;
  genders: Record<string, never>;
  countries: Record<string, unknown>;
  cities: Record<string, never>;
}

/** Benchmark result. */
interface BenchmarkResult {
  industryAvgEngagement: number;
  industryAvgFollowers: number;
  industryAvgPostFrequency: number;
  yourRanking: number;
}

/** Opportunity entry. */
interface OpportunityEntry {
  type: string;
  description: string;
  priority: string;
  estimatedImpact: number;
}

/** Content type distribution entry. */
interface ContentTypeEntry {
  type: string;
  percentage: number;
}

/** Internal accumulator for category aggregation. */
interface CategoryAccumulator {
  [type: string]: { count: number; totalEngagement: number; totalReach: number };
}

/** Internal accumulator for hour/day engagement tracking. */
interface EngagementAccumulator {
  [key: string]: number;
}

/** Internal accumulator for best hour/day reduction. */
interface BestAccumulator {
  hour?: number;
  day?: string;
  engagements: number;
}

/**
 * Extract metric value from an insights data array by metric name.
 */
export function getMetricValue(insights: InsightMetric[], metricName: string): number {
  const metric = insights.find((m) => m.name === metricName);
  if (!metric || !metric.values || metric.values.length === 0) {
    return 0;
  }

  const latestValue = metric.values[metric.values.length - 1];
  return (latestValue.value as number) || 0;
}

/**
 * Process demographics data (age/gender, country, city, locale) from page insights.
 */
export function processDemographicsData(insights: InsightMetric[]): DemographicsResult {
  const ageGenderMetric = insights.find((m) => m.name === "page_fans_by_age_gender");
  const countryMetric = insights.find((m) => m.name === "page_fans_by_country");
  const cityMetric = insights.find((m) => m.name === "page_fans_by_city");
  const localeMetric = insights.find((m) => m.name === "page_fans_by_locale");

  return {
    ageGroups: processAgeGenderData(ageGenderMetric),
    genders: processGenderData(ageGenderMetric),
    countries: processMetricData(countryMetric),
    cities: processMetricData(cityMetric),
    locales: processMetricData(localeMetric),
  };
}

/**
 * Process activity data (online hours, online per day) from page insights.
 */
export function processActivityData(insights: InsightMetric[]): ActivityResult {
  const onlineMetric = insights.find((m) => m.name === "page_fans_online");
  const onlinePerDayMetric = insights.find((m) => m.name === "page_fans_online_per_day");

  return {
    peakHours: processPeakHours(onlineMetric),
    peakDays: processPeakDays(onlinePerDayMetric),
    timeZones: {},
  };
}

/**
 * Process fan acquisition data (adds, removes, paid/non-paid).
 */
export function processFanAcquisitionData(insights: InsightMetric[]): FanAcquisitionResult {
  const fanAdds = getMetricValue(insights, "page_fan_adds");
  const fanRemoves = getMetricValue(insights, "page_fan_removes");
  const paidNonPaidMetric = insights.find((m) => m.name === "page_fan_adds_by_paid_non_paid");

  return {
    totalNewLikes: fanAdds,
    totalUnlikes: fanRemoves,
    netLikeChange: fanAdds - fanRemoves,
    likesSources: processLikesSources(paidNonPaidMetric),
  };
}

/**
 * Parse age+gender breakdown from a page_fans_by_age_gender metric.
 */
export function processAgeGenderData(metric: InsightMetric | undefined): AgeGroupBreakdown {
  if (!metric?.values?.[0]?.value) return {};

  const ageGroups: AgeGroupBreakdown = {};
  const data = metric.values[0].value as Record<string, number>;

  Object.entries(data).forEach(([key, value]) => {
    const parts = key.split(".");
    const ageRange = parts[0];
    const gender = parts[1];
    if (!ageRange || !gender) return;
    if (!ageGroups[ageRange]) {
      ageGroups[ageRange] = { male: 0, female: 0, unknown: 0 };
    }
    ageGroups[ageRange][gender as "male" | "female" | "unknown"] = value;
  });

  return ageGroups;
}

/**
 * Aggregate gender totals from a page_fans_by_age_gender metric.
 */
export function processGenderData(metric: InsightMetric | undefined): GenderTotals {
  if (!metric?.values?.[0]?.value) return { male: 0, female: 0, unknown: 0 };

  const data = metric.values[0].value as Record<string, number>;
  const genders: GenderTotals = { male: 0, female: 0, unknown: 0 };

  Object.entries(data).forEach(([key, value]) => {
    const genderStr = key.split(".")[1];
    if (!genderStr) return;
    const gender = genderStr as "male" | "female" | "unknown";
    genders[gender] += value;
  });

  return genders;
}

/**
 * Extract the latest value object from a metric (generic helper).
 */
export function processMetricData(metric: InsightMetric | undefined): Record<string, unknown> {
  if (!metric?.values?.[0]?.value) return {};
  return metric.values[0].value as Record<string, unknown>;
}

/**
 * Extract peak hours from page_fans_online metric.
 */
export function processPeakHours(metric: InsightMetric | undefined): PeakEntry[] {
  if (!metric?.values?.[0]?.value) return [];

  const data = metric.values[0].value as Record<string, number>;
  return Object.entries(data).map(([timeKey, activity]) => {
    const parts = timeKey.split("_");
    const day = parts[0] ?? "";
    const hour = parts[1] ?? "0";
    return {
      hour: parseInt(hour),
      day,
      activity,
    };
  });
}

/**
 * Extract peak days from page_fans_online_per_day metric.
 */
export function processPeakDays(metric: InsightMetric | undefined): PeakEntry[] {
  if (!metric?.values) return [];

  return metric.values.map((value) => ({
    day: (value.end_time as string) || "",
    activity: (value.value as number) || 0,
  }));
}

/**
 * Extract likes sources (organic / paid / viral) from metric.
 */
export function processLikesSources(metric: InsightMetric | undefined): LikesSources {
  if (!metric?.values?.[0]?.value) return { organic: 0, paid: 0, viral: 0 };

  const data = metric.values[0].value as Record<string, number>;
  return {
    organic: data.organic || 0,
    paid: data.paid || 0,
    viral: data.viral || 0,
  };
}

/**
 * Process raw post insights into a flat object.
 */
export function processPostInsights(insights: InsightMetric[]): PostInsightsResult {
  const result: PostInsightsResult = {
    reach: getMetricValue(insights, "post_reach"),
    impressions: getMetricValue(insights, "post_impressions"),
    clicks: getMetricValue(insights, "post_clicks"),
    videoViews: getMetricValue(insights, "post_video_views"),
    reactions: {},
  };

  const reactionsMetric = insights.find((m) => m.name === "post_reactions_by_type_total");
  if (reactionsMetric?.values?.[0]?.value) {
    result.reactions = reactionsMetric.values[0].value as Record<string, unknown>;
  }

  return result;
}

/**
 * Calculate summary statistics from an array of post insights.
 */
export function calculateContentSummary(posts: FacebookPostData[]): ContentSummary {
  if (posts.length === 0) {
    return {
      totalPosts: 0,
      avgReach: 0,
      avgEngagements: 0,
      avgEngagementRate: 0,
      topPerformingPost: "",
      topPostType: "",
      bestPostingTime: { hour: 0, day: "" },
    };
  }

  const totalReach = posts.reduce((sum, post) => sum + (post.reach || 0), 0);
  const totalEngagements = posts.reduce((sum, post) => sum + (post.engagements || 0), 0);

  const topPost = posts.reduce((max, post) =>
    (post.engagements || 0) > (max.engagements || 0) ? post : max
  );

  return {
    totalPosts: posts.length,
    avgReach: totalReach / posts.length,
    avgEngagements: totalEngagements / posts.length,
    avgEngagementRate: totalReach > 0 ? (totalEngagements / totalReach) * 100 : 0,
    topPerformingPost: topPost.id || "",
    topPostType: topPost.type || "",
    bestPostingTime: findBestPostingTime(posts),
  };
}

/**
 * Categorise content by post type and compute per-category averages.
 */
export function categorizeContent(posts: FacebookPostData[]): ContentCategory[] {
  const categories = posts.reduce((acc: CategoryAccumulator, post) => {
    const type = post.type || "status";
    if (!acc[type]) {
      acc[type] = { count: 0, totalEngagement: 0, totalReach: 0 };
    }
    acc[type].count++;
    acc[type].totalEngagement += post.engagements || 0;
    acc[type].totalReach += post.reach || 0;
    return acc;
  }, {});

  return Object.entries(categories).map(([category, data]) => ({
    category,
    postCount: data.count,
    avgEngagement: data.totalEngagement / data.count,
    avgReach: data.totalReach / data.count,
  }));
}

/**
 * Determine best posting time based on engagement totals.
 */
export function findBestPostingTime(posts: FacebookPostData[]): BestPostingTime {
  const hourCounts: EngagementAccumulator = {};
  const dayCounts: EngagementAccumulator = {};

  posts.forEach((post) => {
    if (post.created_time) {
      const date = new Date(post.created_time);
      const hour = date.getHours();
      const day = date.toLocaleDateString("en-US", { weekday: "long" });

      hourCounts[hour] = (hourCounts[hour] || 0) + (post.engagements || 0);
      dayCounts[day] = (dayCounts[day] || 0) + (post.engagements || 0);
    }
  });

  const bestHour = Object.entries(hourCounts).reduce(
    (max: BestAccumulator, [hour, engagements]: [string, number]) =>
      engagements > max.engagements ? { hour: parseInt(hour), engagements } : max,
    { hour: 0, engagements: 0 }
  );

  const bestDay = Object.entries(dayCounts).reduce(
    (max: BestAccumulator, [day, engagements]: [string, number]) =>
      engagements > max.engagements ? { day, engagements } : max,
    { day: "", engagements: 0 }
  );

  return {
    hour: bestHour.hour ?? 0,
    day: bestDay.day ?? "",
  };
}

/**
 * Process video retention graph data into an array.
 */
export function processRetentionData(insights: InsightMetric[]): RetentionPoint[] {
  const retentionMetric = insights.find((m) => m.name === "video_retention_graph");
  if (!retentionMetric?.values?.[0]?.value) return [];

  return Object.entries(retentionMetric.values[0].value as Record<string, number>).map(
    ([timestamp, percentage]) => ({
      timestamp: parseInt(timestamp),
      percentage,
    })
  );
}

/**
 * Identify significant drop-off points (>10 pp drop between consecutive timestamps).
 */
export function calculateDropOffPoints(insights: InsightMetric[]): DropOffPoint[] {
  const retention = processRetentionData(insights);
  const dropOffs: DropOffPoint[] = [];

  for (let i = 1; i < retention.length; i++) {
    const dropOff = retention[i - 1].percentage - retention[i].percentage;
    if (dropOff > 10) {
      dropOffs.push({
        timestamp: retention[i].timestamp,
        dropOffRate: dropOff,
      });
    }
  }

  return dropOffs;
}

/**
 * Process video demographics breakdown.
 */
export function processVideoDemographics(insights: InsightMetric[]): VideoDemographicsResult {
  const ageGenderMetric = insights.find(
    (m) => m.name === "video_view_time_by_age_bucket_and_gender"
  );
  const countryMetric = insights.find((m) => m.name === "video_view_time_by_country_id");

  return {
    ageGroups: processMetricData(ageGenderMetric),
    genders: {},
    countries: processMetricData(countryMetric),
    cities: {},
  };
}

/**
 * Calculate average engagement for a set of posts.
 */
export function calculateAverageEngagement(posts: FacebookPostData[]): number {
  if (posts.length === 0) return 0;

  const totalEngagements = posts.reduce((sum, post) => {
    const reactions = post.reactions?.summary?.total_count || 0;
    const comments = post.comments?.summary?.total_count || 0;
    const shares = post.shares?.count || 0;
    return sum + reactions + comments + shares;
  }, 0);

  return totalEngagements / posts.length;
}

/**
 * Count posts published in the last 7 days.
 */
export function calculatePostFrequency(posts: FacebookPostData[]): number {
  if (posts.length === 0) return 0;

  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const recentPosts = posts.filter((post) => {
    const postDate = new Date(post.created_time || 0);
    return postDate >= oneWeekAgo;
  });

  return recentPosts.length;
}

/**
 * Analyse content types distribution from a set of posts.
 */
export function analyzeContentTypes(posts: FacebookPostData[]): ContentTypeEntry[] {
  const types: EngagementAccumulator = {};
  posts.forEach((post) => {
    const type = determineContentType(post);
    types[type] = (types[type] || 0) + 1;
  });

  const total = posts.length;
  return Object.entries(types).map(([type, count]) => ({
    type,
    percentage: total > 0 ? (count / total) * 100 : 0,
  }));
}

/**
 * Determine content type from post attachment data.
 */
export function determineContentType(post: FacebookPostData): string {
  if (post.attachments?.data?.[0]) {
    const attachment = post.attachments.data[0];
    if (attachment.type === "photo") return "photo";
    if (attachment.type === "video_inline") return "video";
    if (attachment.type === "share") return "link";
  }
  return "text";
}

/**
 * Calculate benchmarks from competitor data.
 */
export function calculateBenchmarks(competitors: CompetitorData[]): BenchmarkResult {
  if (competitors.length === 0) {
    return {
      industryAvgEngagement: 0,
      industryAvgFollowers: 0,
      industryAvgPostFrequency: 0,
      yourRanking: 0,
    };
  }

  const avgEngagement =
    competitors.reduce((sum, comp) => sum + comp.avgEngagementRate, 0) / competitors.length;
  const avgFollowers =
    competitors.reduce((sum, comp) => sum + comp.followers, 0) / competitors.length;
  const avgPostFreq =
    competitors.reduce((sum, comp) => sum + comp.postFrequency, 0) / competitors.length;

  return {
    industryAvgEngagement: avgEngagement,
    industryAvgFollowers: avgFollowers,
    industryAvgPostFrequency: avgPostFreq,
    yourRanking: 1,
  };
}

/**
 * Identify opportunities from competitor analysis.
 */
export function identifyOpportunities(competitors: CompetitorData[]): OpportunityEntry[] {
  const opportunities: OpportunityEntry[] = [];

  const avgPostFreq =
    competitors.reduce((sum, comp) => sum + comp.postFrequency, 0) / competitors.length;
  if (avgPostFreq > 5) {
    opportunities.push({
      type: "content_gap",
      description:
        "Competitors are posting more frequently. Consider increasing your posting schedule.",
      priority: "medium",
      estimatedImpact: 15,
    });
  }

  return opportunities;
}
