/**
 * Design-gate $on('query') EPQ capture v3 (POSITIVE CONTROLS) for SDD change
 * `admin-password-reset-claim`. Body is design.md rev 2 §"capture — specification v3"
 * (L571-732) verbatim in logic, with the three measured errata folded in and four
 * declared, benign deviations forced by the orchestrator's hard rules:
 *
 *   D1. Location: the design places this at infra/prisma/.probe-reset-claim-sql.mts;
 *       the brief forbids writing anything inside the repo, so it lives in the
 *       scratchpad and resolves the three repo modules by absolute path
 *       (`@prisma/adapter-pg` via createRequire anchored at infra/prisma/package.json).
 *   D2. Erratum 1 (layer 2): the design's proxy wraps only `connect()`. Measured, that
 *       records NOTHING — Prisma runs the implicit write transaction through
 *       `startTransaction()`, and the returned Transaction carries its own
 *       executeRaw/queryRaw. The recorder is applied to BOTH objects.
 *   D3. Erratum 3 (flush): a 60 ms wait after each call before `events` is read;
 *       $on('query') delivery is asynchronous and without it an event lands after its
 *       own capture window closed, reading as a REJECT that is a measurement artifact.
 *   D4. Robustness only, never weakening: (a) the two by-id deletes in `finally` are
 *       `deleteMany` so a PARTIAL seed still cleans up and the residue check is what
 *       decides; (b) P2 gains the readback the decision rules require for every
 *       POSITIVE control ("count === 1 AND the readback shows the data applied") but
 *       which the design's script body only spelled out for P1 and S1 — a
 *       strengthening; (c) a pre-flight reports DB readiness and any pre-existing
 *       fixture collision (AdminSession.refreshTokenHash is @unique) before seeding.
 *
 * Erratum 2 (one DATA statement): the BEGIN/COMMIT events Prisma emits around a write
 * are listed, not counted.
 */
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

const REPO_PRISMA = "/root/omni-post/infra/prisma";
const OUT =
  "/tmp/claude-0/-root-omni-post/0c4404f3-535e-4fdd-84ff-6c4c1dcf6a70/scratchpad/capture-output-v3.txt";

const requireFromPrisma = createRequire(`${REPO_PRISMA}/package.json`);
const adapterMod: Record<string, unknown> = await import(
  pathToFileURL(requireFromPrisma.resolve("@prisma/adapter-pg")).href
);
const PrismaPg = (adapterMod.PrismaPg ??
  (adapterMod.default as Record<string, unknown> | undefined)?.PrismaPg) as new (
  config: Record<string, unknown>
) => Record<string, unknown>;

const clientMod: Record<string, unknown> = await import(
  pathToFileURL(`${REPO_PRISMA}/generated/prisma/client/client.ts`).href
);
const PrismaClient = clientMod.PrismaClient as new (opts: Record<string, unknown>) => any;

const srcClientMod: Record<string, unknown> = await import(
  pathToFileURL(`${REPO_PRISMA}/src/client.ts`).href
);
const PG_SESSION_OPTIONS = srcClientMod.PG_SESSION_OPTIONS as string;

const lines: string[] = [];
const say = (s: string): void => {
  console.log(s);
  lines.push(s);
};
const finish = (): void => writeFileSync(OUT, `${lines.join("\n")}\n`, "utf8");

say(`# capture v3 — ${new Date().toISOString()}`);
say(`# PG_SESSION_OPTIONS = ${JSON.stringify(PG_SESSION_OPTIONS)}`);

const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL (or MIGRATE_DATABASE_URL) is required");
say(`# connection host/db = ${url.replace(/^[a-z]+:\/\/[^@]*@/, "")}`);

