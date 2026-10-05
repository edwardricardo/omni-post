/**
 * @file channelRepository.decryptInput.unit.test.ts
 * @description Pins the channel repository's side of the `Channel.credentials` contract:
 *              the injected decryptor receives each row's own id with its four envelope
 *              columns (the writer binds that id as AAD), and a row that does not decrypt
 *              fails the lookup with `DATABASE_ERROR` after exactly one log entry naming the
 *              channel and the key version, never the envelope. Tier 0: no DB, no Redis.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { PrismaClient } from "@infra/prisma";
import {
  createChannelRepository,
  type ChannelCredentialsDecryptor,
} from "../src/ChannelRepository.js";

// The repository creates its logger at module scope, so the spy is installed through
// the factory it imports rather than injected.
const { loggerError } = vi.hoisted(() => ({ loggerError: vi.fn() }));
vi.mock("@observability/logger", () => ({
  createLogger: () => ({ error: loggerError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

/** A channel row as `tx.channel.findMany` returns it. */
interface ChannelRow {
  id: string;
  projectId: string;
  accountId: string;
  provider: string;
  handle: string;
  credentialsCiphertext: string;
  credentialsIv: string;
  credentialsAuthTag: string;
  credentialsKeyVersion: number;
}

/** A row whose envelope values are distinct, recognisable strings derived from its id. */
function makeChannelRow(overrides: Partial<ChannelRow> = {}): ChannelRow {
  const id = overrides.id ?? "ch-1";
  return {
    id,
    projectId: "proj-1",
    accountId: "acc-1",
    provider: "X",
    handle: `@${id}`,
    credentialsCiphertext: `ciphertext-of-${id}`,
    credentialsIv: `iv-of-${id}`,
    credentialsAuthTag: `tag-of-${id}`,
    credentialsKeyVersion: 1,
    ...overrides,
  };
}

/** A client whose transaction binds the GUC and returns `rows` from `channel.findMany`. */
function makeClient(rows: ChannelRow[]): PrismaClient {
  return {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        $executeRaw: vi.fn().mockResolvedValue(1),
        channel: { findMany: vi.fn().mockResolvedValue(rows) },
      }),
  } as unknown as PrismaClient;
}

describe("ChannelRepository — decrypt input and decrypt failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands the decryptor each row's own id with its four envelope columns", async () => {
    const rows = [makeChannelRow({ id: "ch-1" }), makeChannelRow({ id: "ch-2" })];
    const decrypt = vi.fn<ChannelCredentialsDecryptor>().mockReturnValue({ accessToken: "tok" });
    const repo = createChannelRepository({ decryptCredentials: decrypt }, makeClient(rows));

    const result = await repo.getChannelsByIds(["ch-1", "ch-2"], "acc-1");

    assert.ok(result.ok, "both rows decrypt, so the lookup succeeds");
    expect(result.value.map((channel) => channel.credentials)).toEqual([
      { accessToken: "tok" },
      { accessToken: "tok" },
    ]);
    expect(decrypt.mock.calls).toEqual([
      [
        {
          channelId: "ch-1",
          envelope: {
            credentialsCiphertext: "ciphertext-of-ch-1",
            credentialsIv: "iv-of-ch-1",
            credentialsAuthTag: "tag-of-ch-1",
            credentialsKeyVersion: 1,
          },
        },
      ],
      [
        {
          channelId: "ch-2",
          envelope: {
            credentialsCiphertext: "ciphertext-of-ch-2",
            credentialsIv: "iv-of-ch-2",
            credentialsAuthTag: "tag-of-ch-2",
            credentialsKeyVersion: 1,
          },
        },
      ],
    ]);
    expect(loggerError).not.toHaveBeenCalled();
  });

  it("returns DATABASE_ERROR and logs once by channel id and key version when a row does not decrypt", async () => {
    const row = makeChannelRow({ id: "ch-7", credentialsKeyVersion: 7 });
    const decrypt = vi.fn<ChannelCredentialsDecryptor>().mockImplementation(() => {
      throw new Error("Decryption failed: keyVersion 7 is not configured");
    });
    const repo = createChannelRepository({ decryptCredentials: decrypt }, makeClient([row]));

    const result = await repo.getChannelsByIds(["ch-7"], "acc-1");

    expect(result).toEqual({ ok: false, error: "DATABASE_ERROR" });
    expect(loggerError).toHaveBeenCalledTimes(1);
    const [fields] = loggerError.mock.calls[0] ?? [];
    expect(fields).toEqual({
      channelId: "ch-7",
      keyVersion: 7,
      reason: "Decryption failed: keyVersion 7 is not configured",
    });
    const logged = JSON.stringify(loggerError.mock.calls);
    for (const envelopeValue of [
      row.credentialsCiphertext,
      row.credentialsIv,
      row.credentialsAuthTag,
    ]) {
      expect(logged).not.toContain(envelopeValue);
    }
  });
});
