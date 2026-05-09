/**
 * @file multi-platform-scheduling.ts
 * @description TypeScript type definitions for multi-platform scheduling: available slots, optimal
 * posting times, scheduling rules, created slot responses, and input shapes for the scheduling API.
 */
// Multi-Platform Scheduling Types
// These types mirror the backend API response shapes.

// Available scheduling slot (from GET /api/scheduling/slots)
export interface AvailableSlot {
  datetime: string;
  dayOfWeek: number;
  hour: number;
  minute: number;
  available: boolean;
  reason?: string;
}

// Optimal posting time (from GET /api/analytics/optimal-times)
export interface OptimalTime {
  dayOfWeek: number;
  hour: number;
  avgEngagement: number;
  sampleSize: number;
  confidence: number;
}

// Scheduling rule (from GET /api/scheduling/rules)
export interface SchedulingRule {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  contentTypes: string[];
  platforms: string[];
  timezone: string;
  optimalTimes: unknown;
  blackoutPeriods: unknown;
  maxPostsPerDay: number | null;
  maxPostsPerHour: number | null;
  minIntervalMinutes: number | null;
  priorityBoost: unknown;
  hashtagRules: unknown;
  timesApplied: number;
  successRate: number | null;
  avgPerformance: number | null;
  createdAt: string;
  updatedAt: string;
}

// Created slot response (from POST /api/scheduling/slots)
export interface CreatedSlot {
  id: string;
  projectId: string;
  name: string;
  isActive: boolean;
  platforms: string[];
  timezone: string;
  slot: { dayOfWeek: number; hour: number; minute: number };
  createdAt: string;
}

// Input type for creating a scheduling slot
export interface CreateScheduleInput {
  projectId: string;
  dayOfWeek: number;
  hour: number;
  minute?: number;
  timezone?: string;
  providers: string[];
  isActive?: boolean;
}

// Input type for bulk-creating scheduling slots
export interface BulkCreateScheduleInput {
  projectId: string;
  slots: Array<{
    dayOfWeek: number;
    hour: number;
    minute?: number;
    providers: string[];
  }>;
  timezone?: string;
  isActive?: boolean;
}

// UI-only type for the calendar view (not an API type)
interface CalendarDay {
  date: Date;
  slots: AvailableSlot[];
  optimalTimes: OptimalTime[];
  isToday: boolean;
}

type SchedulerView = "calendar" | "optimal" | "rules" | "bulk";
