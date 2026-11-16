/**
 * @file redaction.test.ts
 * @description Tests that the packages' base logger redacts with the shared list: a
 *              credentials object written through `createLogger(name)` reaches the
 *              destination with every credential field masked and every other field as
 *              written (ADR-0034, decision 8).
 * @layer infrastructure
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import { createLogger } from "../src/index.js";

const MASK = "[REDACTED]";

/** The credential fields ADR-0034 decision 8 adds to the list, each with a made-up value. */
const ADDED_FIELDS = {
  appPassword: "fake-app-password",
  clientSecret: "fake-client-secret",
  appSecret: "fake-app-secret",
  botToken: "fake-bot-token",
  secretKey: "fake-secret-key",
  webhookSecret: "fake-webhook-secret",
  mfaSecret: "FAKEMFASEED",
  backupCodes: ["fake-code-1111", "fake-code-2222"],
  codeVerifier: "fake-code-verifier",
  webhookUrl: "https://hooks.example.test/services/fake",
  targetUrl: "https://hooks.example.test/catch/fake",
  privateKey: "fake-private-key",
  accessTokenSecret: "fake-access-token-secret",
} as const;

/** The fields the list held before decision 8, each with a made-up value. */
const HELD_FIELDS = {
  password: "fake-password",
  token: "fake-token",
  apiKey: "fake-api-key",
  apiSecret: "fake-api-secret",
  accessToken: "fake-access-token",
  refreshToken: "fake-refresh-token",
  bearerToken: "fake-bearer-token",
  secret: "fake-secret",
  credentials: { key: "fake-credential" },
  authorization: "Bearer fake",
  cookie: "session=fake",
} as const;

interface Capture {
  readonly log: pino.Logger;
  readonly lines: () => Record<string, unknown>[];
}

/**
 * Builds a logger through the public factory and captures the serialized lines its
 * destination receives, so the assertions read what an operator would read. The level
 * is pinned to `info` so the result does not depend on `LOG_LEVEL`.
 */
function captureFromFactory(name: string): Capture {
  const log = createLogger(name);
  log.level = "info";
  const destination = Reflect.get(log, pino.symbols.streamSym) as
    { write(line: string): boolean } | undefined;
  // `pino.symbols` is pino's exported extension surface; a pino that stops exposing the
  // destination there must fail here, by name, and not as an empty capture.
  if (typeof destination?.write !== "function") {
    throw new Error(
      "pino.symbols.streamSym no longer resolves the logger's destination: update this capture before trusting the assertions"
    );
  }
  const write = vi.spyOn(destination, "write").mockImplementation(() => true);
  return {
    log,
    lines: () => write.mock.calls.map(([line]) => JSON.parse(line) as Record<string, unknown>),
  };
}

/** Maps every key of `fields` to the mask, the shape a fully redacted entry takes. */
function masked(fields: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.keys(fields).map((key) => [key, MASK]));
}

/** Picks the keys of `fields` out of a written entry. */
function pick(entry: Record<string, unknown>, fields: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(fields).map((key) => [key, entry[key]]));
}

describe("createLogger redaction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("masks every credential field the shared list adds when they are logged at the top level", () => {
    const { log, lines } = captureFromFactory("redaction-added");

    log.info({ ...ADDED_FIELDS }, "credential fields");

    const [entry, ...rest] = lines();
    expect(rest).toEqual([]);
    expect(pick(entry ?? {}, ADDED_FIELDS)).toEqual(masked(ADDED_FIELDS));
  });

  it("masks one entry of each nested form when the credentials sit below the top level", () => {
    const { log, lines } = captureFromFactory("redaction-nested");

    log.info(
      {
        session: { accessToken: "fake-nested-access", refreshToken: "fake-nested-refresh" },
        channel: { credentials: { appPassword: "fake-nested-app-password" } },
        provider: { oauth: { token: "fake-deep-token", secret: "fake-deep-secret" } },
      },
      "nested credentials"
    );

    const [entry] = lines();
    expect(entry?.session).toEqual({ accessToken: MASK, refreshToken: MASK });
    expect(entry?.channel).toEqual({ credentials: MASK });
    expect(entry?.provider).toEqual({ oauth: { token: MASK, secret: MASK } });
  });

  it("masks the fields the list held before decision 8 when they are logged", () => {
    const { log, lines } = captureFromFactory("redaction-held");

    log.info(
      {
        ...HELD_FIELDS,
        user: { password: "fake-user-password", token: "fake-user-token" },
        client: { apiKey: "fake-client-api-key", secret: "fake-client-secret" },
        req: { headers: { authorization: "Bearer fake", cookie: "session=fake" } },
        res: { headers: { "set-cookie": ["session=fake"] } },
      },
      "held fields"
    );

    const [entry] = lines();
    expect(pick(entry ?? {}, HELD_FIELDS)).toEqual(masked(HELD_FIELDS));
    expect(entry?.user).toEqual({ password: MASK, token: MASK });
    expect(entry?.client).toEqual({ apiKey: MASK, secret: MASK });
    expect(entry?.req).toEqual({ headers: { authorization: MASK, cookie: MASK } });
    expect(entry?.res).toEqual({ headers: { "set-cookie": MASK } });
  });

  it("writes a field that is not sensitive as given when it sits beside credentials", () => {
    const { log, lines } = captureFromFactory("redaction-plain");

    log.info(
      {
        accountId: "account-001",
        botToken: "fake-bot-token",
        provider: { oauth: { scope: "read", token: "fake-deep-token" } },
      },
      "mixed fields"
    );

    const [entry] = lines();
    expect(entry?.accountId).toBe("account-001");
    expect(entry?.provider).toEqual({ oauth: { scope: "read", token: MASK } });
    expect(entry?.msg).toBe("mixed fields");
    expect(entry?.name).toBe("redaction-plain");
  });
});
