/**
 * @file repository-root.ts
 * @description The repository root, for the self-tests that run the engine over this repository's
 *              own tracked files.
 * @layer infrastructure
 */
import path from "node:path";

/** The repository this package sits in, four directories above this file. */
export const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "../../../..");
