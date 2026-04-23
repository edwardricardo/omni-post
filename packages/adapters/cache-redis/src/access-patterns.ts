/**
 * @file access-patterns.ts
 * @description Tracks cache access frequency and response times per key for intelligent
 *              warming and eviction prioritization.
 * @layer infrastructure
 */

import type { AccessPattern } from "./types.js";

export class AccessPatternTracker {
  private accessPatterns = new Map<string, AccessPattern>();
  private responseTimes: number[] = [];

  updatePattern(key: string, startTime: number): void {
    const pattern = this.accessPatterns.get(key) || {
      key,
      frequency: 0,
      lastAccess: startTime,
      avgResponseTime: 0,
    };

    pattern.frequency++;
    pattern.lastAccess = startTime;
    this.accessPatterns.set(key, pattern);

    // Cleanup old patterns periodically (keep last 10,000)
    if (this.accessPatterns.size > 10000) {
      const oldPatterns = Array.from(this.accessPatterns.entries())
        .sort(([_, a], [__, b]) => a.lastAccess - b.lastAccess)
        .slice(0, 1000);

      for (const [key] of oldPatterns) {
        this.accessPatterns.delete(key);
      }
    }
  }

  recordResponseTime(startTime: number): void {
    const responseTime = Date.now() - startTime;
    this.responseTimes.push(responseTime);

    // Keep only last 1000 response times
    if (this.responseTimes.length > 1000) {
      this.responseTimes.shift();
    }
  }

  getPattern(key: string): AccessPattern | undefined {
    return this.accessPatterns.get(key);
  }

  getAllPatterns(): Map<string, AccessPattern> {
    return this.accessPatterns;
  }

  getHotKeys(limit = 10): Array<{ key: string; hits: number; frequency: number }> {
    return Array.from(this.accessPatterns.entries())
      .sort(([_, a], [__, b]) => b.frequency - a.frequency)
      .slice(0, limit)
      .map(([key, pattern]) => ({
        key,
        hits: pattern.frequency,
        frequency: pattern.frequency,
      }));
  }

  getAverageResponseTime(): number {
    if (this.responseTimes.length === 0) {
      return 0;
    }
    return this.responseTimes.reduce((sum, t) => sum + t, 0) / this.responseTimes.length;
  }

  clear(): void {
    this.accessPatterns.clear();
    this.responseTimes = [];
  }

  cleanupOldPatterns(cutoffTime: number): void {
    for (const [key, pattern] of this.accessPatterns.entries()) {
      if (pattern.lastAccess < cutoffTime) {
        this.accessPatterns.delete(key);
      }
    }
  }
}
