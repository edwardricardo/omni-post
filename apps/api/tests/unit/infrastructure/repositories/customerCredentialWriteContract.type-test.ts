/**
 * @file customerCredentialWriteContract.type-test.ts
 * @description Compile-time pin for the customer credential write API: a command
 *   that requires a credential value must not type-check when the value is
 *   omitted, and the snapshot writers it replaced must not type-check at all.
 *
 *   ## Why this is a type test and not a runtime test
 *
 *   The capability's core claim is that omitting a required credential is
 *   INEXPRESSIBLE, not that it misbehaves at runtime. A runtime test can only
 *   observe calls someone already wrote; it cannot tell "nobody can write this"
 *   apart from "nobody has written it yet". Only the compiler refuses a call
 *   that was never written. So the assertion mechanism is `@ts-expect-error`,
 *   and it is self-red in both directions:
 *
 *   - If `passwordHash` ever becomes optional again — the exact shape
 *     `save(user, passwordHash?)` had, and the shape that let a caller drop the
 *     credential and silently keep whatever the entity carried — the calls below
 *     become legal, each suppression has nothing to suppress, and TypeScript
 *     raises TS2578 ("Unused '@ts-expect-error' directive"): this file stops
 *     compiling.
 *   - If a deleted snapshot writer is ever re-declared on the port, its call
 *     below becomes legal and raises TS2578 for the same reason.
 *   - The gate therefore cannot be satisfied by deleting the thing it guards:
 *     removing a command makes its call an unknown-property error, which the
 *     suppression consumes, so the remaining rows still have to hold.
 *
 *   ## Enforcement status
 *
 *   In scope and enforcing. `apps/api/tsconfig.json` includes `src` only, but
 *   `tsconfig.type-tests.json` includes `tests/**\/*.type-test.ts`, and the
 *   package's `typecheck` script runs both passes — so a broken pin fails the
 *   same task that typechecks the source.
 *
 *   The file carries no runtime assertions and is deliberately named
 *   `.type-test.ts` rather than `.test.ts`, so neither the vitest collector
 *   (`tests/unit/**\/*.test.ts`) nor the node:test batch list treats it as a
 *   suite that ought to execute.
 *
 * @layer infrastructure
 */
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { CustomerUser } from "@core/domain/entities/CustomerUser.js";

declare const customerUserRepository: CustomerUserRepository;
declare const customerUser: CustomerUser;
declare const userId: string;
declare const token: string;

/**
 * Each call omits a credential the command's contract requires. Every one of
 * them MUST be rejected; the directive above it is what proves the rejection
 * happened rather than being assumed.
 */
export async function omittedCredentialsMustNotCompile(): Promise<void> {
  // @ts-expect-error the creation credential is required — a row cannot be created without one
  await customerUserRepository.create(customerUser);

  // @ts-expect-error the claimed hash is required — a reset cannot consume its token and store nothing
  await customerUserRepository.claimPasswordReset(token);

  // @ts-expect-error the upgraded hash is required — a rehash cannot re-encode a credential it was not given
  await customerUserRepository.upgradePasswordHash(userId);
}

/**
 * The credential is a REQUIRED parameter, never an optional one that falls back
 * to a value read off the entity. That fallback is precisely what made the old
 * writer able to restore a stale hash while reporting success, so passing an
 * explicit `undefined` must be refused too — a signature that accepts it has
 * reopened the side channel even if no caller uses it yet.
 */
export async function anExplicitlyAbsentCredentialMustNotCompile(): Promise<void> {
  // @ts-expect-error an absent credential is not a credential — the parameter is required, not optional
  await customerUserRepository.create(customerUser, undefined);
}

/**
 * The snapshot writers are gone from the PORT, not merely unused by callers.
 * A grep proves no call site names them today; this proves the port cannot
 * offer them back without a build failing.
 */
export async function theSnapshotWritersMustNotExist(): Promise<void> {
  // @ts-expect-error `save` was deleted — a whole-entity write is no longer expressible
  await customerUserRepository.save(customerUser);

  // @ts-expect-error `updatePasswordHash` was deleted — the credential column has named writers now
  await customerUserRepository.updatePasswordHash(userId, token);
}