// ---- Layer 2 (cross-check): record every SQL string handed to the driver adapter,
// on the connection AND on the Transaction returned by startTransaction() (erratum 1).
const driverSql: string[] = [];
const factory = new PrismaPg({ connectionString: url, options: PG_SESSION_OPTIONS });
const recording = new Proxy(factory, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (prop !== "connect" || typeof value !== "function") return value;
    return async (...args: unknown[]) => {
      const conn = await (
        value as (...a: unknown[]) => Promise<Record<string, unknown>>
      ).apply(target, args);
      const wrapSql = (o: Record<string, unknown>, tag: string): Record<string, unknown> =>
        new Proxy(o, {
          get(c, p, r) {
            const v = Reflect.get(c, p, r);
            if ((p === "executeRaw" || p === "queryRaw") && typeof v === "function") {
              return (q: { sql: string }) => {
                driverSql.push(`${tag}${String(p)}: ${q.sql}`);
                return (v as (x: unknown) => unknown).call(c, q);
              };
            }
            if (p === "startTransaction" && typeof v === "function") {
              return async (...a: unknown[]) => {
                driverSql.push(`${tag}startTransaction()`);
                const tx = await (
                  v as (...x: unknown[]) => Promise<Record<string, unknown>>
                ).apply(c, a);
                return wrapSql(tx, "tx.");
              };
            }
            if ((p === "commit" || p === "rollback") && typeof v === "function") {
              return (...a: unknown[]) => {
                driverSql.push(`${tag}${String(p)}()`);
                return (v as (...x: unknown[]) => unknown).apply(c, a);
              };
            }
            return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(c) : v;
          },
        });
      return wrapSql(conn, "conn.");
    };
  },
});

// ---- Layer 1 (primary, documented API): query events.
const events: string[] = [];
const prisma = new PrismaClient({ adapter: recording, log: [{ emit: "event", level: "query" }] });
prisma.$on("query", (e: { query: string; params: string }) =>
  events.push(`${e.query}\n   -- params ${e.params}`)
);

const failures: string[] = [];
const must = (cond: boolean, msg: string): void => {
  if (!cond) failures.push(msg);
  say(`   [${cond ? "OK  " : "MISS"}] ${msg}`);
};
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

