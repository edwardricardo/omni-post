/**
 * @file ZodAdministratorSignInAddressRule.test.ts
 * @description Unit tests for the adapter of the AdministratorSignInAddressRule port. Two sign-in
 *   paths authenticate an administrator by e-mail: `POST /admin/auth/login`, whose body is
 *   validated by `loginSchema` (`admin/auth/adminAuthSchemas.ts`), and `POST /auth/login`, whose
 *   body takes `SecureSchemas.userEmail` (`security/inputValidation.ts`) and whose service reads
 *   the administrators' table. The table gives, for realistic addresses, what each path's own
 *   schema answers today and requires the rule to answer their conjunction. Today the schema of
 *   `POST /auth/login` accepts a subset of what `loginSchema` accepts, so no row tells a rule
 *   that asks both from one that asks the schema of `POST /auth/login` alone; the rows where the
 *   two disagree pin only that the stricter one is asked. A separate case observes the two
 *   `safeParse` calls, and so pins that the rule asks both schemas about the address it is given.
 * @layer infrastructure
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loginSchema } from "../../../../src/admin/auth/adminAuthSchemas.js";
import { SecureSchemas } from "../../../../src/security/inputValidation.js";
import { ZodAdministratorSignInAddressRule } from "../../../../src/infrastructure/adapters/ZodAdministratorSignInAddressRule.js";

/** An address and what each sign-in path's schema answers about it. */
interface AddressCase {
  readonly address: string;
  readonly why: string;
  readonly adminLogin: boolean;
  readonly authLogin: boolean;
}

/** A local part of the given length before `@example.com`, a 12-character domain. */
const addressOfLength = (length: number): string => `${"a".repeat(length - 12)}@example.com`;

const ADDRESSES: readonly AddressCase[] = [
  { address: "admin@example.com", why: "a plain address", adminLogin: true, authLogin: true },
  {
    address: "first.admin+ops@example.co.uk",
    why: "dots, a plus tag and a two-label suffix",
    adminLogin: true,
    authLogin: true,
  },
  {
    address: "a_b-c@sub.example.org",
    why: "an underscore, a hyphen and a subdomain",
    adminLogin: true,
    authLogin: true,
  },
  {
    address: "admin@example.zz",
    why: "a top-level domain no registry assigns",
    adminLogin: true,
    authLogin: true,
  },
  {
    address: addressOfLength(320),
    why: "320 characters, the limit of /auth/login",
    adminLogin: true,
    authLogin: true,
  },
  {
    address: addressOfLength(321),
    why: "321 characters, one past the limit of /auth/login",
    adminLogin: true,
    authLogin: false,
  },
  {
    address: "o'brien@example.com",
    why: "an apostrophe, which /auth/login reads as SQL injection",
    adminLogin: true,
    authLogin: false,
  },
  {
    address: "admin@cat.example.com",
    why: "a domain label /auth/login reads as a shell command",
    adminLogin: true,
    authLogin: false,
  },
  {
    address: "admin@example.c",
    why: "a one-letter top-level domain",
    adminLogin: false,
    authLogin: false,
  },
  // The accented letter, i with an acute accent, is built from its code point, so the source
  // line holds ASCII only.
  {
    address: `adm${String.fromCodePoint(0xed)}n@example.com`,
    why: "a non-ASCII letter",
    adminLogin: false,
    authLogin: false,
  },
  { address: "a..b@example.com", why: "two dots in a row", adminLogin: false, authLogin: false },
  { address: ".a@example.com", why: "a leading dot", adminLogin: false, authLogin: false },
  {
    address: "a.@example.com",
    why: "a dot before the @",
    adminLogin: false,
    authLogin: false,
  },
  { address: "a!@example.com", why: "an exclamation mark", adminLogin: false, authLogin: false },
  {
    address: "a@-x.com",
    why: "a domain label that starts with a hyphen",
    adminLogin: false,
    authLogin: false,
  },
  { address: "admin.example.com", why: "no @", adminLogin: false, authLogin: false },
  { address: "a@b@example.com", why: "two @", adminLogin: false, authLogin: false },
  {
    address: " admin@example.com ",
    why: "surrounding spaces",
    adminLogin: false,
    authLogin: false,
  },
];

describe("ZodAdministratorSignInAddressRule accepts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks the address schema of both sign-in paths about the address it is given", () => {
    const address = "first.admin@example.com";
    const adminLoginParse = vi.spyOn(loginSchema.shape.email, "safeParse");
    const authLoginParse = vi.spyOn(SecureSchemas.userEmail, "safeParse");
    const rule = new ZodAdministratorSignInAddressRule();

    const accepted = rule.accepts(address);

    expect(accepted).toBe(true);
    expect(adminLoginParse.mock.calls).toEqual([[address]]);
    expect(authLoginParse.mock.calls).toEqual([[address]]);
  });

  it.each(ADDRESSES)(
    "answers what both sign-in paths answer when the address has $why",
    ({ address, adminLogin, authLogin }) => {
      const rule = new ZodAdministratorSignInAddressRule();

      const verdicts = {
        adminLogin: loginSchema.shape.email.safeParse(address).success,
        authLogin: SecureSchemas.userEmail.safeParse(address).success,
        rule: rule.accepts(address),
      };

      expect(verdicts).toEqual({ adminLogin, authLogin, rule: adminLogin && authLogin });
    }
  );
});
