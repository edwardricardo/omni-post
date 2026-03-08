export interface DeveloperMetrics {
  timestamp: string;
  period: "daily" | "weekly" | "monthly";
  developer: string;
  repository: string;
  productivity: ProductivityMetrics;
  code_quality: CodeQualityMetrics;
  collaboration: CollaborationMetrics;
  learning: LearningMetrics;
}

export interface ProductivityMetrics {
  commits_count: number;
  lines_added: number;
  lines_removed: number;
  files_modified: number;
  avg_commit_size: number;
  coding_time_hours: number;
  feature_completion_rate: number;
  bug_fix_count: number;
  review_speed_hours: number;
}

export interface CodeQualityMetrics {
  test_coverage_contributed: number;
  complexity_score: number;
  code_review_feedback: number;
  documentation_updates: number;
  refactoring_commits: number;
  technical_debt_reduction: number;
  security_fixes: number;
}

export interface CollaborationMetrics {
  pull_requests_created: number;
  pull_requests_reviewed: number;
  code_review_comments: number;
  knowledge_sharing_commits: number;
  pair_programming_sessions: number;
  mentoring_interactions: number;
}

export interface LearningMetrics {
  new_technologies_used: string[];
  documentation_read: number;
  best_practices_adopted: number;
  skill_improvement_areas: string[];
  training_completion: number;
}

export interface TeamMetrics {
  timestamp: string;
  team_size: number;
  velocity: VelocityMetrics;
  quality_trends: QualityTrends;
  collaboration_health: CollaborationHealth;
  productivity_distribution: ProductivityDistribution;
}

export interface VelocityMetrics {
  story_points_completed: number;
  cycle_time_days: number;
  lead_time_days: number;
  deployment_frequency: number;
  change_failure_rate: number;
}

export interface QualityTrends {
  test_coverage_trend: "improving" | "declining" | "stable";
  bug_rate_trend: "improving" | "declining" | "stable";
  security_posture_trend: "improving" | "declining" | "stable";
  performance_trend: "improving" | "declining" | "stable";
}

export interface CollaborationHealth {
  review_participation_rate: number;
  knowledge_distribution_score: number;
  cross_team_collaboration: number;
  documentation_completeness: number;
}

export interface ProductivityDistribution {
  high_performers: number;
  steady_contributors: number;
  growing_developers: number;
  support_needed: number;
}