async function capture(label: string, run: () => Promise<{ count: number }>): Promise<number> {
  events.length = 0;
  driverSql.length = 0;
  const { count } = await run();
  await flush();
  const data = events.filter((e) => !/^(BEGIN|COMMIT)\b/.test(e));
  say(
    `\n### ${label}  (count=${count}, data statements=${data.length}, query events=${events.length}, driver statements=${driverSql.length})`
  );
  for (const e of events) say(e);
  for (const s of driverSql) say(s);
  const stmt = data[0] ?? "";
  must(data.length === 1, `${label}: exactly ONE data statement (saw ${data.length})`);
  must(
    /^UPDATE "public"\."Admin(User|Session)" SET /.test(stmt),
    `${label}: a single plain UPDATE on AdminUser/AdminSession`
  );
  must(
    / WHERE \(/.test(stmt) && !/SELECT/.test(stmt) && !/@>|<@|&&/.test(stmt),
    `${label}: WHERE is a bound-equality compare-and-swap (no SELECT, no containment operator)`
  );
  must(
    driverSql.some((s) => s.includes('UPDATE "public"."Admin')),
    `${label}: layer 2 recorded the same UPDATE (transaction hop wrapped)`
  );
  return count;
}

const tag = `probe-reset-claim-${randomUUID()}`;
const hour = 3_600_000;
const H = (s: string): string => `$argon2id$${s}`;
const H0 = "0".repeat(64);
const H1 = "1".repeat(64);
const token1 = randomUUID();

let fatal: unknown = null;
let role: { id: string } | null = null;
let user: { id: string } | null = null;
let session: { id: string } | null = null;

try {
  // ---- Pre-flight: DB readiness + fixture-collision check (deviation D4c).
  const roleRows = await prisma.role.count();
  const adminRows = await prisma.adminUser.count();
  const collide = await prisma.adminSession.count({
    where: { refreshTokenHash: { in: [H0, H1] } },
  });
  const priorResidue =
    (await prisma.adminUser.count({ where: { email: { startsWith: "probe-reset-claim-" } } })) +
    (await prisma.role.count({ where: { name: { startsWith: "probe-reset-claim-" } } }));
  say(
    `\n### pre-flight  (DB reachable: Role rows=${roleRows}, AdminUser rows=${adminRows}; fixture refreshTokenHash collisions=${collide}; pre-existing probe residue=${priorResidue})`
  );
  must(collide === 0, `pre-flight: no pre-existing AdminSession holds the fixture hashes`);
  must(priorResidue === 0, `pre-flight: no residue from an earlier probe run`);

  // ---- Seed the real fixture rows.
  role = await prisma.role.create({ data: { name: tag } });
  user = await prisma.adminUser.create({
    data: {
      email: `${tag}@probe.invalid`,
      name: "probe",
      roleId: role.id,
      passwordHash: H("prior"),
      passwordResetToken: token1,
      passwordResetExpires: new Date(Date.now() + hour),
      passwordHistory: [],
    },
  });
  session = await prisma.adminSession.create({
    data: { userId: user.id, refreshTokenHash: H0, expiresAt: new Date(Date.now() + hour) },
  });
  const seeded = await prisma.adminUser.findUniqueOrThrow({ where: { id: user.id } });
  say(
    `\n### seed  (role=${role.id} name=${tag}; adminUser=${user.id}; adminSession=${session.id}; seeded passwordHistory=${JSON.stringify(seeded.passwordHistory)} isActive=${seeded.isActive})`
  );
  must(
    seeded.passwordHistory.length === 0,
    `seed: the seeded row really carries the DEFAULT empty '{}' history (P1's subject)`
  );

  const userId = user.id;
  const sessionId = session.id;

  try {
    const resetData = (next: string) => ({
      passwordHash: H(next),
      passwordHashAlgo: "argon2id",
      passwordChangedAt: new Date(),
      passwordResetToken: null,
      passwordResetExpires: null,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lockReason: null,
    });
    const claim = (token: string, hash: string, snapshot: string[], written: string[]) =>
      prisma.adminUser.updateMany({
        where: {
          id: userId,
          passwordResetToken: token,
          passwordResetExpires: { gt: new Date() },
          isActive: true,
          passwordHash: hash,
          passwordHistory: { equals: snapshot },
        },
        data: { ...resetData("next"), passwordHistory: written },
      });
    const arm = (token: string, hash: string, history: string[]) =>
      prisma.adminUser.update({
        where: { id: userId },
        data: {
          passwordResetToken: token,
          passwordResetExpires: new Date(Date.now() + hour),
          passwordHash: H(hash),
          passwordHistory: history,
        },
      });
    const row = () => prisma.adminUser.findUniqueOrThrow({ where: { id: userId } });
    const sessionRow = () => prisma.adminSession.findUniqueOrThrow({ where: { id: sessionId } });

    // P1 — POSITIVE, the empty case: a TRUE empty snapshot against a real '{}' row MUST match.
    let c = await capture("P1 reset claim, TRUE EMPTY history snapshot (real row)", () =>
      claim(token1, H("prior"), [], [H("prior")])
    );
    const p1Matched = c === 1;
    must(
      p1Matched,
      "P1: `equals: []` matched the real '{}' row (a miss = every first reset is CONCURRENT_MODIFICATION forever; contingency: isEmpty arm)"
    );
    if (p1Matched) {
      const after1 = await row();
      say(
        `   -- P1 readback: passwordResetToken=${JSON.stringify(after1.passwordResetToken)} passwordHistory=${JSON.stringify(after1.passwordHistory)}`
      );
      must(
        after1.passwordResetToken === null && after1.passwordHistory.length === 1,
        "P1: the data was applied (token cleared, history advanced to one entry)"
      );
    }

    // CONTINGENCY — armed only if P1 failed its count rule.
    if (!p1Matched) {
      say(
        `\n!!! P1 MISSED — arming the isEmpty contingency (design.md L740) and re-running P1.`
      );
      const c1b = await capture("P1b CONTINGENCY reset claim, EMPTY snapshot via isEmpty", () =>
        prisma.adminUser.updateMany({
          where: {
            id: userId,
            passwordResetToken: token1,
            passwordResetExpires: { gt: new Date() },
            isActive: true,
            passwordHash: H("prior"),
            passwordHistory: { isEmpty: true },
          },
          data: { ...resetData("next"), passwordHistory: [H("prior")] },
        })
      );
      must(c1b === 1, "P1b: the isEmpty contingency arm matched the real '{}' row");
      const after1b = await row();
      must(
        after1b.passwordResetToken === null && after1b.passwordHistory.length === 1,
        "P1b: the contingency arm applied the data"
      );
    }

    // P2 — POSITIVE, two-entry snapshot.
    const token2 = randomUUID();
    await arm(token2, "prior2", [H("a"), H("b")]);
    c = await capture("P2 reset claim, TRUE two-entry history snapshot", () =>
      claim(token2, H("prior2"), [H("a"), H("b")], [H("a"), H("b"), H("prior2")])
    );
    must(c === 1, "P2: a true two-entry snapshot matched");
    const after2 = await row();
    say(
      `   -- P2 readback: passwordResetToken=${JSON.stringify(after2.passwordResetToken)} passwordHistory=${JSON.stringify(after2.passwordHistory)}`
    );
    must(
      after2.passwordResetToken === null && after2.passwordHistory.length === 3,
      "P2: the data was applied (token cleared, history advanced to three entries)"
    );

    // P3 — NEGATIVE: the row holds [a, b]; the snapshot says [a] (a concurrent history move).
    const token3 = randomUUID();
    await arm(token3, "prior3", [H("a"), H("b")]);
    const before3 = JSON.stringify(await row());
    c = await capture("P3 reset claim, MOVED history snapshot", () =>
      claim(token3, H("prior3"), [H("a")], [H("a"), H("prior3")])
    );
    must(c === 0, "P3: a moved history snapshot did NOT match (the predicate is a compare-and-swap)");
    must(
      JSON.stringify(await row()) === before3,
      "P3: the refused claim left the row byte-untouched (updatedAt included)"
    );

    // P4 — NEGATIVE: history true, passwordHash moved alone (E2 — the login rehash).
    const before4 = JSON.stringify(await row());
    c = await capture("P4 reset claim, MOVED passwordHash snapshot", () =>
      claim(token3, H("stale"), [H("a"), H("b")], [H("a"), H("b"), H("stale")])
    );
    must(c === 0, "P4: a moved passwordHash did NOT match");
    must(
      JSON.stringify(await row()) === before4,
      "P4: the refused claim left the row byte-untouched"
    );

    // S1 — POSITIVE: rotation CAS with the TRUE prior hash. S2 — NEGATIVE: the same hash replayed.
    const rotate = (presented: string) =>
      prisma.adminSession.updateMany({
        where: { id: sessionId, refreshTokenHash: presented, isActive: true },
        data: { refreshTokenHash: H1, expiresAt: new Date(Date.now() + hour) },
      });
    c = await capture("S1 rotation CAS, TRUE prior hash", () => rotate(H0));
    must(c === 1, "S1: the true prior hash matched");
    const s1 = JSON.stringify(await sessionRow());
    say(`   -- S1 readback: refreshTokenHash=${JSON.parse(s1).refreshTokenHash.slice(0, 8)}...`);
    must(JSON.parse(s1).refreshTokenHash === H1, "S1: the hash was rotated");
    c = await capture("S2 rotation CAS, REPLAYED prior hash", () => rotate(H0));
    must(c === 0, "S2: a replayed hash did NOT match (rotation is a claim)");
    must(
      JSON.stringify(await sessionRow()) === s1,
      "S2: the refused rotation left the row byte-untouched"
    );
  } finally {
    // Deviation D4a: deleteMany (idempotent) so a partial seed still cleans up.
    const delS = await prisma.adminSession.deleteMany({ where: { userId } });
    const delU = await prisma.adminUser.deleteMany({ where: { id: userId } });
    const delR = await prisma.role.deleteMany({ where: { id: role.id } });
    say(
      `\n### cleanup  (AdminSession deleted=${delS.count}, AdminUser deleted=${delU.count}, Role deleted=${delR.count})`
    );
  }
} catch (e) {
  fatal = e;
  say(`\n!!! FATAL: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
  // Defensive cleanup if the fatal happened before/around the inner finally.
  try {
    if (user) await prisma.adminSession.deleteMany({ where: { userId: user.id } });
    if (user) await prisma.adminUser.deleteMany({ where: { id: user.id } });
    if (role) await prisma.role.deleteMany({ where: { id: role.id } });
  } catch {
    /* residue check below is the authority */
  }
} finally {
  const residueUsers = await prisma.adminUser.count({
    where: { email: { startsWith: "probe-reset-claim-" } },
  });
  const residueRoles = await prisma.role.count({
    where: { name: { startsWith: "probe-reset-claim-" } },
  });
  const residueSessions = await prisma.adminSession.count({
    where: { refreshTokenHash: { in: [H0, H1] } },
  });
  const residue = residueUsers + residueRoles + residueSessions;
  say(
    `\n### residue check  (AdminUser=${residueUsers}, Role=${residueRoles}, AdminSession with fixture hashes=${residueSessions}) -> residue rows: ${residue}`
  );
  must(residue === 0, `cleanup left ${residue} probe row(s)`);
  await prisma.$disconnect();
}

if (fatal !== null) {
  say(`\nREJECT (fatal)\n${fatal instanceof Error ? (fatal.stack ?? fatal.message) : String(fatal)}`);
  finish();
  process.exit(1);
}
if (failures.length > 0) {
  say(`\nREJECT\n${failures.join("\n")}`);
  finish();
  process.exit(1);
}
say("\nACCEPT: every shape rule and every count control holds");
finish();
