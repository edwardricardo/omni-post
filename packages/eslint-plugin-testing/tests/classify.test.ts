/**
 * @file classify.test.ts
 * @description Table-driven suite for `classifyFile`, the classifier of `src/classify.js` over the
 *              blocks `src/blocks.js` finds and the assertions `src/assertions.js` reads. Every
 *              fixture under `tests/fixtures/classifier/` is source text, never collected or
 *              compiled (a `.txt` name matches no test glob and no compiler or linter input),
 *              holding a positive and a negative case of a class in one framework, vitest's
 *              `expect` or node:test's `assert` and `t.assert`. Each row pins one reported block:
 *              its `file:line:title` id, its block class, its flags and the class of each of its
 *              assertions, so a rule that starts or stops matching moves a named row. Two fixtures
 *              are real cases cut from `apps/api/tests/unit`: `auditMiddleware.test.ts:274` and
 *              `webhookHandler.stats.test.ts:355`. The suite also pins what each class reports
 *              beyond its name, the criterion map, determinism, and that node loads the package
 *              as it is.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import { BLOCK_CLASS, CRITERIA, classifyFile } from "../src/index.js";

type Expected = {
  line: number;
  title: string;
  blockClass: string;
  assertions: string[];
  flags?: string[];
};

type Fixture = {
  fixture: string;
  fileName: string;
  framework: "vitest" | "node";
  blocks: Expected[];
};

const EXISTS = "EXISTENCE";
const TAUT = "TAUTOLOGY";
const BEHAV = "BEHAVIOURAL";
const OPAQUE = "OPAQUE";

const row = (
  line: number,
  title: string,
  blockClass: string,
  assertions: string[] = [],
  flags: string[] = []
): Expected => ({ line, title, blockClass, assertions, flags });

const source = (fixture: string): string =>
  readFileSync(new URL(`./fixtures/classifier/${fixture}`, import.meta.url), "utf8");

const FIXTURES: Fixture[] = [
  {
    fixture: "empty.vitest.txt",
    fileName: "empty.vitest.test.ts",
    framework: "vitest",
    blocks: [
      row(6, "creates a post", "EMPTY"),
      row(10, "creates a post with its title", BEHAV, [BEHAV]),
      row(15, "creates a post with an id", BEHAV, [BEHAV]),
    ],
  },
  {
    fixture: "empty.node.txt",
    fileName: "empty.node.test.ts",
    framework: "node",
    blocks: [
      row(7, "creates a post", "EMPTY"),
      row(11, "creates a post with its title", BEHAV, [BEHAV]),
      row(17, "is planned", "EMPTY"),
      row(19, "saves the record", BEHAV, [BEHAV]),
    ],
  },
  {
    fixture: "tautology.vitest.txt",
    fileName: "tautology.vitest.test.ts",
    framework: "vitest",
    blocks: [
      row(5, "handles alerts", "TAUTOLOGY-ONLY", [TAUT, TAUT]),
      row(11, "counts retried events", "TAUTOLOGY-ONLY", [TAUT, TAUT]),
      row(17, "retries one event", BEHAV, [BEHAV]),
      row(22, "keeps at least one event queued", BEHAV, [BEHAV]),
    ],
  },
  {
    fixture: "tautology.node.txt",
    fileName: "tautology.node.test.ts",
    framework: "node",
    blocks: [
      row(5, "handles alerts", "TAUTOLOGY-ONLY", [TAUT, TAUT]),
      row(11, "counts retried events", "TAUTOLOGY-ONLY", [TAUT]),
      row(16, "retries one event", BEHAV, [BEHAV]),
    ],
  },
  {
    fixture: "existence.vitest.txt",
    fileName: "existence.vitest.test.tsx",
    framework: "vitest",
    blocks: [
      row(6, "returns the user", "EXISTENCE-ONLY", Array<string>(7).fill(EXISTS)),
      row(17, "renders the form", "EXISTENCE-ONLY", [EXISTS, EXISTS]),
      row(23, "returns the user's email", BEHAV, [EXISTS, BEHAV]),
      row(29, "renders the save button", BEHAV, [BEHAV]),
      row(34, "marks the comment deleted", BEHAV, [BEHAV]),
    ],
  },
  {
    fixture: "existence.node.txt",
    fileName: "existence.node.test.ts",
    framework: "node",
    blocks: [
      row(5, "returns the user", "EXISTENCE-ONLY", [EXISTS, EXISTS, EXISTS, EXISTS]),
      row(13, "returns the user's email", BEHAV, [EXISTS, BEHAV]),
      row(19, "grants the admin role", BEHAV, [BEHAV]),
    ],
  },
  {
    fixture: "conditional.vitest.txt",
    fileName: "conditional.vitest.test.ts",
    framework: "vitest",
    blocks: [
      row(6, "parses the year", "CONDITIONAL-ONLY", [BEHAV], ["CONDITIONAL"]),
      row(13, "creates the asset", "CONDITIONAL-ONLY", [BEHAV], ["GUARDED-RETURN"]),
      row(19, "reports the load error", "CONDITIONAL-ONLY", [EXISTS], ["CONDITIONAL"]),
      row(27, "creates the asset after asserting success", BEHAV, [BEHAV, BEHAV]),
      row(34, "parses the year after asserting success", BEHAV, [EXISTS, BEHAV]),
    ],
  },
  {
    fixture: "conditional.node.txt",
    fileName: "conditional.node.test.ts",
    framework: "node",
    blocks: [
      row(6, "parses the year", "CONDITIONAL-ONLY", [BEHAV], ["CONDITIONAL"]),
      row(11, "creates the asset", "CONDITIONAL-ONLY", [BEHAV], ["GUARDED-RETURN"]),
      row(19, "creates the asset after asserting success", BEHAV, [EXISTS, BEHAV]),
    ],
  },
  {
    fixture: "self-skip.vitest.txt",
    fileName: "self-skip.vitest.test.ts",
    framework: "vitest",
    blocks: [
      row(5, "publishes", "SELF-SKIP", [BEHAV]),
      row(9, "calls the API", "SELF-SKIP", [BEHAV]),
      row(13, "is planned", "SELF-SKIP"),
      row(15, "handles retries", "SELF-SKIP"),
      row(17, "reads the cache", "SELF-SKIP", [BEHAV]),
      row(22, "publishes when enabled", BEHAV, [BEHAV]),
      row(28, "still works", "SELF-SKIP", [BEHAV]),
      row(33, "billing", "SELF-SKIP"),
    ],
  },
  {
    fixture: "self-skip.node.txt",
    fileName: "self-skip.node.test.ts",
    framework: "node",
    blocks: [
      row(5, "calls the API", "SELF-SKIP", [BEHAV]),
      row(9, "reads the cache", "SELF-SKIP", [BEHAV], ["GUARDED-RETURN"]),
      row(17, "lists projects", "SELF-SKIP"),
      row(20, "isolates", "SELF-SKIP", [BEHAV]),
      row(25, "runs always", BEHAV, [BEHAV]),
    ],
  },
  {
    fixture: "prints-success.vitest.txt",
    fileName: "prints-success.vitest.test.ts",
    framework: "vitest",
    blocks: [
      row(5, "creates the account", "PRINTS-SUCCESS"),
      row(14, "verifies the system is operational", "PRINTS-SUCCESS", [EXISTS]),
      row(20, "requests a password reset", "EMPTY"),
      row(25, "checks health after printing", BEHAV, [BEHAV]),
    ],
  },
  {
    fixture: "prints-success.node.txt",
    fileName: "prints-success.node.test.ts",
    framework: "node",
    blocks: [
      row(5, "creates the account", "PRINTS-SUCCESS"),
      row(10, "checks health", BEHAV, [BEHAV]),
    ],
  },
  {
    fixture: "title-contradiction.vitest.txt",
    fileName: "title-contradiction.vitest.test.ts",
    framework: "vitest",
    blocks: [
      row(6, "returns undefined for unknown routes", "TITLE-CONTRADICTION", [EXISTS]),
      row(11, "returns undefined for unknown ids", BEHAV, [BEHAV]),
      row(15, "throws on an invalid token", "TITLE-CONTRADICTION", [EXISTS]),
      row(20, "throws on an expired token", BEHAV, [BEHAV]),
      row(24, "responds with 404 for a missing post", "TITLE-CONTRADICTION", [BEHAV]),
      row(29, "responds with 404 for a missing draft", BEHAV, [BEHAV]),
      row(34, "does not start twice", "TITLE-CONTRADICTION", [EXISTS]),
      row(40, "does not start a stopped relay", BEHAV, [BEHAV]),
      row(45, "rejects an empty name", "TITLE-CONTRADICTION", [EXISTS]),
      row(50, "rejects a long name", BEHAV, [BEHAV]),
      row(55, "falls back when the provider throws", BEHAV, [BEHAV]),
    ],
  },
  {
    fixture: "title-contradiction.node.txt",
    fileName: "title-contradiction.node.test.ts",
    framework: "node",
    blocks: [
      row(6, "returns null when no bundle matches", "TITLE-CONTRADICTION", [EXISTS]),
      row(11, "returns null when no bundle is cheaper", BEHAV, [BEHAV]),
      row(15, "throws when the key is missing", "TITLE-CONTRADICTION", [EXISTS]),
      row(20, "throws when the secret is missing", BEHAV, [BEHAV]),
      row(24, "returns 401 without a token", "TITLE-CONTRADICTION", [BEHAV]),
      row(29, "returns 401 with an expired token", BEHAV, [BEHAV]),
      row(34, "does not expose the secret", "TITLE-CONTRADICTION", [EXISTS]),
      row(38, "never exposes the hash", BEHAV, [BEHAV]),
    ],
  },
  {
    fixture: "snapshot.vitest.txt",
    fileName: "snapshot.vitest.test.ts",
    framework: "vitest",
    blocks: [
      row(6, "renders the welcome email", BEHAV, ["SNAPSHOT"]),
      row(10, "renders the welcome subject", BEHAV, [BEHAV]),
    ],
  },
  {
    fixture: "snapshot.node.txt",
    fileName: "snapshot.node.test.ts",
    framework: "node",
    blocks: [
      row(5, "renders the welcome email", BEHAV, ["SNAPSHOT"]),
      row(9, "renders the welcome subject", BEHAV, [BEHAV]),
    ],
  },
  {
    fixture: "helpers.vitest.txt",
    fileName: "helpers.vitest.test.ts",
    framework: "vitest",
    blocks: [
      row(17, "creates a valid post", BEHAV, [OPAQUE]),
      row(21, "creates a post the namespace helper accepts", BEHAV, [OPAQUE]),
      row(25, "limits the rate", "EMPTY"),
      row(29, "responds with 201", BEHAV, [BEHAV]),
      row(33, "publishes the post", BEHAV, [OPAQUE]),
      row(37, "shows the login form", BEHAV, [OPAQUE]),
    ],
  },
  {
    fixture: "helpers.node.txt",
    fileName: "helpers.node.test.ts",
    framework: "node",
    blocks: [
      row(11, "isolates tenants", BEHAV, [OPAQUE]),
      row(15, "saves the record", "EXISTENCE-ONLY", [EXISTS]),
      row(19, "saves the record with its id", BEHAV, [EXISTS, BEHAV]),
    ],
  },
  {
    fixture: "structure.vitest.txt",
    fileName: "structure.vitest.test.ts",
    framework: "vitest",
    blocks: [
      row(11, "doubles %i", BEHAV, [BEHAV]),
      row(15, "runs concurrently", BEHAV, [BEHAV]),
      row(20, "sits at the outer level", BEHAV, [BEHAV]),
      row(26, "shared", BEHAV, [OPAQUE]),
    ],
  },
  {
    fixture: "structure.node.txt",
    fileName: "structure.node.test.ts",
    framework: "node",
    blocks: [
      row(6, "schedules", BEHAV, [BEHAV]),
      row(10, "publishes", BEHAV, [BEHAV]),
      row(16, "works", BEHAV, [BEHAV]),
    ],
  },
  {
    fixture: "real-auditMiddleware.vitest.txt",
    fileName: "apps/api/tests/unit/auditMiddleware.test.ts",
    framework: "vitest",
    blocks: [
      row(7, "should detect CACHE_CLEARED action from admin cache routes", "EXISTENCE-ONLY", [
        EXISTS,
      ]),
      row(20, "should return undefined for GET requests on unknown routes", "TITLE-CONTRADICTION", [
        EXISTS,
      ]),
    ],
  },
  {
    fixture: "real-webhookHandler.vitest.txt",
    fileName: "apps/api/tests/unit/webhookHandler.stats.test.ts",
    framework: "vitest",
    blocks: [
      row(7, "should not retry events not yet due", "TAUTOLOGY-ONLY", [TAUT]),
      row(28, "should filter retry events by max age", "TAUTOLOGY-ONLY", [TAUT]),
    ],
  },
];

const classify = (fixture: string, fileName: string) => classifyFile(source(fixture), fileName);

const blockAt = (fixture: string, fileName: string, line: number) => {
  const block = classify(fixture, fileName).blocks.find((candidate) => candidate.loc.line === line);
  if (block === undefined) throw new Error(`no block reported at ${fileName}:${String(line)}`);
  return block;
};

describe("classifyFile", () => {
  describe.each(FIXTURES)("$fixture", ({ fixture, fileName, framework, blocks }) => {
    it("reports every leaf block, in source order, with its file:line:title id", () => {
      const result = classify(fixture, fileName);

      expect(result.framework).toBe(framework);
      expect(result.blocks.map((block) => block.id)).toEqual(
        blocks.map((block) => `${fileName}:${String(block.line)}:${block.title}`)
      );
    });

    it.each(blocks)("line $line, $title: $blockClass", (expected) => {
      const block = blockAt(fixture, fileName, expected.line);

      expect(block.title).toBe(expected.title);
      expect(block.blockClass).toBe(expected.blockClass);
      expect(block.flags).toEqual(expected.flags);
      expect(block.assertions.map((assertion) => assertion.assertionClass)).toEqual(
        expected.assertions
      );
      expect(block.criteria).toEqual(CRITERIA[block.blockClass]);
    });
  });

  describe("the real cases", () => {
    it("names auditMiddleware.test.ts:274 a title contradiction: undefined promised, presence asserted", () => {
      const block = blockAt(
        "real-auditMiddleware.vitest.txt",
        "apps/api/tests/unit/auditMiddleware.test.ts",
        20
      );

      expect(block.contradiction).toBe("returns-nothing");
      expect(block.criteria).toEqual([]);
      expect(block.assertions).toEqual([
        expect.objectContaining({ line: 30, name: "toBeTruthy", assertionClass: EXISTS }),
      ]);
    });

    it("names webhookHandler.stats.test.ts:355 a tautology: `retriedCount >= 0` cannot fail", () => {
      const block = blockAt(
        "real-webhookHandler.vitest.txt",
        "apps/api/tests/unit/webhookHandler.stats.test.ts",
        7
      );

      expect(block.criteria).toEqual(["d"]);
      expect(block.assertions).toEqual([
        expect.objectContaining({ line: 25, name: "toBeTruthy", assertionClass: TAUT }),
      ]);
    });
  });

  describe("what each class reports beyond its name", () => {
    it("states why a title contradiction is one, and only on a title contradiction", () => {
      const vitestReasons = classify("title-contradiction.vitest.txt", "tc.test.ts").blocks.map(
        (block) => block.contradiction
      );
      const nodeReasons = classify("title-contradiction.node.txt", "tc.test.ts").blocks.map(
        (block) => block.contradiction
      );

      expect(vitestReasons).toEqual([
        "returns-nothing",
        null,
        "throw-unchecked",
        null,
        "status-unnamed",
        null,
        "negative-existence",
        null,
        "throw-unchecked",
        null,
        null,
      ]);
      expect(nodeReasons).toEqual([
        "returns-nothing",
        null,
        "throw-unchecked",
        null,
        "status-unnamed",
        null,
        "negative-existence",
        null,
      ]);
    });

    it("marks an imported or unseen helper opaque, and inlines a same-file helper one level", () => {
      const result = classify("helpers.vitest.txt", "h.test.ts");
      const via = result.blocks.map((block) => block.assertions.map((assertion) => assertion.via));

      expect(result.opaqueHelpers).toEqual([
        "authPage.expectLoginFormVisible",
        "expectStatus",
        "expectValidPost",
        "helpers.expectCreated",
      ]);
      expect(via).toEqual([[null], [null], [], ["expectStatus"], ["assertPublished"], [null]]);
      expect(result.blocks.map((block) => block.opaque)).toEqual([
        true,
        true,
        false,
        false,
        true,
        true,
      ]);
    });

    it("records the line of every success print", () => {
      const prints = classify("prints-success.vitest.txt", "p.test.ts").blocks.map(
        (block) => block.successPrints
      );

      expect(prints).toEqual([[8], [17], [], [26]]);
    });

    it("maps every block class to its criterion of the demolition plan", () => {
      expect(CRITERIA).toEqual({
        [BLOCK_CLASS.EMPTY]: ["a"],
        [BLOCK_CLASS.EXISTENCE_ONLY]: ["a"],
        [BLOCK_CLASS.SELF_SKIP]: ["c"],
        [BLOCK_CLASS.TAUTOLOGY_ONLY]: ["d"],
        [BLOCK_CLASS.CONDITIONAL_ONLY]: ["d"],
        [BLOCK_CLASS.PRINTS_SUCCESS]: ["d"],
        [BLOCK_CLASS.TITLE_CONTRADICTION]: [],
        [BLOCK_CLASS.BEHAVIOURAL]: [],
      });
    });
  });

  describe("the file", () => {
    it("carries the framework and the file-context hash of block discovery, and the opaque helpers", () => {
      const result = classify("structure.vitest.txt", "st.test.ts");

      expect(result.path).toBe("st.test.ts");
      expect(result.fileContextHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.opaqueHelpers).toEqual(["sharedSuite"]);
    });
  });

  describe("determinism", () => {
    it("returns deep-equal output for the same input, every fixture", () => {
      for (const { fixture, fileName } of FIXTURES) {
        const first = JSON.stringify(classify(fixture, fileName));
        const second = JSON.stringify(classify(fixture, fileName));

        expect(second).toBe(first);
      }
    });
  });

  describe("loading", () => {
    it("loads under node's own ESM loader, outside vitest's module graph", async () => {
      const entry = new URL("../src/index.js", import.meta.url).href;
      const worker = new Worker(
        `import(${JSON.stringify(entry)}).then((module) => {` +
          `require("node:worker_threads").parentPort.postMessage(Object.keys(module).sort());` +
          `});`,
        { eval: true }
      );
      const exited = once(worker, "exit");
      const [exports] = (await once(worker, "message")) as [string[]];

      expect(exports).toEqual([
        "ASSERTION_CLASS",
        "BLOCK_CLASS",
        "CRITERIA",
        "classifyFile",
        "default",
      ]);
      expect(await exited).toEqual([0]);
    });
  });
});
