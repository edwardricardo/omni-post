# ADR-0006: `Result<T, E>` over thrown exceptions across layer boundaries

- **Status**: Accepted
- **Date**: 2026-05-15
- **Deciders**: Platform engineering
- **Supersedes**: —
- **Superseded by**: —

## Context

JavaScript / TypeScript natively use `throw` for failure. Three problems
emerge when `throw` crosses layer boundaries (route → application →
domain → infrastructure):

1. **Type signatures lie.** A use case declared
   `async execute(): Promise<Post>` may also throw `ValidationError`,
   `NotFoundError`, `DatabaseError`, `RateLimitError`, etc. — none of
   which the compiler tracks. Callers either guess or `try/catch` for
   `Error` and lose specificity.
2. **Error semantics collapse.** A `throw new Error("not found")` from
   infrastructure becomes indistinguishable from a `throw new
Error("not found")` from domain — same `instanceof Error`, same
   string match needed.
3. **Routes need to translate.** The error handler at the HTTP boundary
   must map every possible thrown error to a status code; missing one
   silently produces `500`.

Reverse problem: too many `Result` types defeats the purpose. A function
that genuinely cannot fail (e.g., `formatDate(d): string`) wrapping its
result in `Result<string, never>` is noise.

## Decision

**All fallible operations across layer boundaries return `Result<T, E>`
— never `throw`. Use `throw` only:**

- **Inside a single function/method** that the caller is expected to
  `try/catch` (e.g., a Prisma adapter catching `P2025` and converting
  to `err("NOT_FOUND")`).
- **In domain VO constructors** that enforce invariants — these throw
  `InvariantError` and the caller is expected to handle (or let it
  propagate as a bug).
- **In Fastify route handlers' `try/catch`** that converts thrown
  infrastructure errors to `Result` shape before responding.

### Shape

```typescript
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// Helpers from @shared/types
export function ok<T>(value: T): Result<T, never>;
export function err<E>(error: E): Result<never, E>;
```

### Error type hierarchy

- **Domain errors**: extend `DomainError` (subclasses
  `ValidationError`, `InvariantError`, `NotFoundError`). Used in
  entities + VOs.
- **Use case errors**: `UseCaseError` class with `code: USE_CASE_ERRORS`
  enum (`NOT_FOUND`, `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`,
  `CONFLICT`, `INTERNAL_ERROR`, `NOT_IMPLEMENTED`, `GUARDRAIL_REJECTED`,
  …). Used at the application boundary — returned from `*UseCase`.
- **Port-level errors**: string-union types (`type
CredentialStoreError = "NOT_FOUND" | "DATABASE_ERROR"`). Used inside
  `@core/domain` repository ports — application services wrap them
  into `UseCaseError` before surfacing to callers.

### Forbidden

- Zero `throw` in `domain/` or `application/` for business failures —
  caught by fitness `#4 No raw throws in domain/application`.
- Zero `any` in any layer — caught by fitness `#3`.
- Zero `@ts-ignore` / `@ts-nocheck` in production source — fitness `#5`.

## Rationale

1. **Type-checked error handling.** `Result<T, E>` makes the failure
   set explicit in the function signature. The compiler refuses to let
   callers ignore `result.error`.
2. **Composability.** Returning `Result` lets a chain of operations
   short-circuit on the first failure without `try/catch` stair-step
   indentation: `if (!a.ok) return a; if (!b.ok) return b; ...`.
3. **Boundaries are explicit.** Application use cases return
   `Result<TOutput, UseCaseError>` — the route handler maps `error.code`
   to HTTP status. No silent `500`s from unmapped throws.
4. **Test ergonomics.** Assertions become `assert.ok(result.ok)` +
   `assert.equal(result.value.X, Y)` — no `try/catch` blocks in tests.

## Alternatives Considered

- **Throw + global error handler.** Considered (it's the
  TypeScript-norm). Rejected for the reasons listed in Context: type
  signatures lie, error semantics collapse, routes need to know every
  possible thrown error.
- **Either monad / fp-ts style.** Considered. Rejected as too
  ceremony-heavy: `pipe(ok(x), chain(f), chain(g), fold(handleErr,
handleOk))` is harder to read than guard-clauses on `result.ok`.
- **Tuple `[error, value]` (Go-style).** Considered. Rejected:
  TypeScript discriminated unions on `ok: true | false` are
  ergonomically and exhaustiveness-check-wise superior to tuple
  destructuring.

## Consequences

**Positive**

- Function signatures fully describe the failure surface.
- Callers cannot accidentally ignore errors (the type system blocks
  access to `result.value` without first checking `result.ok`).
- Routes have a single canonical error-mapping path
  (`UseCaseError.code` → status code) instead of N-many catch blocks.
- Mutation testing (Stryker) finds bugs in error paths reliably
  because errors are first-class values, not control-flow exits.

**Negative / costs**

- Slightly more verbose than `throw` (`return err(…)` vs `throw new
Error(…)`).
- Devs from other ecosystems need to learn the pattern (15 minutes).
- `Result` types compose better with async via `Promise<Result<T,
E>>` than with monadic chaining — code reads as sequential
  `if (!x.ok) return x;` rather than as a pipeline.

## Revisit if

If TypeScript ever introduces **checked exceptions** as a language
feature (vaguely on the radar as TC39 discussion), the same goals
might be achievable with native `throw`. Until then, `Result` is the
only mechanism to make failure type-checked in TypeScript.

## Risks and Mitigations

| Risk                                                | Mitigation                                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Devs forget and use `throw` in domain/application   | Fitness `#4 No raw throws in domain/application` greps `apps/api/src/domain/` + `application/` for `throw ` — hard-zero in CI.      |
| `result.ok` not checked, `.value` accessed directly | TypeScript discriminated union prevents this at compile time. `as any` cast bypasses but is caught by fitness `#3`.                 |
| Error code drift between layers                     | `USE_CASE_ERRORS` constant exported from `@core/application/UseCase.ts` is the single source of truth for application error codes.  |
| Port string-union grows unwieldy                    | When port errors exceed ~5 values, promote to a class hierarchy (current largest: `SwitchError` with 10 values — acceptable bound). |

## References

- Rust `Result<T, E>` — language reference
- Scala `Either[A, B]` — language reference
- "Railway-oriented programming" — Scott Wlaschin, https://fsharpforfunandprofit.com/rop/
- OmniPost `CLAUDE.md §Result Type`
- Implementation: `packages/shared/src/types/result.ts`
- Use case error: `packages/core/application/src/UseCase.ts` (`UseCaseError`, `USE_CASE_ERRORS`)
