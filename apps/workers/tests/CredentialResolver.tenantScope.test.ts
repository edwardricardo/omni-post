/**
 * @file CredentialResolver.tenantScope.test.ts
 * @description Unit tests for the tenant-scoped credential resolver.
 *   `resolve(channelId, accountId)` MUST forward the caller's `accountId` to the
 *   guarded repository so the lookup is scoped to the caller's tenant. An
 *   own-scope caller decrypts and receives the plaintext credentials; a
 *   foreign-scope caller receives `err("AUTH")` with NOTHING decrypted (the
 *   scoped query returns zero rows, so no plaintext is ever produced). No DB; a
 *   plain fake repository stands in for the guarded adapter.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { ok, type Result } from "@shared/types";
import { CredentialResolver } from "../src/services/CredentialResolver.js";

const CHANNEL_ID = "ch-owned-by-a";
const OWNER_ACCOUNT_ID = "acct-a";
const FOREIGN_ACCOUNT_ID = "acct-b";
const DECRYPTED_CREDENTIALS = { accessToken: "plaintext-secret-A" } as const;

interface SeededChannel {
  id: string;
  ownerAccountId: string;
  credentials: unknown;
}

interface RepoCall {
  ids: string[];
  accountId: string | undefined;
}

/**
 * Fake tenant-scoped channel-credentials repository. Models the guarded
 * `getChannelsByIds(ids, accountId)` contract from D9: a row is only returned —
 * and therefore only "decrypted" — when the caller's `accountId` matches the
 * row's owner. Records every call so tests can assert the resolver forwards the
 * tenant scope. A fresh instance is built per test, so there is no shared state
 * to reset between cases.
 */
function createFakeScopedRepo(seed: SeededChannel[]) {
  const calls: RepoCall[] = [];
  let decryptExposures = 0;
  return {
    calls,
    get decryptExposures(): number {
      return decryptExposures;
    },
    async getChannelsByIds(
      ids: string[],
      accountId?: string
    ): Promise<Result<Array<{ id: string; credentials: unknown }>, "DATABASE_ERROR">> {
      calls.push({ ids, accountId });
      const scopedRows = seed.filter(
        (channel) => ids.includes(channel.id) && channel.ownerAccountId === accountId
      );
      // Decryption only happens for rows the tenant-scoped query actually returns.
      const mapped = scopedRows.map((channel) => {
        decryptExposures += 1;
        return { id: channel.id, credentials: channel.credentials };
      });
      return ok(mapped);
    },
  };
}

describe("CredentialResolver — tenant-scoped resolve (D1/D9)", () => {
  describe("own-scope caller", () => {
    it("forwards the caller accountId to the repository and returns the decrypted credentials", async () => {
      const repo = createFakeScopedRepo([
        { id: CHANNEL_ID, ownerAccountId: OWNER_ACCOUNT_ID, credentials: DECRYPTED_CREDENTIALS },
      ]);
      const resolver = new CredentialResolver(repo);

      const result = await resolver.resolve(CHANNEL_ID, OWNER_ACCOUNT_ID);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual(DECRYPTED_CREDENTIALS);
      }
      // Security contract: the lookup MUST be scoped to the caller's accountId.
      expect(repo.calls).toEqual([{ ids: [CHANNEL_ID], accountId: OWNER_ACCOUNT_ID }]);
      expect(repo.decryptExposures).toBe(1);
    });
  });

  describe("foreign-scope caller", () => {
    it("returns err(AUTH) and decrypts NOTHING for a channel owned by another tenant", async () => {
      const repo = createFakeScopedRepo([
        { id: CHANNEL_ID, ownerAccountId: OWNER_ACCOUNT_ID, credentials: DECRYPTED_CREDENTIALS },
      ]);
      const resolver = new CredentialResolver(repo);

      const result = await resolver.resolve(CHANNEL_ID, FOREIGN_ACCOUNT_ID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("AUTH");
      }
      // The lookup is scoped to the FOREIGN caller (not the owner), so the
      // guarded query returns zero rows and no plaintext is ever produced.
      expect(repo.calls).toEqual([{ ids: [CHANNEL_ID], accountId: FOREIGN_ACCOUNT_ID }]);
      expect(repo.decryptExposures).toBe(0);
    });
  });
});
