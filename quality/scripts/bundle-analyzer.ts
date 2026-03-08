#!/usr/bin/env tsx

/**
 * Bundle Analysis & Dependency Optimizer
 *
 * Comprehensive bundle analysis tool that identifies optimization opportunities,
 * analyzes dependency health, and provides actionable recommendations.
 */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "fs";
import { join, extname } from "path";
import { execSync } from "child_process";

import type {
  BundleAnalysis,
  BundleStats,
  FileInfo,
  DuplicateDependency,
  OutdatedDependency,
  DependencyAnalysis,
  CircularDependency,
  LicenseIssue,
  OptimizationOpportunity,
  SecurityAnalysis,
  SecurityVulnerability,
  Recommendation,
  SizeTrend,
} from "./bundle-analyzer-types.js";

export class BundleAnalyzer {
  private projectRoot: string;
  private packageJson: any;
  private lockfile: any;
  private reportsDir: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.reportsDir = join(projectRoot, "quality/reports/bundle");
    this.loadProjectFiles();
    this.ensureReportsDirectory();
  }

  private loadProjectFiles(): void {
    // Load package.json
    const packagePath = join(this.projectRoot, "package.json");
    if (existsSync(packagePath)) {
      this.packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    } else {
      throw new Error("package.json not found");
    }

    // Load lockfile (pnpm-lock.yaml or package-lock.json)
    const pnpmLockPath = join(this.projectRoot, "pnpm-lock.yaml");
    const npmLockPath = join(this.projectRoot, "package-lock.json");

    if (existsSync(pnpmLockPath)) {
      try {
        this.lockfile = { type: "pnpm", content: readFileSync(pnpmLockPath, "utf8") };
      } catch {
        this.lockfile = null;
      }
    } else if (existsSync(npmLockPath)) {
      try {
        this.lockfile = { type: "npm", content: JSON.parse(readFileSync(npmLockPath, "utf8")) };
      } catch {
        this.lockfile = null;
      }
    }
  }

  private ensureReportsDirectory(): void {
    if (!existsSync(this.reportsDir)) {
      execSync(`mkdir -p "${this.reportsDir}"`);
    }
  }

  async analyzeBundles(
    analysisType: "full" | "quick" | "dependencies-only" = "full"
  ): Promise<BundleAnalysis> {
    console.log(`📦 Starting ${analysisType} bundle analysis...`);

    const analysis: BundleAnalysis = {
      timestamp: new Date().toISOString(),
      project_root: this.projectRoot,
      analysis_type: analysisType,
      bundle_stats: await this.analyzeBundleStats(analysisType),
      dependency_analysis: await this.analyzeDependencies(),
      optimization_opportunities: [],
      security_analysis: await this.analyzeSecurityVulnerabilities(),
      recommendations: [],
      size_trends: await this.analyzeSizeTrends(),
    };

    // Generate optimization opportunities
    analysis.optimization_opportunities = this.generateOptimizationOpportunities(analysis);

    // Generate recommendations
    analysis.recommendations = this.generateRecommendations(analysis);

    // Save analysis
    await this.saveAnalysis(analysis);

    return analysis;
  }

  private async analyzeBundleStats(analysisType: string): Promise<BundleStats> {
    console.log("📊 Analyzing bundle statistics...");

    const stats: BundleStats = {
      total_size_mb: 0,
      total_files: 0,
      largest_files: [],
      duplicate_dependencies: [],
      unused_dependencies: [],
      outdated_dependencies: [],
      size_by_category: {
        source_code: 0,
        node_modules: 0,
        assets: 0,
        build_artifacts: 0,
        tests: 0,
        documentation: 0,
      },
      compression_analysis: {
        uncompressed_size: 0,
        gzip_size: 0,
        brotli_size: 0,
        compression_ratio: 0,
        potential_savings: 0,
      },
    };

    // Analyze project files
    await this.analyzeDirectorySize(this.projectRoot, stats);

    // Find largest files
    stats.largest_files = await this.findLargestFiles();

    // Analyze duplicates and unused dependencies
    if (analysisType === "full") {
      stats.duplicate_dependencies = await this.findDuplicateDependencies();
      stats.unused_dependencies = await this.findUnusedDependencies();
      stats.outdated_dependencies = await this.findOutdatedDependencies();
    }

    // Compression analysis
    stats.compression_analysis = await this.analyzeCompression();

    return stats;
  }

  private async analyzeDirectorySize(dirPath: string, stats: BundleStats): Promise<void> {
    try {
      const items = readdirSync(dirPath);

      for (const item of items) {
        const fullPath = join(dirPath, item);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          // Skip certain directories for performance
          if (["node_modules", ".git", ".next", "dist", "build"].includes(item)) {
            if (item === "node_modules") {
              const size = await this.getDirectorySize(fullPath);
              stats.size_by_category.node_modules = size;
              stats.total_size_mb += size;
            }
            continue;
          }

          await this.analyzeDirectorySize(fullPath, stats);
        } else {
          const sizeMB = stat.size / (1024 * 1024);
          stats.total_size_mb += sizeMB;
          stats.total_files += 1;

          // Categorize file
          this.categorizeFile(fullPath, sizeMB, stats);
        }
      }
    } catch (error) {
      console.warn(`Failed to analyze directory ${dirPath}:`, error);
    }
  }

  private categorizeFile(filePath: string, sizeMB: number, stats: BundleStats): void {
    const relativePath = filePath.replace(this.projectRoot, "");
    const extension = extname(filePath).toLowerCase();

    if (
      relativePath.includes("/test") ||
      relativePath.includes("/__tests__/") ||
      extension.includes(".test.") ||
      extension.includes(".spec.")
    ) {
      stats.size_by_category.tests += sizeMB;
    } else if ([".md", ".txt", ".rst"].includes(extension) || relativePath.includes("/docs/")) {
      stats.size_by_category.documentation += sizeMB;
    } else if (
      [".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf"].includes(
        extension
      )
    ) {
      stats.size_by_category.assets += sizeMB;
    } else if (
      relativePath.includes("/dist/") ||
      relativePath.includes("/build/") ||
      relativePath.includes("/.next/")
    ) {
      stats.size_by_category.build_artifacts += sizeMB;
    } else if (
      [".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".sass", ".less"].includes(extension)
    ) {
      stats.size_by_category.source_code += sizeMB;
    }
  }

  private async getDirectorySize(dirPath: string): Promise<number> {
    try {
      const output = execSync(`du -sm "${dirPath}" 2>/dev/null | cut -f1`, { encoding: "utf8" });
      return parseInt(output.trim()) || 0;
    } catch {
      return 0;
    }
  }

  private async findLargestFiles(): Promise<FileInfo[]> {
    try {
      const command = `find "${this.projectRoot}" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -exec ls -la {} \\; | sort -k5 -nr | head -20`;
      const output = execSync(command, { encoding: "utf8" });

      const files: FileInfo[] = [];
      const lines = output.trim().split("\n");

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 9) {
          const size = parseInt(parts[4]);
          const sizeMB = size / (1024 * 1024);
          const path = parts.slice(8).join(" ");

          if (sizeMB > 0.1) {
            // Only include files larger than 100KB
            files.push({
              path: path.replace(this.projectRoot, ""),
              size_mb: Math.round(sizeMB * 100) / 100,
              percentage_of_total: 0, // Will be calculated later
              type: this.determineFileType(path),
              language: this.determineLanguage(path),
            });
          }
        }
      }

      return files;
    } catch {
      return [];
    }
  }

  private determineFileType(path: string): "source" | "dependency" | "asset" | "generated" {
    if (path.includes("node_modules")) return "dependency";
    if (path.includes("/dist/") || path.includes("/build/") || path.includes("/.next/"))
      return "generated";

    const ext = extname(path).toLowerCase();
    if (
      [".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2", ".ttf"].includes(ext)
    ) {
      return "asset";
    }

    return "source";
  }

  private determineLanguage(path: string): string {
    const ext = extname(path).toLowerCase();
    const languageMap: Record<string, string> = {
      ".ts": "TypeScript",
      ".tsx": "TypeScript",
      ".js": "JavaScript",
      ".jsx": "JavaScript",
      ".css": "CSS",
      ".scss": "SCSS",
      ".sass": "Sass",
      ".less": "Less",
      ".json": "JSON",
      ".md": "Markdown",
      ".yml": "YAML",
      ".yaml": "YAML",
      ".html": "HTML",
      ".png": "Image",
      ".jpg": "Image",
      ".jpeg": "Image",
      ".gif": "Image",
      ".svg": "SVG",
    };

    return languageMap[ext] || "Unknown";
  }

  private async findDuplicateDependencies(): Promise<DuplicateDependency[]> {
    try {
      // Use npm ls to find duplicates
      const output = execSync('npm ls --depth=0 --json 2>/dev/null || echo "{}"', {
        cwd: this.projectRoot,
        encoding: "utf8",
      });

      const _data = JSON.parse(output);
      const duplicates: DuplicateDependency[] = [];

      // This is a simplified implementation
      // In practice, you'd need more sophisticated duplicate detection

      return duplicates;
    } catch {
      return [];
    }
  }

  private async findUnusedDependencies(): Promise<string[]> {
    try {
      // Use depcheck to find unused dependencies
      const output = execSync("npx depcheck --json", {
        cwd: this.projectRoot,
        encoding: "utf8",
      });

      const data = JSON.parse(output);
      return data.dependencies || [];
    } catch {
      return [];
    }
  }

  private async findOutdatedDependencies(): Promise<OutdatedDependency[]> {
    try {
      const output = execSync('npm outdated --json 2>/dev/null || echo "{}"', {
        cwd: this.projectRoot,
        encoding: "utf8",
      });

      const data = JSON.parse(output);
      const outdated: OutdatedDependency[] = [];

      for (const [name, info] of Object.entries(data as Record<string, any>)) {
        outdated.push({
          name,
          current_version: info.current,
          latest_version: info.latest,
          security_vulnerabilities: 0, // Would need security API
          breaking_changes: this.hasMajorVersionChange(info.current, info.latest),
          size_impact: "neutral", // Would need size comparison
        });
      }

      return outdated;
    } catch {
      return [];
    }
  }

  private hasMajorVersionChange(current: string, latest: string): boolean {
    const currentMajor = parseInt(current.split(".")[0]);
    const latestMajor = parseInt(latest.split(".")[0]);
    return latestMajor > currentMajor;
  }

  private async analyzeCompression(): Promise<BundleStats["compression_analysis"]> {
    // Future: integrate with a real compression tool (e.g. gzip-size, brotli-size npm packages)
    // to measure actual compressed sizes of build artifacts.
    return {
      uncompressed_size: 0,
      gzip_size: 0,
      brotli_size: 0,
      compression_ratio: 0,
      potential_savings: 0,
    };
  }

  private async analyzeDependencies(): Promise<DependencyAnalysis> {
    console.log("🔍 Analyzing dependencies...");

    const prodDeps = Object.keys(this.packageJson.dependencies || {}).length;
    const devDeps = Object.keys(this.packageJson.devDependencies || {}).length;

    return {
      total_dependencies: prodDeps + devDeps,
      production_dependencies: prodDeps,
      dev_dependencies: devDeps,
      dependency_depth: await this.calculateDependencyDepth(),
      circular_dependencies: await this.findCircularDependencies(),
      license_issues: await this.findLicenseIssues(),
      // Future: integrate with a real dependency health API (e.g. Snyk, Socket) to compute health_score.
      health_score: 0,
      // Future: integrate with webpack-bundle-analyzer or similar to measure tree_shaking_efficiency.
      tree_shaking_efficiency: 0,
    };
  }

  private async calculateDependencyDepth(): Promise<number> {
    try {
      const output = execSync('npm ls --depth=999 --json 2>/dev/null || echo "{}"', {
        cwd: this.projectRoot,
        encoding: "utf8",
      });

      const data = JSON.parse(output);
      return this.getMaxDepth(data.dependencies || {});
    } catch {
      return 0;
    }
  }

  private getMaxDepth(deps: any, currentDepth = 0): number {
    let maxDepth = currentDepth;

    for (const dep of Object.values(deps)) {
      if (dep && typeof dep === "object" && (dep as any).dependencies) {
        const depth = this.getMaxDepth((dep as any).dependencies, currentDepth + 1);
        maxDepth = Math.max(maxDepth, depth);
      }
    }

    return maxDepth;
  }

  private async findCircularDependencies(): Promise<CircularDependency[]> {
    // This would require sophisticated dependency graph analysis
    // For now, return mock data
    return [];
  }

  private async findLicenseIssues(): Promise<LicenseIssue[]> {
    try {
      const output = execSync("npx license-checker --json", {
        cwd: this.projectRoot,
        encoding: "utf8",
      });

      const licenses = JSON.parse(output);
      const issues: LicenseIssue[] = [];

      // Check for potentially problematic licenses
      const problematicLicenses = ["GPL-2.0", "GPL-3.0", "AGPL-3.0"];

      for (const [dependency, info] of Object.entries(licenses as Record<string, any>)) {
        const license = info.licenses;
        if (problematicLicenses.some((prob) => license?.includes(prob))) {
          issues.push({
            dependency,
            license,
            issue: "restrictive",
            risk_level: "high",
          });
        }
      }

      return issues;
    } catch {
      return [];
    }
  }

  private async analyzeSecurityVulnerabilities(): Promise<SecurityAnalysis> {
    console.log("🔒 Analyzing security vulnerabilities...");

    try {
      const output = execSync('npm audit --json 2>/dev/null || echo "{}"', {
        cwd: this.projectRoot,
        encoding: "utf8",
      });

      const auditData = JSON.parse(output);
      const vulnerabilities: SecurityVulnerability[] = [];

      let critical = 0,
        high = 0,
        medium = 0,
        low = 0;

      if (auditData.vulnerabilities) {
        for (const [name, vuln] of Object.entries(
          auditData.vulnerabilities as Record<string, any>
        )) {
          const severity = vuln.severity;

          vulnerabilities.push({
            dependency: name,
            vulnerability_id: vuln.via?.[0]?.url || "unknown",
            severity,
            description: vuln.via?.[0]?.title || "No description available",
            patched_version: vuln.fixAvailable?.version,
            workaround: vuln.fixAvailable ? "Update to patched version" : "No fix available",
          });

          // Count by severity
          switch (severity) {
            case "critical":
              critical++;
              break;
            case "high":
              high++;
              break;
            case "medium":
              medium++;
              break;
            case "low":
              low++;
              break;
          }
        }
      }

      const total = critical + high + medium + low;
      const securityScore = Math.max(0, 100 - critical * 25 - high * 10 - medium * 3 - low * 1);

      return {
        vulnerabilities,
        total_vulnerabilities: total,
        critical_count: critical,
        high_count: high,
        medium_count: medium,
        low_count: low,
        security_score: securityScore,
      };
    } catch {
      return {
        vulnerabilities: [],
        total_vulnerabilities: 0,
        critical_count: 0,
        high_count: 0,
        medium_count: 0,
        low_count: 0,
        security_score: 100,
      };
    }
  }

  private async analyzeSizeTrends(): Promise<SizeTrend[]> {
    // Future: read historical bundle-analysis JSON reports from this.reportsDir to build
    // a real trend over time. Return empty until historical data is available.
    return [];
  }

  private generateOptimizationOpportunities(analysis: BundleAnalysis): OptimizationOpportunity[] {
    const opportunities: OptimizationOpportunity[] = [];

    // Code splitting opportunity
    if (analysis.bundle_stats.size_by_category.source_code > 5) {
      opportunities.push({
        type: "code-splitting",
        description: "Implement route-based code splitting to reduce initial bundle size",
        estimated_savings_mb: analysis.bundle_stats.size_by_category.source_code * 0.3,
        effort_level: "medium",
        impact: "high",
        implementation_steps: [
          "Identify route boundaries for splitting",
          "Implement dynamic imports",
          "Add loading states",
          "Test bundle size reduction",
        ],
      });
    }

    // Tree shaking opportunity
    if (analysis.dependency_analysis.tree_shaking_efficiency < 80) {
      opportunities.push({
        type: "tree-shaking",
        description: "Improve tree-shaking by using named imports and ES modules",
        estimated_savings_mb: analysis.bundle_stats.size_by_category.node_modules * 0.15,
        effort_level: "low",
        impact: "medium",
        implementation_steps: [
          "Replace default imports with named imports",
          "Use ES modules where possible",
          "Configure webpack/bundler for better tree-shaking",
          "Analyze and remove unused exports",
        ],
      });
    }

    // Compression opportunity
    if (analysis.bundle_stats.compression_analysis.potential_savings > 2) {
      opportunities.push({
        type: "compression",
        description: "Enable brotli compression for better compression ratios",
        estimated_savings_mb: analysis.bundle_stats.compression_analysis.potential_savings,
        effort_level: "low",
        impact: "medium",
        implementation_steps: [
          "Configure server to serve brotli-compressed assets",
          "Set up build process to pre-compress assets",
          "Update CDN configuration if applicable",
          "Verify compression is working",
        ],
      });
    }

    // Dependency replacement opportunity
    if (analysis.bundle_stats.outdated_dependencies.length > 5) {
      opportunities.push({
        type: "dependency-replacement",
        description: "Replace heavy dependencies with lighter alternatives",
        estimated_savings_mb: 3, // Estimated savings
        effort_level: "high",
        impact: "medium",
        implementation_steps: [
          "Identify heavy dependencies that can be replaced",
          "Research lighter alternatives",
          "Test replacements thoroughly",
          "Update code to use new dependencies",
        ],
      });
    }

    return opportunities;
  }

  private generateRecommendations(analysis: BundleAnalysis): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // Security recommendations
    if (analysis.security_analysis.critical_count > 0) {
      recommendations.push({
        category: "security",
        priority: "critical",
        title: "Fix Critical Security Vulnerabilities",
        description: `${analysis.security_analysis.critical_count} critical vulnerabilities found`,
        implementation: "Run npm audit fix or manually update vulnerable dependencies",
        estimated_impact: "Prevents potential security breaches",
      });
    }

    // Performance recommendations
    if (analysis.bundle_stats.total_size_mb > 50) {
      recommendations.push({
        category: "performance",
        priority: "high",
        title: "Reduce Bundle Size",
        description: `Bundle size is ${analysis.bundle_stats.total_size_mb}MB, consider optimization`,
        implementation: "Implement code splitting, tree shaking, and compression",
        estimated_impact: "Faster page load times and better user experience",
      });
    }

    // Maintainability recommendations
    if (analysis.bundle_stats.unused_dependencies.length > 3) {
      recommendations.push({
        category: "maintainability",
        priority: "medium",
        title: "Remove Unused Dependencies",
        description: `${analysis.bundle_stats.unused_dependencies.length} unused dependencies found`,
        implementation: "Remove unused dependencies from package.json",
        estimated_impact: "Reduced maintenance burden and smaller bundle size",
      });
    }

    // Cost recommendations
    if (analysis.bundle_stats.size_by_category.node_modules > 100) {
      recommendations.push({
        category: "cost",
        priority: "medium",
        title: "Optimize Dependencies",
        description: "Large node_modules size increases deployment and storage costs",
        implementation: "Audit dependencies and consider alternatives",
        estimated_impact: "Reduced hosting and deployment costs",
      });
    }

    return recommendations;
  }

  private async saveAnalysis(analysis: BundleAnalysis): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `bundle-analysis-${timestamp}.json`;
    const filepath = join(this.reportsDir, filename);

    writeFileSync(filepath, JSON.stringify(analysis, null, 2));

    // Also save as latest
    const latestPath = join(this.reportsDir, "latest.json");
    writeFileSync(latestPath, JSON.stringify(analysis, null, 2));

    console.log(`📄 Bundle analysis saved to ${filepath}`);
  }

  printSummary(analysis: BundleAnalysis): void {
    console.log("\n📦 Bundle Analysis Summary");
    console.log("═══════════════════════════════════════");
    console.log(`📊 Total Size: ${analysis.bundle_stats.total_size_mb.toFixed(2)} MB`);
    console.log(`📁 Total Files: ${analysis.bundle_stats.total_files.toLocaleString()}`);
    console.log(`📦 Dependencies: ${analysis.dependency_analysis.total_dependencies}`);
    console.log(`🔒 Security Score: ${analysis.security_analysis.security_score}/100`);

    if (analysis.security_analysis.critical_count > 0) {
      console.log(`⚠️  Critical Vulnerabilities: ${analysis.security_analysis.critical_count}`);
    }

    console.log("\n🎯 Top Optimization Opportunities:");
    analysis.optimization_opportunities.slice(0, 3).forEach((opp, index) => {
      console.log(
        `${index + 1}. ${opp.description} (${opp.estimated_savings_mb.toFixed(2)}MB savings)`
      );
    });

    console.log("\n🚨 Top Recommendations:");
    analysis.recommendations
      .filter((rec) => rec.priority === "critical" || rec.priority === "high")
      .slice(0, 3)
      .forEach((rec, index) => {
        console.log(`${index + 1}. ${rec.title} (${rec.priority})`);
      });

    console.log("\n💡 For detailed analysis, see the generated JSON report.");
  }
}

// CLI Interface
if (require.main === module) {
  const analyzer = new BundleAnalyzer();
  const analysisType = (process.argv[2] as "full" | "quick" | "dependencies-only") || "full";

  analyzer
    .analyzeBundles(analysisType)
    .then((analysis) => {
      analyzer.printSummary(analysis);
    })
    .catch((error) => {
      console.error("❌ Bundle analysis failed:", error);
      process.exit(1);
    });
}
