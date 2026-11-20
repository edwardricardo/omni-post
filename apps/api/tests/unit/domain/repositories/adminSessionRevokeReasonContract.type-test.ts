/**
 * @file adminSessionRevokeReasonContract.type-test.ts
 * @description Compile-time pin for the reason the administrators' session port stores when it
 *   ends every session of an administrator: only a value of the closed vocabulary
 *   `ADMIN_SESSION_REVOKE_REASONS` compiles, so a misspelt reason cannot reach the stored
 *   `revokeReason` and split one operation's sessions under two names.
 *
 *   Each call below that must be refused carries `@ts-expect-error`: if the parameter ever widens
 *   back to `string`, the call becomes legal, the directive has nothing to suppress, and TypeScript
 *   raises TS2578, so this file stops compiling. The file is run by the package's `typecheck`
 *   through `tsconfig.type-tests.json`, and no test runner collects it.
 * @layer infrastructure
 */
import {
  ADMIN_SESSION_REVOKE_REASONS,
  type AdminSessionRepository,
  type AdminSessionRevokeReason,
} from "@core/domain/repositories/AdminSessionRepository.js";

declare const sessions: AdminSessionRepository;
declare const anyText: string;

/**
 * @description Every reason of the vocabulary is accepted.
 */
export async function everyReasonOfTheVocabularyCompiles(): Promise<void> {
  for (const reason of Object.values(ADMIN_SESSION_REVOKE_REASONS)) {
    const accepted: AdminSessionRevokeReason = reason;
    await sessions.revokeAllForUser("u-1", accepted);
  }
}

/**
 * @description A reason outside the vocabulary must be rejected; the directive proves it was.
 */
export async function reasonsOutsideTheVocabularyMustNotCompile(): Promise<void> {
  // @ts-expect-error a misspelt reason is not one of the vocabulary's values
  await sessions.revokeAllForUser("u-1", "PASSWORD_REISSUD");

  // @ts-expect-error a string of unknown content is not a reason of the vocabulary
  await sessions.revokeAllForUser("u-1", anyText);
}
