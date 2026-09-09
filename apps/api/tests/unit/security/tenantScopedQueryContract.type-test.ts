/**
 * @file tenantScopedQueryContract.type-test.ts
 * @description Compile-time pin for the tenant-scoped query contract: a trio
 *   collection query invoked WITHOUT a tenant scope must not type-check.
 *
 *   ## Why this is a type test and not a runtime test
 *
 *   The contract's claim is that an unscoped collection read is INEXPRESSIBLE,
 *   not that it fails at runtime. A runtime test can only observe calls someone
 *   already wrote; only the compiler can refuse the ones nobody should be able
 *   to write. So the assertion mechanism is `@ts-expect-error`, and it is
 *   self-red in both directions:
 *
 *   - While `scope` is NOT a required parameter, each call below is legal, the
 *     suppression has nothing to suppress, and TypeScript raises TS2578
 *     ("Unused '@ts-expect-error' directive") — this file fails to compile.
 *   - Once `scope` becomes the required first parameter, each call is an arity
 *     error, the suppression is used, and this file compiles.
 *   - If the parameter is ever DELETED, or widened to optional, the calls
 *     become legal again and TS2578 returns. That is the point: the gate
 *     cannot be satisfied by deleting the thing it guards.
 *
 *   The file carries no runtime assertions and is deliberately named
 *   `.type-test.ts` rather than `.test.ts`, so neither the vitest collector
 *   (`tests/unit/**\/*.test.ts`) nor the node:test batch list treats it as a
 *   suite that ought to execute.
 *
 *   ## Enforcement status — read before trusting this file
 *
 *   `apps/api/tsconfig.json` includes `src` only, so NO project-level
 *   typecheck currently opens anything under `apps/api/tests`. Until this file
 *   is inside a typecheck scope, it states the contract but does not enforce
 *   it, and it must not be counted as a gate. Its red was verified explicitly
 *   rather than assumed; the verification command and the wiring this needs
 *   are recorded alongside the slice's other gate work.
 *
 * @layer infrastructure
 */
import type {
  PostRepository,
  PostQueryRepository,
} from "@core/domain/repositories/PostRepository.js";
import type { ProjectId } from "@core/domain/index.js";

declare const postRepository: PostRepository;
declare const postQueryRepository: PostQueryRepository;
declare const projectId: ProjectId;

/**
 * Each call below omits the tenant scope. Every one of them MUST be rejected by
 * the compiler; the directive above it is what proves the rejection happened.
 */
export async function unscopedTrioCollectionQueriesMustNotCompile(): Promise<void> {
  // @ts-expect-error tenant scope is a required first parameter — a count with no tenant must not compile
  await postRepository.countByProjectId(projectId);

  // @ts-expect-error tenant scope is a required first parameter — a status count with no tenant must not compile
  await postRepository.countByStatus(projectId, "DRAFT");

  // @ts-expect-error tenant scope is a required first parameter — a search with no tenant must not compile
  await postQueryRepository.search(projectId, "anything");

  // @ts-expect-error tenant scope is a required first parameter — an upcoming listing with no tenant must not compile
  await postQueryRepository.getUpcoming(projectId);

  // @ts-expect-error tenant scope is a required first parameter — a recently-published listing with no tenant must not compile
  await postQueryRepository.getRecentlyPublished(projectId);
}
