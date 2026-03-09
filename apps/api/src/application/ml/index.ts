/**
 * Application Layer - ML Module
 *
 * Part of Sprint 9: TDD Implementation
 * Exports all ML-related use cases and types.
 */

// Types
export type {
  MLProvider,
  ContentType,
  OptimizationGoal,
  // OptimizeContent types
  OptimizeContentInput,
  OptimizeContentOutput,
  ContentVariation,
  // PredictTiming types
  PredictTimingInput,
  PredictTimingOutput,
  OptimalTimeSlot,
  ActivityPattern,
} from "./types.js";

// Use Cases
export { OptimizeContentUseCase } from "./OptimizeContentUseCase.js";
export { PredictOptimalTimingUseCase } from "./PredictOptimalTimingUseCase.js";
