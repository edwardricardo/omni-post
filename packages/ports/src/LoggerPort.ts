/**
 * @file LoggerPort.ts
 * @description Technology-free port the application layer logs through. It carries
 *              exactly the two levels LOGGING_CANON allows there: WARN for a condition
 *              the operation survived but an operator should act on, and ERROR for an
 *              operation that failed. Info and debug belong to infrastructure and
 *              routes, so the port cannot express them.
 *
 *              The argument order is `(context, message)`, Pino's own, and that is
 *              the contract rather than a style. Pino reads `(object, message)` as
 *              fields plus a message but `(message, object)` as a message plus a
 *              printf argument, which it drops. A message-first port would therefore
 *              accept a raw Pino logger that compiles and loses every context field.
 *              In this order the logger returned by a deployable's own factory
 *              (`createLogger` in apps/api, which redacts) is a correct implementation
 *              as is, and the composition root passes it directly. Application
 *              services in `packages/core` import no logging library.
 * @layer domain
 */

export interface LoggerPort {
  /**
   * Record a condition the operation survived but an operator should act on, such
   * as a fallback that was taken or a side effect that failed after the main write.
   *
   * @param context - Fields merged into the entry. An `err` key carries a caught error.
   * @param message - Fixed description of the condition; variable data goes in `context`.
   */
  warn(context: Record<string, unknown>, message: string): void;
  warn(message: string): void;

  /**
   * Record an operation that failed. The caller still returns its `Result` error;
   * this entry is what tells an operator why.
   *
   * @param context - Fields merged into the entry. An `err` key carries a caught error.
   * @param message - Fixed description of the failure; variable data goes in `context`.
   */
  error(context: Record<string, unknown>, message: string): void;
  error(message: string): void;
}
