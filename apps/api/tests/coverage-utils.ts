/**
 * @file coverage-utils.ts
 * @description Tests for coverage utils
 * @layer infrastructure
 */
// Coverage utilities for test reporting and analysis
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface CoverageThresholds {
  lines: number;
  functions: number;
  statements: number;
  branches: number;
}

export interface FileCoverage {
  path: string;
  lines: { total: number; covered: number; pct: number };
  functions: { total: number; covered: number; pct: number };
  statements: { total: number; covered: number; pct: number };
  branches: { total: number; covered: number; pct: number };
  uncoveredLines: number[];
}

export interface CoverageReport {
  overall: {
    lines: { total: number; covered: number; pct: number };
    functions: { total: number; covered: number; pct: number };
    statements: { total: number; covered: number; pct: number };
    branches: { total: number; covered: number; pct: number };
  };
  files: FileCoverage[];
  thresholds: CoverageThresholds;
  passedThresholds: boolean;
  generatedAt: Date;
}

export class CoverageAnalyzer {
  private thresholds: CoverageThresholds = {
    lines: 90,
    functions: 90,
    statements: 90,
    branches: 85,
  };

  constructor(customThresholds?: Partial<CoverageThresholds>) {
    if (customThresholds) {
      this.thresholds = { ...this.thresholds, ...customThresholds };
    }
  }

  async analyzeCoverage(): Promise<CoverageReport | null> {
    try {
      const fs = await import("fs");
      const coverageJsonPath = join(__dirname, "../coverage/coverage-final.json");

      if (!fs.existsSync(coverageJsonPath)) {
        return null;
      }

      const coverageData = JSON.parse(fs.readFileSync(coverageJsonPath, "utf8"));
      return this.processCoverageData(coverageData);
    } catch (error) {
      console.error("Failed to analyze coverage:", error);
      return null;
    }
  }

  private processCoverageData(coverageData: any): CoverageReport {
    const files: FileCoverage[] = [];
    let totalLines = 0,
      coveredLines = 0;
    let totalFunctions = 0,
      coveredFunctions = 0;
    let totalStatements = 0,
      coveredStatements = 0;
    let totalBranches = 0,
      coveredBranches = 0;

    Object.entries(coverageData).forEach(([filePath, fileCoverage]: [string, any]) => {
      // Calculate file-level coverage
      const fileLines = Object.keys(fileCoverage.s).length;
      const fileCoveredLines = Object.values(fileCoverage.s).filter(
        (count: any) => count > 0
      ).length;

      const fileFunctions = Object.keys(fileCoverage.f).length;
      const fileCoveredFunctions = Object.values(fileCoverage.f).filter(
        (count: any) => count > 0
      ).length;

      const fileStatements = Object.keys(fileCoverage.s).length;
      const fileCoveredStatements = Object.values(fileCoverage.s).filter(
        (count: any) => count > 0
      ).length;

      let fileBranches = 0;
      let fileCoveredBranches = 0;
      Object.values(fileCoverage.b).forEach((branchCoverage: any) => {
        fileBranches += branchCoverage.length;
        fileCoveredBranches += branchCoverage.filter((count: any) => count > 0).length;
      });

      // Find uncovered lines
      const uncoveredLines: number[] = [];
      Object.entries(fileCoverage.s).forEach(([lineNum, count]: [string, any]) => {
        if (count === 0) {
          uncoveredLines.push(parseInt(lineNum));
        }
      });

      files.push({
        path: filePath.replace(process.cwd(), ""),
        lines: {
          total: fileLines,
          covered: fileCoveredLines,
          pct: fileLines > 0 ? (fileCoveredLines / fileLines) * 100 : 0,
        },
        functions: {
          total: fileFunctions,
          covered: fileCoveredFunctions,
          pct: fileFunctions > 0 ? (fileCoveredFunctions / fileFunctions) * 100 : 0,
        },
        statements: {
          total: fileStatements,
          covered: fileCoveredStatements,
          pct: fileStatements > 0 ? (fileCoveredStatements / fileStatements) * 100 : 0,
        },
        branches: {
          total: fileBranches,
          covered: fileCoveredBranches,
          pct: fileBranches > 0 ? (fileCoveredBranches / fileBranches) * 100 : 0,
        },
        uncoveredLines,
      });

      // Accumulate totals
      totalLines += fileLines;
      coveredLines += fileCoveredLines;
      totalFunctions += fileFunctions;
      coveredFunctions += fileCoveredFunctions;
      totalStatements += fileStatements;
      coveredStatements += fileCoveredStatements;
      totalBranches += fileBranches;
      coveredBranches += fileCoveredBranches;
    });

    const overall = {
      lines: {
        total: totalLines,
        covered: coveredLines,
        pct: totalLines > 0 ? (coveredLines / totalLines) * 100 : 0,
      },
      functions: {
        total: totalFunctions,
        covered: coveredFunctions,
        pct: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0,
      },
      statements: {
        total: totalStatements,
        covered: coveredStatements,
        pct: totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0,
      },
      branches: {
        total: totalBranches,
        covered: coveredBranches,
        pct: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0,
      },
    };

    const passedThresholds =
      overall.lines.pct >= this.thresholds.lines &&
      overall.functions.pct >= this.thresholds.functions &&
      overall.statements.pct >= this.thresholds.statements &&
      overall.branches.pct >= this.thresholds.branches;

    return {
      overall,
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
      thresholds: this.thresholds,
      passedThresholds,
      generatedAt: new Date(),
    };
  }

