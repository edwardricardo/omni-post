/**
 * @file insightsHelpers.ts
 * @description Helper/utility functions for processing Facebook Insights API data.
 * Extracted from FacebookInsightsApi to keep each file under 600 lines.
 * These are pure data-processing functions with no API calls.
 */

/**
 * Extract metric value from an insights data array by metric name.
 */
export function getMetricValue(insights: any[], metricName: string): number {
  const metric = insights.find((m) => m.name === metricName);
  if (!metric || !metric.values || metric.values.length === 0) {
    return 0;
  }

  const latestValue = metric.values[metric.values.length - 1];
  return latestValue.value || 0;
}

/**
 * Process demographics data (age/gender, country, city, locale) from page insights.
 */
export function processDemographicsData(insights: any[]): any {
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
export function processActivityData(insights: any[]): any {
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
export function processFanAcquisitionData(insights: any[]): any {
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
export function processAgeGenderData(metric: any): any {
  if (!metric?.values?.[0]?.value) return {};

  const ageGroups: any = {};
  const data = metric.values[0].value;

  Object.entries(data).forEach(([key, value]) => {
    const parts = (key as string).split(".");
    const ageRange = parts[0];
    const gender = parts[1];
    if (!ageRange || !gender) return;
    if (!ageGroups[ageRange]) {
      ageGroups[ageRange] = { male: 0, female: 0, unknown: 0 };
    }
    ageGroups[ageRange][gender as "male" | "female" | "unknown"] = value as number;
  });

  return ageGroups;
}

/**
 * Aggregate gender totals from a page_fans_by_age_gender metric.
 */
export function processGenderData(metric: any): any {
  if (!metric?.values?.[0]?.value) return { male: 0, female: 0, unknown: 0 };

  const data = metric.values[0].value;
  const genders = { male: 0, female: 0, unknown: 0 };

  Object.entries(data).forEach(([key, value]) => {
    const genderStr = (key as string).split(".")[1];
    if (!genderStr) return;
    const gender = genderStr as "male" | "female" | "unknown";
    genders[gender] += value as number;
  });

  return genders;
}

/**
 * Extract the latest value object from a metric (generic helper).
 */
export function processMetricData(metric: any): any {
  if (!metric?.values?.[0]?.value) return {};
  return metric.values[0].value;
}

/**
 * Extract peak hours from page_fans_online metric.
 */
export function processPeakHours(metric: any): any[] {
  if (!metric?.values?.[0]?.value) return [];

  const data = metric.values[0].value;
  return Object.entries(data).map(([timeKey, activity]) => {
    const parts = (timeKey as string).split("_");
    const day = parts[0] ?? "";
    const hour = parts[1] ?? "0";
    return {
      hour: parseInt(hour),
      day,
      activity: activity as number,
    };
  });
}

/**
 * Extract peak days from page_fans_online_per_day metric.
 */
export function processPeakDays(metric: any): any[] {
  if (!metric?.values) return [];

  return metric.values.map((value: any) => ({
    day: value.end_time,
    activity: value.value || 0,
  }));
}

/**
 * Extract likes sources (organic / paid / viral) from metric.
 */
export function processLikesSources(metric: any): any {
  if (!metric?.values?.[0]?.value) return { organic: 0, paid: 0, viral: 0 };

  const data = metric.values[0].value;
  return {
    organic: data.organic || 0,
    paid: data.paid || 0,
    viral: data.viral || 0,
  };
}

/**
 * Process raw post insights into a flat object.
 */
export function processPostInsights(insights: any[]): any {
  const result: any = {
    reach: getMetricValue(insights, "post_reach"),
    impressions: getMetricValue(insights, "post_impressions"),
    clicks: getMetricValue(insights, "post_clicks"),
    videoViews: getMetricValue(insights, "post_video_views"),
    reactions: {},
  };

  const reactionsMetric = insights.find((m) => m.name === "post_reactions_by_type_total");
  if (reactionsMetric?.values?.[0]?.value) {
    result.reactions = reactionsMetric.values[0].value;
  }

  return result;
}

/**
 * Calculate summary statistics from an array of post insights.
 */
export function calculateContentSummary(posts: any[]): any {
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
export function categorizeContent(posts: any[]): any[] {
  const categories = posts.reduce((acc: any, post) => {
    const type = post.type || "status";
    if (!acc[type]) {
      acc[type] = { count: 0, totalEngagement: 0, totalReach: 0 };
    }
    acc[type].count++;
    acc[type].totalEngagement += post.engagements || 0;
    acc[type].totalReach += post.reach || 0;
    return acc;
  }, {});

  return Object.entries(categories).map(([category, data]: [string, any]) => ({
    category,
    postCount: data.count,
    avgEngagement: data.totalEngagement / data.count,
    avgReach: data.totalReach / data.count,
  }));
}

/**
 * Determine best posting time based on engagement totals.
 */
export function findBestPostingTime(posts: any[]): any {
  const hourCounts: any = {};
  const dayCounts: any = {};

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
    (max: any, [hour, engagements]: [string, any]) =>
      engagements > max.engagements ? { hour: parseInt(hour), engagements } : max,
    { hour: 0, engagements: 0 }
  );

  const bestDay = Object.entries(dayCounts).reduce(
    (max: any, [day, engagements]: [string, any]) =>
      engagements > max.engagements ? { day, engagements } : max,
    { day: "", engagements: 0 }
  );

  return {
    hour: bestHour.hour,
    day: bestDay.day,
  };
}

/**
 * Process video retention graph data into an array.
 */
export function processRetentionData(insights: any[]): any[] {
  const retentionMetric = insights.find((m) => m.name === "video_retention_graph");
  if (!retentionMetric?.values?.[0]?.value) return [];

  return Object.entries(retentionMetric.values[0].value).map(([timestamp, percentage]) => ({
    timestamp: parseInt(timestamp),
    percentage: percentage as number,
  }));
}

/**
 * Identify significant drop-off points (>10 pp drop between consecutive timestamps).
 */
export function calculateDropOffPoints(insights: any[]): any[] {
  const retention = processRetentionData(insights);
  const dropOffs = [];

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
export function processVideoDemographics(insights: any[]): any {
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
export function calculateAverageEngagement(posts: any[]): number {
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
export function calculatePostFrequency(posts: any[]): number {
  if (posts.length === 0) return 0;

  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const recentPosts = posts.filter((post) => {
    const postDate = new Date(post.created_time);
    return postDate >= oneWeekAgo;
  });

  return recentPosts.length;
}

/**
 * Analyse content types distribution from a set of posts.
 */
export function analyzeContentTypes(posts: any[]): any[] {
  const types: any = {};
  posts.forEach((post) => {
    const type = determineContentType(post);
    types[type] = (types[type] || 0) + 1;
  });

  const total = posts.length;
  return Object.entries(types).map(([type, count]) => ({
    type,
    percentage: total > 0 ? ((count as number) / total) * 100 : 0,
  }));
}

/**
 * Determine content type from post attachment data.
 */
export function determineContentType(post: any): string {
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
export function calculateBenchmarks(competitors: any[]): any {
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
export function identifyOpportunities(competitors: any[]): any[] {
  const opportunities = [];

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
