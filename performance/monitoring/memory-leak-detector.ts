import { PerformanceObserver } from "perf_hooks";
import * as fs from "fs/promises";
import * as path from "path";

interface MemorySnapshot {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
  cpu: NodeJS.CpuUsage;
  gc?: GCMetrics;
}

interface GCMetrics {
  totalGCTime: number;
  gcFrequency: number;
  gcTypes: { [key: string]: number };
  lastGCDuration: number;
}

interface MemoryLeakReport {
  testDuration: number;
  snapshots: MemorySnapshot[];
  analysis: MemoryAnalysis;
  recommendations: string[];
  leakDetected: boolean;
  severity: "low" | "medium" | "high" | "critical";
}

interface MemoryAnalysis {
  memoryGrowthRate: number; // MB per hour
  peakMemoryUsage: number;
  memoryEfficiency: number; // percentage
  gcPressure: number; // GC time as percentage
  trendAnalysis: TrendAnalysis;
  anomalies: MemoryAnomaly[];
}

interface TrendAnalysis {
  pattern: "stable" | "linear_growth" | "exponential_growth" | "sawtooth" | "plateau_shift";
  confidence: number;
  prediction: number; // predicted memory usage in 1 hour
}

interface MemoryAnomaly {
  timestamp: number;
  type: "sudden_spike" | "memory_leak" | "gc_failure" | "plateau_shift";
  severity: number;
  description: string;
}

class MemoryLeakDetector {
  private snapshots: MemorySnapshot[] = [];
  private gcObserver?: PerformanceObserver;
  private gcMetrics: GCMetrics = {
    totalGCTime: 0,
    gcFrequency: 0,
    gcTypes: {},
    lastGCDuration: 0,
  };
  private monitoringInterval?: NodeJS.Timeout;
  private testStartTime: number = 0;
  private heapDumpCounter: number = 0;

  constructor(
    private config: {
      snapshotInterval: number;
      heapDumpInterval?: number;
      outputDir: string;
      alertThresholds: {
        memoryGrowthRate: number; // MB/hour
        gcPressure: number; // percentage
        memoryUsage: number; // MB
      };
    }
  ) {}

  /**
   * Start memory leak detection
   */
  async startMonitoring(): Promise<void> {
    console.log("🔍 Starting memory leak detection...");

    this.testStartTime = Date.now();
    this.snapshots = [];

    // Setup GC monitoring
    this.setupGCMonitoring();

    // Create output directory
    await fs.mkdir(this.config.outputDir, { recursive: true });

    // Start taking memory snapshots
    this.monitoringInterval = setInterval(() => {
      this.takeMemorySnapshot();
    }, this.config.snapshotInterval);

    // Optional heap dump collection
    if (this.config.heapDumpInterval) {
      setInterval(() => {
        this.takeHeapDump();
      }, this.config.heapDumpInterval);
    }

    console.log(
      `✅ Memory monitoring started - snapshots every ${this.config.snapshotInterval / 1000}s`
    );
  }

  /**
   * Stop monitoring and generate report
   */
  async stopMonitoring(): Promise<MemoryLeakReport> {
    console.log("🛑 Stopping memory leak detection...");

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    if (this.gcObserver) {
      this.gcObserver.disconnect();
    }

    // Take final snapshot
    this.takeMemorySnapshot();

    // Generate comprehensive report
    const report = await this.generateReport();

    // Save report to file
    await this.saveReport(report);

    console.log(
      `📊 Memory leak detection completed - ${this.snapshots.length} snapshots collected`
    );

    return report;
  }

