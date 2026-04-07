# Prisma Database Configuration Fix + AdminUser Seed

Date: 2026-03-31

## Problem

Two issues found during local development setup:

1. **`prisma db push` reported "already in sync" on an empty database** — no tables were being created despite Prisma claiming the schema was synchronized.

2. **No AdminUser existed in the database** — the seed file created an Account, Project, Channel, and AI templates but no admin user, making it impossible to log into the admin portal at localhost:3100.

## Root Cause Analysis

### Issue 1: Prisma 7 configuration bugs

Three configuration problems combined to cause the "already in sync" behavior:

**A. `earlyAccess: true` in prisma.config.ts**
The `earlyAccess` property was removed in Prisma 7 stable. Having it in `defineConfig()` caused Prisma to silently ignore it, but the configuration was technically invalid. The correct approach in Prisma 7 is to omit it entirely.

**B. `process.env.DATABASE_URL!` instead of `env("DATABASE_URL")`**
Prisma 7 provides an `env()` function from `prisma/config` that throws an error if the variable is missing. Using `process.env.DATABASE_URL!` with the non-null assertion could silently pass `undefined` and cause unexpected behavior in the schema engine.

**C. `?schema=public` in DATABASE_URL**
The `.env` file had `DATABASE_URL="postgresql://...?schema=public"`. This is a known bug cluster in Prisma 7 (GitHub issues #28128, #28611, #28770, #28961) where `@prisma/adapter-pg` ignores the `?schema=` parameter. Since `public` is PostgreSQL's default schema, removing it resolves the inconsistency without any functional change.

**D. Prisma 7.4.1 had additional bugs**
The installed version (7.4.1) had issues with `db push` not generating DDL in certain configurations. Upgrading to 7.6.0 (latest stable) resolved additional edge cases.

### Issue 2: Missing AdminUser in seed

The seed file (`infra/prisma/seed.ts`) had never included an AdminUser creation. The `argon2` package was also not installed in the `@infra/prisma` workspace, so password hashing wasn't available at seed time.

## Solution

### prisma.config.ts — Fixed configuration

Before:

```typescript
import "dotenv/config";
import path from "path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  earlyAccess: true, // ❌ Invalid in Prisma 7 stable
  schema: path.join(__dirname, "schema.prisma"),
  datasource: {
    url: process.env.DATABASE_URL!, // ❌ Unsafe, can be undefined
  },
  migrations: {
    seed: "npx tsx seed.ts",
  },
});
```

After:

```typescript
import "dotenv/config";
import path from "path";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: path.join(__dirname, "schema.prisma"),
  datasource: {
    url: env("DATABASE_URL"), // ✅ Throws if missing
  },
  migrations: {
    seed: "npx tsx seed.ts",
  },
});
```

### .env — Removed ?schema=public

Before:

```
DATABASE_URL="postgresql://postgres:password123@localhost:5432/omnipostdb?schema=public"
```

After:

```
DATABASE_URL="postgresql://postgres:password123@localhost:5432/omnipostdb"
```

### Prisma packages — Upgraded to 7.6.0

| Package            | Before | After |
| ------------------ | ------ | ----- |
| prisma             | 7.4.1  | 7.6.0 |
| @prisma/client     | 7.4.1  | 7.6.0 |
| @prisma/adapter-pg | 7.4.1  | 7.6.0 |

Updated in both `infra/prisma/package.json` and `apps/api/package.json`.

### seed.ts — AdminUser added

Added argon2 import and AdminUser upsert at the end of the seed function:

```typescript
import argon2 from "argon2";

// At end of main():
const adminPassword = process.env.ADMIN_PASSWORD ?? "Admin123!";
const hashedPassword = await argon2.hash(adminPassword, {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
});

const adminUser = await prisma.adminUser.upsert({
  where: { email: "admin@omnipost.local" },
  update: {},
  create: {
    email: "admin@omnipost.local",
    passwordHash: hashedPassword,
    name: "Edward",
    role: "SUPER_ADMIN",
    isActive: true,
  },
});
```

argon2@0.44.0 installed in `@infra/prisma` workspace. Uses the same hashing parameters as the API's PasswordService (argon2id, 64MB memory, 3 iterations, 4 parallelism).

## Files Modified

| File                          | Change                                                                      |
| ----------------------------- | --------------------------------------------------------------------------- |
| infra/prisma/prisma.config.ts | Removed earlyAccess, use env() from prisma/config                           |
| infra/prisma/.env             | Removed ?schema=public from DATABASE_URL                                    |
| infra/prisma/seed.ts          | Added argon2 import + AdminUser upsert                                      |
| infra/prisma/package.json     | prisma 7.6.0, @prisma/client 7.6.0, @prisma/adapter-pg 7.6.0, argon2 0.44.0 |
| apps/api/package.json         | @prisma/client 7.6.0                                                        |

## Verification

| Check            | Result                                                   |
| ---------------- | -------------------------------------------------------- |
| prisma db push   | Creates 97 tables correctly                              |
| AdminUser in DB  | 1 row (admin@omnipost.local, SUPER_ADMIN, isActive=true) |
| TypeScript build | 0 errors, 9/9 tasks                                      |
| All tests        | 351 files, 7,159 passed, 0 failed                        |

## References

- [Prisma #28128](https://github.com/prisma/prisma/issues/28128) — adapter-pg ignores ?schema= parameter
- [Prisma #28585](https://github.com/prisma/prisma/issues/28585) — prisma.config.ts location issues
- [Prisma #28966](https://github.com/prisma/prisma/issues/28966) — migrate/push failures after Prisma 7 upgrade
- [Prisma 7 Upgrade Guide](https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)
