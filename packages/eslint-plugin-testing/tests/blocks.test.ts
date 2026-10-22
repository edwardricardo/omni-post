/**
 * @file blocks.test.ts
 * @description Suite for `src/blocks.js`, the block discovery of the classifier: which test blocks a
 *              file reports and what their syntax says before any assertion is read. Fixtures are
 *              source text under `tests/fixtures/classifier/` (a `.txt` name is no collector's,
 *              compiler's or linter's input), in vitest, node:test and Playwright. The cases pin
 *              the reported leaves and their `file:line:title` ids, kinds, locations, modifiers,
 *              describe paths and skip markers; that containers are not reported; the framework
 *              and import bindings; a callback passed by name; and the content-addressed hashes.
 * @layer infrastructure
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { discoverBlocks } from "../src/blocks.js";

const source = (fixture: string): string =>
  readFileSync(new URL(`./fixtures/classifier/${fixture}`, import.meta.url), "utf8");

const discover = (fixture: string, fileName: string) => discoverBlocks(source(fixture), fileName);

/** The serializable part of each reported block. */
const shapes = (fixture: string, fileName: string) =>
  discover(fixture, fileName).blocks.map((block) => ({
    id: block.id,
    kind: block.kind,
    describe: block.describe,
    modifiers: block.modifiers,
    skips: block.skips,
  }));

describe("discoverBlocks", () => {
  describe("leaves, containers and describe paths", () => {
    it("reports vitest leaves under their containers' titles, with their modifiers as written", () => {
      expect(shapes("structure.vitest.txt", "st.test.ts")).toEqual([
        {
          id: "st.test.ts:11:doubles %i",
          kind: "it",
          describe: ["outer", "inner"],
          modifiers: ["each"],
          skips: [],
        },
        {
          id: "st.test.ts:15:runs concurrently",
          kind: "it",
          describe: ["outer", "inner"],
          modifiers: ["concurrent"],
          skips: [],
        },
        {
          id: "st.test.ts:20:sits at the outer level",
          kind: "test",
          describe: ["outer"],
          modifiers: [],
          skips: [],
        },
        { id: "st.test.ts:26:shared", kind: "describe", describe: [], modifiers: [], skips: [] },
      ]);
    });

    it("reports node:test subtests as t.test under their parent test, and a suite as a container", () => {
      expect(shapes("structure.node.txt", "st.test.ts")).toEqual([
        {
          id: "st.test.ts:6:schedules",
          kind: "t.test",
          describe: ["publishing"],
          modifiers: [],
          skips: [],
        },
        {
          id: "st.test.ts:10:publishes",
          kind: "t.test",
          describe: ["publishing"],
          modifiers: [],
          skips: [],
        },
        {
          id: "st.test.ts:16:works",
          kind: "it",
          describe: ["suite level"],
          modifiers: [],
          skips: [],
        },
      ]);
    });

    it("reads Playwright's test.describe as a container and its own skip modifier as a skip", () => {
      expect(shapes("structure.playwright.txt", "pw.spec.ts")).toEqual([
        { id: "pw.spec.ts:6:logs in", kind: "test", describe: ["auth"], modifiers: [], skips: [] },
        {
          id: "pw.spec.ts:12:signs up",
          kind: "test",
          describe: ["auth", "sign-up"],
          modifiers: ["fixme"],
          skips: ["fixme"],
        },
      ]);
    });

    it("locates a block from its call to the end of its arguments, 1-based", () => {
      const [first, , third] = discover("structure.vitest.txt", "st.test.ts").blocks;

      expect(first?.loc).toEqual({ line: 11, col: 5, endLine: 13, endCol: 7 });
      expect(third?.loc).toEqual({ line: 20, col: 3, endLine: 23, endCol: 5 });
    });

    it("keeps a callback passed by name as external, so a reader can see the block is not empty", () => {
      const shared = discover("structure.vitest.txt", "st.test.ts").blocks[3];

      expect(shared?.callback).toBeNull();
      expect(shared?.external?.getText()).toBe("sharedSuite");
    });
  });

  describe("skip markers", () => {
    it("names every vitest skip: modifier, condition, todo, no function, context.skip, parent", () => {
      expect(shapes("self-skip.vitest.txt", "s.test.ts").map((block) => block.skips)).toEqual([
        ["skip"],
        ["skipIf"],
        ["todo"],
        ["todo"],
        ["context.skip"],
        [],
        ["parent:skip"],
        ["todo"],
      ]);
    });

    it("names every node:test skip: options, t.skip(), a skipped suite; `skip: false` is none", () => {
      expect(shapes("self-skip.node.txt", "s.test.ts").map((block) => block.skips)).toEqual([
        ["option:skip"],
        ["context.skip"],
        ["option:todo"],
        ["parent:option:skip"],
        [],
      ]);
    });

    it("reads a node:test block with no function as not skipped: node runs it as an empty pass", () => {
      const planned = discover("empty.node.txt", "e.test.ts").blocks[2];

      expect(planned?.title).toBe("is planned");
      expect(planned?.callback).toBeNull();
      expect(planned?.skips).toEqual([]);
    });
  });

  describe("the file", () => {
    it("is node:test when it imports a value from node:test, vitest otherwise", () => {
      expect(discover("structure.node.txt", "a.test.ts").framework).toBe("node");
      expect(discover("structure.vitest.txt", "a.test.ts").framework).toBe("vitest");
      expect(discover("structure.playwright.txt", "a.spec.ts").framework).toBe("vitest");
    });

    it("lists every value binding of its imports, aliases and named `strict` included", () => {
      expect(discover("structure.node.txt", "a.test.ts").bindings).toEqual([
        { local: "it", imported: "it", from: "node:test" },
        { local: "suite", imported: "suite", from: "node:test" },
        { local: "test", imported: "test", from: "node:test" },
        { local: "assert", imported: "strict", from: "node:assert" },
      ]);
    });
  });

  describe("content-addressed hashes", () => {
    const base = source("structure.vitest.txt");
    const baseline = discoverBlocks(base, "st.test.ts");

    it("keeps the file-context hash when only a block body changes, and moves that body's hash", () => {
      const edited = discoverBlocks(
        base.replace("expect(await one()).toBe(1);", "expect(await one()).toBe(2);"),
        "st.test.ts"
      );

      expect(edited.fileContextHash).toBe(baseline.fileContextHash);
      expect(edited.blocks[1]?.bodyHash).not.toBe(baseline.blocks[1]?.bodyHash);
      expect(edited.blocks[0]?.bodyHash).toBe(baseline.blocks[0]?.bodyHash);
    });

    it("moves the file-context hash when a hook changes, and keeps every body hash", () => {
      const edited = discoverBlocks(
        base.replace("reset();", "reset({ hard: true });"),
        "st.test.ts"
      );

      expect(edited.fileContextHash).not.toBe(baseline.fileContextHash);
      expect(edited.blocks.map((block) => block.bodyHash)).toEqual(
        baseline.blocks.map((block) => block.bodyHash)
      );
    });

    it("hashes a body by its tokens: comments and layout do not move it", () => {
      const relaid = discoverBlocks(
        base.replace(
          "    // a comment the body hash ignores\n    expect(one()).toBe(1);",
          "    expect(\n      one()\n    ).toBe(1); /* another comment */"
        ),
        "st.test.ts"
      );

      expect(relaid.blocks[2]?.bodyHash).toBe(baseline.blocks[2]?.bodyHash);
    });
  });
});