  /**
   * Setup GC monitoring using Performance Observer
   */
  private setupGCMonitoring(): void {
    this.gcObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();

      for (const entry of entries) {
        if (entry.entryType === "gc") {
          this.gcMetrics.totalGCTime += entry.duration;
          this.gcMetrics.gcFrequency++;
          this.gcMetrics.lastGCDuration = entry.duration;

          // Track GC types
          const gcType = (entry as any).kind || "unknown";
          this.gcMetrics.gcTypes[gcType] = (this.gcMetrics.gcTypes[gcType] || 0) + 1;
        }
      }
    });

    this.gcObserver.observe({ entryTypes: ["gc"] });
  }

  /**
   * Take a memory snapshot
   */
  private takeMemorySnapshot(): void {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
      rss: memUsage.rss,
      cpu: cpuUsage,
      gc: { ...this.gcMetrics },
    };

    this.snapshots.push(snapshot);

    // Real-time leak detection
    if (this.snapshots.length > 10) {
      this.detectRealTimeLeaks();
    }
  }

  /**
   * Real-time leak detection for immediate alerts
   */
  private detectRealTimeLeaks(): void {
    const recent = this.snapshots.slice(-10);
    const first = recent[0];
    const last = recent[recent.length - 1];

    const timeDiff = (last.timestamp - first.timestamp) / 1000 / 60 / 60; // hours
    const memoryDiff = (last.heapUsed - first.heapUsed) / 1024 / 1024; // MB

    const growthRate = memoryDiff / timeDiff;

    if (growthRate > this.config.alertThresholds.memoryGrowthRate) {
      console.warn(
        `⚠️  MEMORY LEAK ALERT: Growth rate ${growthRate.toFixed(2)} MB/hour exceeds threshold`
      );
    }

    if (last.heapUsed / 1024 / 1024 > this.config.alertThresholds.memoryUsage) {
      console.warn(`⚠️  HIGH MEMORY USAGE: ${(last.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    }

    const gcPressure = (this.gcMetrics.totalGCTime / (Date.now() - this.testStartTime)) * 100;
    if (gcPressure > this.config.alertThresholds.gcPressure) {
      console.warn(`⚠️  HIGH GC PRESSURE: ${gcPressure.toFixed(2)}% time spent in GC`);
    }
  }

  /**
   * Take heap dump for detailed analysis
   */
  private async takeHeapDump(): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `heap-dump-${timestamp}-${this.heapDumpCounter++}.heapsnapshot`;
      const filepath = path.join(this.config.outputDir, filename);

      // Use Node.js inspector to generate heap dump
      const inspector = require("inspector");
      const session = new inspector.Session();
      session.connect();

      session.post("Debugger.enable");
      session.post("Runtime.enable");

      const heapDump = await new Promise((resolve, reject) => {
        session.post("HeapProfiler.takeHeapSnapshot", null, (err: any, result: any) => {
          if (err) reject(err);
          else resolve(result);
        });
      });

      await fs.writeFile(filepath, JSON.stringify(heapDump));

      session.disconnect();

      console.log(`📸 Heap dump saved: ${filename}`);
    } catch (error) {
      console.error("Failed to take heap dump:", error);
    }
  }

  /**
   * Generate comprehensive memory leak report
   */
  private async generateReport(): Promise<MemoryLeakReport> {
    const testDuration = Date.now() - this.testStartTime;
    const analysis = this.analyzeMemoryPatterns();

    const report: MemoryLeakReport = {
      testDuration,
      snapshots: this.snapshots,
      analysis,
      recommendations: this.generateRecommendations(analysis),
      leakDetected: this.determineLeakStatus(analysis),
      severity: this.determineSeverity(analysis),
    };

    return report;
  }

  /**
   * Analyze memory patterns for leaks and inefficiencies
   */
  private analyzeMemoryPatterns(): MemoryAnalysis {
    if (this.snapshots.length < 2) {
      throw new Error("Insufficient data for analysis");
    }

    const first = this.snapshots[0];
    const last = this.snapshots[this.snapshots.length - 1];

    // Calculate memory growth rate
    const timeDiff = (last.timestamp - first.timestamp) / 1000 / 60 / 60; // hours
    const memoryDiff = (last.heapUsed - first.heapUsed) / 1024 / 1024; // MB
    const memoryGrowthRate = memoryDiff / timeDiff;

    // Find peak memory usage
    const peakMemoryUsage = Math.max(...this.snapshots.map((s) => s.heapUsed)) / 1024 / 1024;

    // Calculate memory efficiency (used vs allocated)
    const avgEfficiency =
      (this.snapshots.reduce((sum, s) => sum + s.heapUsed / s.heapTotal, 0) /
        this.snapshots.length) *
      100;

    // Calculate GC pressure
    const gcPressure = (this.gcMetrics.totalGCTime / (Date.now() - this.testStartTime)) * 100;

    // Trend analysis
    const trendAnalysis = this.analyzeTrends();

    // Detect anomalies
    const anomalies = this.detectAnomalies();

    return {
      memoryGrowthRate,
      peakMemoryUsage,
      memoryEfficiency: avgEfficiency,
      gcPressure,
      trendAnalysis,
      anomalies,
    };
  }

  /**
   * Analyze memory usage trends
   */
  private analyzeTrends(): TrendAnalysis {
    const heapSizes = this.snapshots.map((s) => s.heapUsed / 1024 / 1024);

    // Calculate trend using linear regression
    const n = heapSizes.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = heapSizes;

    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Determine pattern based on slope and variance
    let pattern: TrendAnalysis["pattern"] = "stable";
    let confidence = 0;

    if (Math.abs(slope) < 0.1) {
      pattern = "stable";
      confidence = 0.9;
    } else if (slope > 0.1 && slope < 1) {
      pattern = "linear_growth";
      confidence = 0.8;
    } else if (slope >= 1) {
      pattern = "exponential_growth";
      confidence = 0.9;
    }

    // Check for sawtooth pattern (GC cycles)
    const variance = this.calculateVariance(heapSizes);
    if (variance > 10 && slope < 0.5) {
      pattern = "sawtooth";
      confidence = 0.7;
    }

    // Predict memory usage in 1 hour
    const prediction = intercept + slope * (n + 3600); // Assuming 1 snapshot per second

    return {
      pattern,
      confidence,
      prediction,
    };
  }

  /**
   * Detect memory anomalies
   */
  private detectAnomalies(): MemoryAnomaly[] {
    const anomalies: MemoryAnomaly[] = [];
    const heapSizes = this.snapshots.map((s) => s.heapUsed / 1024 / 1024);

    // Calculate moving average and standard deviation
    const windowSize = Math.min(10, this.snapshots.length);

    for (let i = windowSize; i < this.snapshots.length; i++) {
      const window = heapSizes.slice(i - windowSize, i);
      const mean = window.reduce((sum, val) => sum + val, 0) / windowSize;
      const stdDev = Math.sqrt(
        window.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / windowSize
      );

      const current = heapSizes[i];
      const deviation = Math.abs(current - mean) / stdDev;

      // Detect sudden spikes
      if (deviation > 3 && current > mean) {
        anomalies.push({
          timestamp: this.snapshots[i].timestamp,
          type: "sudden_spike",
          severity: Math.min(deviation / 3, 1),
          description: `Memory spike: ${current.toFixed(2)}MB (${deviation.toFixed(1)}σ above mean)`,
        });
      }

      // Detect plateau shifts
      if (i > windowSize * 2) {
        const prevWindow = heapSizes.slice(i - windowSize * 2, i - windowSize);
        const prevMean = prevWindow.reduce((sum, val) => sum + val, 0) / windowSize;

        if (Math.abs(mean - prevMean) > stdDev * 2) {
          anomalies.push({
            timestamp: this.snapshots[i].timestamp,
            type: "plateau_shift",
            severity: Math.abs(mean - prevMean) / (stdDev * 2),
            description: `Memory plateau shift: ${prevMean.toFixed(2)}MB → ${mean.toFixed(2)}MB`,
          });
        }
      }
    }

    return anomalies;
  }

  /**
   * Calculate variance for a dataset
   */
  private calculateVariance(data: number[]): number {
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    return data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
  }

  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(analysis: MemoryAnalysis): string[] {
    const recommendations: string[] = [];

    if (analysis.memoryGrowthRate > 50) {
      recommendations.push(
        "🚨 High memory growth rate detected. Check for memory leaks in event listeners, closures, or cached objects."
      );
    }

    if (analysis.memoryEfficiency < 60) {
      recommendations.push(
        "⚡ Low memory efficiency. Consider optimizing data structures and reducing object creation."
      );
    }

    if (analysis.gcPressure > 10) {
      recommendations.push(
        "🔄 High GC pressure. Reduce object allocation frequency and implement object pooling."
      );
    }

    if (analysis.trendAnalysis.pattern === "exponential_growth") {
      recommendations.push(
        "📈 Exponential memory growth detected. This indicates a serious memory leak that needs immediate attention."
      );
    }

    if (analysis.anomalies.length > 5) {
      recommendations.push(
        "📊 Multiple memory anomalies detected. Review code for irregular memory allocation patterns."
      );
    }

    if (analysis.peakMemoryUsage > 1024) {
      recommendations.push(
        "💾 High peak memory usage (>1GB). Consider implementing streaming or pagination for large datasets."
      );
    }

    // GC-specific recommendations
    const majorGCs = this.gcMetrics.gcTypes["major"] || 0;
    const minorGCs = this.gcMetrics.gcTypes["minor"] || 0;

    if (majorGCs / (majorGCs + minorGCs) > 0.3) {
      recommendations.push(
        "🗑️ High major GC ratio. Objects are surviving to old generation - check for memory leaks."
      );
    }

    if (recommendations.length === 0) {
      recommendations.push(
        "✅ Memory usage appears normal. Continue monitoring for long-term trends."
      );
    }

    return recommendations;
  }

  /**
   * Determine if a memory leak is detected
   */
  private determineLeakStatus(analysis: MemoryAnalysis): boolean {
    return (
      analysis.memoryGrowthRate > 100 ||
      analysis.trendAnalysis.pattern === "exponential_growth" ||
      analysis.anomalies.some((a) => a.type === "memory_leak")
    );
  }

  /**
   * Determine severity level
   */
  private determineSeverity(analysis: MemoryAnalysis): "low" | "medium" | "high" | "critical" {
    if (
      analysis.memoryGrowthRate > 200 ||
      analysis.trendAnalysis.pattern === "exponential_growth"
    ) {
      return "critical";
    }

    if (analysis.memoryGrowthRate > 100 || analysis.gcPressure > 20) {
      return "high";
    }

    if (analysis.memoryGrowthRate > 50 || analysis.memoryEfficiency < 50) {
      return "medium";
    }

    return "low";
  }

  /**
   * Save report to file
   */
  private async saveReport(report: MemoryLeakReport): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `memory-leak-report-${timestamp}.json`;
    const filepath = path.join(this.config.outputDir, filename);

    await fs.writeFile(filepath, JSON.stringify(report, null, 2));

    // Also generate a human-readable summary
    const summaryFilename = `memory-leak-summary-${timestamp}.txt`;
    const summaryFilepath = path.join(this.config.outputDir, summaryFilename);

    const summary = this.generateTextSummary(report);
    await fs.writeFile(summaryFilepath, summary);

    console.log(`📄 Report saved: ${filename}`);
    console.log(`📝 Summary saved: ${summaryFilename}`);
  }

  /**
   * Generate human-readable text summary
   */
  private generateTextSummary(report: MemoryLeakReport): string {
    const { analysis } = report;

    return `
Memory Leak Detection Report
============================

Test Duration: ${(report.testDuration / 1000 / 60).toFixed(2)} minutes
Snapshots Collected: ${report.snapshots.length}
Leak Detected: ${report.leakDetected ? "YES" : "NO"}
Severity: ${report.severity.toUpperCase()}

Memory Metrics:
- Growth Rate: ${analysis.memoryGrowthRate.toFixed(2)} MB/hour
- Peak Usage: ${analysis.peakMemoryUsage.toFixed(2)} MB
- Memory Efficiency: ${analysis.memoryEfficiency.toFixed(1)}%
- GC Pressure: ${analysis.gcPressure.toFixed(2)}%

Trend Analysis:
- Pattern: ${analysis.trendAnalysis.pattern}
- Confidence: ${(analysis.trendAnalysis.confidence * 100).toFixed(1)}%
- Predicted Usage (1h): ${analysis.trendAnalysis.prediction.toFixed(2)} MB

Anomalies Detected: ${analysis.anomalies.length}
${analysis.anomalies.map((a) => `- ${a.description}`).join("\n")}

Recommendations:
${report.recommendations.map((r) => `- ${r}`).join("\n")}

GC Statistics:
- Total GC Time: ${this.gcMetrics.totalGCTime.toFixed(2)}ms
- GC Frequency: ${this.gcMetrics.gcFrequency} collections
- Last GC Duration: ${this.gcMetrics.lastGCDuration.toFixed(2)}ms
- GC Types: ${JSON.stringify(this.gcMetrics.gcTypes, null, 2)}
`;
  }
}

/**
 * Run memory leak detection on a target function
 */
async function runMemoryLeakDetection(
  targetFunction: () => Promise<void>,
  config: {
    duration: number;
    snapshotInterval?: number;
    heapDumpInterval?: number;
    outputDir?: string;
  }
): Promise<MemoryLeakReport> {
  const detector = new MemoryLeakDetector({
    snapshotInterval: config.snapshotInterval || 5000, // 5 seconds
    heapDumpInterval: config.heapDumpInterval, // Optional
    outputDir: config.outputDir || "./performance/reports/memory",
    alertThresholds: {
      memoryGrowthRate: 50, // MB/hour
      gcPressure: 15, // percentage
      memoryUsage: 512, // MB
    },
  });

  await detector.startMonitoring();

  try {
    // Run the target function for the specified duration
    const endTime = Date.now() + config.duration;

    while (Date.now() < endTime) {
      await targetFunction();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) {
    console.error("Error during memory leak test:", error);
  }

  return await detector.stopMonitoring();
}

// Example usage
async function exampleMemoryLeakTest(): Promise<void> {
  const leakyFunction = async () => {
    // Simulate a potential memory leak
    const data = new Array(1000).fill(Math.random());
    global.leakyArray = global.leakyArray || [];
    global.leakyArray.push(data);
  };

  const report = await runMemoryLeakDetection(leakyFunction, {
    duration: 60000, // 1 minute
    snapshotInterval: 2000, // 2 seconds
    outputDir: "./performance/reports/memory",
  });

  console.log("Memory leak detection completed:", report.leakDetected);
}

// Run example if this file is executed directly
if (require.main === module) {
  exampleMemoryLeakTest().catch(console.error);
}

export { MemoryLeakDetector, runMemoryLeakDetection };
