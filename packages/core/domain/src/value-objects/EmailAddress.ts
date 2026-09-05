/**
 * @file EmailAddress.ts
 * @description Canonical normalization for email addresses used as a registration
 *              identity. Defines what makes two typed addresses THE SAME account.
 * @layer domain
 */

/**
 * Reduce an email address to its canonical identity form.
 *
 * `Foo@Example.com`, `foo@example.com` and `  FOO@EXAMPLE.COM  ` all name the
 * same account, so they must all reduce to the same stored bytes. Lowercasing
 * plus trimming is that reduction.
 *
 * WHY THIS IS ONE FUNCTION AND NOT A CONVENTION
 *   Before this existed the rule was re-typed at every call site, and the copies
 *   had already drifted: some sites lowercased AND trimmed, others only
 *   lowercased, and the account creation route did neither while the repository
 *   that reads it did both. A lookup and a write that disagree by one `.trim()`
 *   silently stop finding each other's rows, which is how a duplicate-registration
 *   check comes to report "available" for an address that is already taken.
 *   Routing every path through this function makes that class of drift
 *   unrepresentable rather than merely discouraged.
 *
 * WHY LOWERCASE THE WHOLE ADDRESS
 *   RFC 5321 §2.4 reserves case sensitivity in the LOCAL part to the receiving
 *   host, so `Foo@x.com` and `foo@x.com` MAY in principle be different mailboxes.
 *   No mail provider this product integrates with actually does that, and every
 *   one of them folds case. Treating them as one identity is therefore the
 *   behaviour users expect (they retype their address with different shift keys
 *   and expect to log in), and the alternative — case-sensitive identity — has a
 *   far worse failure mode: two accounts silently owning one human's address.
 *   This is a deliberate product decision, not an oversight of the RFC.
 *
 * IDEMPOTENT by construction: the output contains no leading/trailing whitespace
 * and no uppercase, so `normalizeEmail(normalizeEmail(x)) === normalizeEmail(x)`.
 * Both the write path and the data migration rely on that.
 *
 * NOT a validator. It does not decide whether the input IS an email — the Zod
 * schemas at the edge already do, and duplicating that here would give two
 * answers to one question. Given a non-address it returns the trimmed lowercase
 * form of whatever it was handed.
 *
 * @param email - The address as supplied by a caller, in any casing
 * @returns The canonical identity form: trimmed and lowercased
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
