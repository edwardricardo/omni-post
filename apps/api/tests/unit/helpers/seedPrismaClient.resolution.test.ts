/**
 * @file seedPrismaClient.resolution.test.ts
 * @description Pins the owner-channel URL resolution against the present-but-empty
 *              env shape. `.env.example` ships `MIGRATE_DATABASE_URL=` EMPTY by
 *              design, and CI copies that file to `.env` before dotenv loads it —
 *              so an empty string MUST mean "unconfigured" and fall through to
 *              `DATABASE_URL`. The `??` form treated `""` as a real URL and every
 *              CI migrate died with "Connection url is empty"; reintroducing it
 *              reddens the first test here.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { resolveSeedDatabaseUrl } from "../../integration/helpers/seedPrismaClient.js";

describe("resolveSeedDatabaseUrl", () => {
  it("falls through to DATABASE_URL when MIGRATE_DATABASE_URL is present but empty", () => {
    const url = resolveSeedDatabaseUrl({
      MIGRATE_DATABASE_URL: "",
      DATABASE_URL: "postgresql://owner@db:5432/app",
    } as NodeJS.ProcessEnv);
    expect(url).toBe("postgresql://owner@db:5432/app");
  });

  it("prefers MIGRATE_DATABASE_URL when it carries a real value", () => {
    const url = resolveSeedDatabaseUrl({
      MIGRATE_DATABASE_URL: "postgresql://migrate@db:5432/app",
      DATABASE_URL: "postgresql://app@db:5432/app",
    } as NodeJS.ProcessEnv);
    expect(url).toBe("postgresql://migrate@db:5432/app");
  });

  it("throws when both channels are empty rather than returning an empty string", () => {
    expect(() =>
      resolveSeedDatabaseUrl({
        MIGRATE_DATABASE_URL: "",
        DATABASE_URL: "",
      } as NodeJS.ProcessEnv)
    ).toThrow(/seed channel is not configured/);
  });
});
