/**
 * @file index.ts
 * @description Barrel export for ML use cases (content optimization, timing prediction) and shared type definitions.
 * @layer application
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
