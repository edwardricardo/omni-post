/**
 * @file index.ts
 * @description Barrel for the `embeddings` shared-kernel package (`@core/embeddings`).
 *   Shared by multiple bounded contexts (ai, glossary, style-guide) for ML
 *   embedding generation. Whitelisted in the cross-bounded-context depcruise
 *   rule because the model is shared, not transversal.
 * @layer application
 */

export * from "./EmbeddingService.js";