  async generateDetailedReport(): Promise<string> {
    const report = await this.analyzeCoverage();

    if (!report) {
      return "No coverage data available. Run tests with coverage first.";
    }

    const colors = {
      red: "\x1b[31m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      blue: "\x1b[34m",
      cyan: "\x1b[36m",
      reset: "\x1b[0m",
      bold: "\x1b[1m",
      dim: "\x1b[2m",
    };

    const formatPct = (pct: number, threshold: number): string => {
      const color =
        pct >= threshold ? colors.green : pct >= threshold - 10 ? colors.yellow : colors.red;
      return `${color}${pct.toFixed(1)}%${colors.reset}`;
    };

    let output = `\n${colors.bold}${colors.cyan}📊 Detailed Coverage Report${colors.reset}\n`;
    output += `${colors.dim}Generated: ${report.generatedAt.toISOString()}${colors.reset}\n\n`;

    // Overall summary
    output += `${colors.bold}Overall Coverage${colors.reset}\n`;
    output += `${"".padEnd(50, "─")}\n`;
    output += `Lines:      ${formatPct(report.overall.lines.pct, report.thresholds.lines).padEnd(20)} ${report.overall.lines.covered}/${report.overall.lines.total}\n`;
    output += `Functions:  ${formatPct(report.overall.functions.pct, report.thresholds.functions).padEnd(20)} ${report.overall.functions.covered}/${report.overall.functions.total}\n`;
    output += `Statements: ${formatPct(report.overall.statements.pct, report.thresholds.statements).padEnd(20)} ${report.overall.statements.covered}/${report.overall.statements.total}\n`;
    output += `Branches:   ${formatPct(report.overall.branches.pct, report.thresholds.branches).padEnd(20)} ${report.overall.branches.covered}/${report.overall.branches.total}\n`;

    // Threshold status
    output += `\n${colors.bold}Threshold Status${colors.reset}\n`;
    output += `${"".padEnd(50, "─")}\n`;
    if (report.passedThresholds) {
      output += `${colors.green}✅ All thresholds met!${colors.reset}\n`;
    } else {
      output += `${colors.red}❌ Some thresholds not met${colors.reset}\n`;
      output += `${colors.dim}Required: Lines ${report.thresholds.lines}%, Functions ${report.thresholds.functions}%, Statements ${report.thresholds.statements}%, Branches ${report.thresholds.branches}%${colors.reset}\n`;
    }

    // File breakdown (top 10 worst files)
    const worstFiles = report.files
      .filter((file) => file.lines.total > 0)
      .sort((a, b) => a.lines.pct - b.lines.pct)
      .slice(0, 10);

    if (worstFiles.length > 0) {
      output += `\n${colors.bold}Files Needing Attention (Lowest Coverage)${colors.reset}\n`;
      output += `${"".padEnd(80, "─")}\n`;
      worstFiles.forEach((file) => {
        const shortPath = file.path.length > 50 ? "..." + file.path.slice(-47) : file.path;
        output += `${shortPath.padEnd(50)} ${formatPct(file.lines.pct, 80)}\n`;
        if (file.uncoveredLines.length > 0 && file.uncoveredLines.length < 10) {
          output += `${colors.dim}  Uncovered lines: ${file.uncoveredLines.join(", ")}${colors.reset}\n`;
        } else if (file.uncoveredLines.length >= 10) {
          output += `${colors.dim}  ${file.uncoveredLines.length} uncovered lines${colors.reset}\n`;
        }
      });
    }

    // High coverage files (encouraging)
    const bestFiles = report.files
      .filter((file) => file.lines.total > 0 && file.lines.pct >= 95)
      .sort((a, b) => b.lines.pct - a.lines.pct)
      .slice(0, 5);

    if (bestFiles.length > 0) {
      output += `\n${colors.bold}Well-Tested Files (95%+ Coverage)${colors.reset}\n`;
      output += `${"".padEnd(80, "─")}\n`;
      bestFiles.forEach((file) => {
        const shortPath = file.path.length > 50 ? "..." + file.path.slice(-47) : file.path;
        output += `${shortPath.padEnd(50)} ${colors.green}${file.lines.pct.toFixed(1)}%${colors.reset}\n`;
      });
    }

    return output;
  }

  async saveReport(filePath: string): Promise<void> {
    try {
      const fs = await import("fs");
      const report = await this.analyzeCoverage();

      if (!report) {
        throw new Error("No coverage data available");
      }

      await fs.promises.writeFile(filePath, JSON.stringify(report, null, 2));
    } catch (error) {
      throw new Error(
        `Failed to save coverage report: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  getThresholds(): CoverageThresholds {
    return { ...this.thresholds };
  }

  setThresholds(thresholds: Partial<CoverageThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }
}

export default CoverageAnalyzer;
