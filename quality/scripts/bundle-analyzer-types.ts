export interface BundleAnalysis {
  timestamp: string;
  project_root: string;
  analysis_type: "full" | "quick" | "dependencies-only";
  bundle_stats: BundleStats;
  dependency_analysis: DependencyAnalysis;
  optimization_opportunities: OptimizationOpportunity[];
  security_analysis: SecurityAnalysis;
  recommendations: Recommendation[];
  size_trends: SizeTrend[];
}

export interface BundleStats {
  total_size_mb: number;
  total_files: number;
  largest_files: FileInfo[];
  duplicate_dependencies: DuplicateDependency[];
  unused_dependencies: string[];
  outdated_dependencies: OutdatedDependency[];
  size_by_category: SizeByCategory;
  compression_analysis: CompressionAnalysis;
}

export interface FileInfo {
  path: string;
  size_mb: number;
  percentage_of_total: number;
  type: "source" | "dependency" | "asset" | "generated";
  language: string;
}

export interface DuplicateDependency {
  name: string;
  versions: string[];
  total_size_mb: number;
  locations: string[];
}

export interface OutdatedDependency {
  name: string;
  current_version: string;
  latest_version: string;
  security_vulnerabilities: number;
  breaking_changes: boolean;
  size_impact: "positive" | "negative" | "neutral";
}

export interface DependencyAnalysis {
  total_dependencies: number;
  production_dependencies: number;
  dev_dependencies: number;
  dependency_depth: number;
  circular_dependencies: CircularDependency[];
  license_issues: LicenseIssue[];
  health_score: number;
  tree_shaking_efficiency: number;
}

export interface CircularDependency {
  cycle: string[];
  impact: "high" | "medium" | "low";
}

export interface LicenseIssue {
  dependency: string;
  license: string;
  issue: "incompatible" | "missing" | "restrictive";
  risk_level: "high" | "medium" | "low";
}

export interface OptimizationOpportunity {
  type:
    | "code-splitting"
    | "tree-shaking"
    | "compression"
    | "lazy-loading"
    | "dependency-replacement";
  description: string;
  estimated_savings_mb: number;
  effort_level: "low" | "medium" | "high";
  impact: "high" | "medium" | "low";
  implementation_steps: string[];
}

export interface SecurityAnalysis {
  vulnerabilities: SecurityVulnerability[];
  total_vulnerabilities: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  security_score: number;
}

export interface SecurityVulnerability {
  dependency: string;
  vulnerability_id: string;
  severity: "critical" | "high" | "medium" | "low";
  description: string;
  patched_version?: string;
  workaround?: string;
}

export interface Recommendation {
  category: "performance" | "security" | "maintainability" | "cost";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  implementation: string;
  estimated_impact: string;
}

export interface SizeByCategory {
  source_code: number;
  node_modules: number;
  assets: number;
  build_artifacts: number;
  tests: number;
  documentation: number;
}

export interface CompressionAnalysis {
  uncompressed_size: number;
  gzip_size: number;
  brotli_size: number;
  compression_ratio: number;
  potential_savings: number;
}

export interface SizeTrend {
  date: string;
  total_size_mb: number;
  dependency_size_mb: number;
  source_size_mb: number;
  change_percentage: number;
}
