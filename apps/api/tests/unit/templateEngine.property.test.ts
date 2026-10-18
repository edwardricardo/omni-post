/**
 * @file templateEngine.property.test.ts
 * @description Property suite for template rendering through `ServerTemplateEngine` (its
 *   BaseTemplateEngine `compile` and `render`): rendering is deterministic for templates built
 *   from variables, sections and the pure helpers; `{{v}}` escapes every character Handlebars
 *   treats as dangerous and loses nothing, while `{{{v}}}` returns the value verbatim; `render`
 *   answers any template string with a result instead of throwing; and the character and word
 *   counts describe the rendered content. Every run is pinned to one seed, so a failure replays
 *   as fast-check prints it (`fc.assert(property, { seed, path })`).
 * @layer infrastructure
 */

import { beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import fc from "fast-check";
import type { PrismaClient } from "@infra/prisma";
import { ServerTemplateEngine } from "../../src/lib/templates/ServerTemplateEngine.js";

/**
 * One fixed seed for every property of this file, so CI reproduces a failure byte for byte; 100
 * runs is fast-check's own default, and one render costs well under a millisecond.
 */
const PROPERTY_RUN = { seed: 20_261_018, numRuns: 100 } as const;

// The rendering methods exercised here never reach the database.
const stubPrisma = {} as unknown as PrismaClient;

/** Handlebars's escape table: the characters `{{v}}` must never emit raw. */
const ESCAPES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#x60;": "`",
  "&#x3D;": "=",
};
const ENTITY = /&amp;|&lt;|&gt;|&quot;|&#x27;|&#x60;|&#x3D;/g;
const RAW_DANGEROUS = /[<>"'`=]/;
const BARE_AMPERSAND = /&(?!amp;|lt;|gt;|quot;|#x27;|#x60;|#x3D;)/;

const unescape = (html: string): string => html.replace(ENTITY, (entity) => ESCAPES[entity] ?? "");

/** Printable text with no Handlebars delimiter or escape, so it stays literal in a template. */
const literalText = fc.string({ maxLength: 20 }).map((text) => text.replace(/[{}\\]/g, ""));

/** Self-balanced fragments over the context below; none calls the `random` helper. */
const fragment = fc.oneof(
  literalText,
  fc.constantFrom(
    "{{name}}",
    "{{{bio}}}",
    "{{uppercase name}}",
    "{{lowercase bio}}",
    "{{capitalize name}}",
    "{{#if premium}}gold {{/if}}",
    "{{#unless premium}}free {{/unless}}",
    "{{#each tags}}#{{this}} {{/each}}",
    "{{!-- a comment --}}"
  )
);
const template = fc.array(fragment, { maxLength: 12 }).map((parts) => parts.join(""));

const context = fc.record({
  name: fc.string({ maxLength: 20 }),
  bio: fc.string({ maxLength: 40 }),
  premium: fc.boolean(),
  tags: fc.array(fc.stringMatching(/^[a-z]{1,8}$/), { maxLength: 4 }),
});

/** Template strings around the grammar's edge: unbalanced sections, stray braces, partials. */
const anyTemplate = fc.oneof(
  fc.string(),
  fc
    .array(
      fc.oneof(
        literalText,
        fc.constantFrom(
          "{{",
          "}}",
          "{{#if x}}",
          "{{/if}}",
          "{{/each}}",
          "{{> missing}}",
          "{{else}}"
        )
      ),
      { maxLength: 8 }
    )
    .map((parts) => parts.join(""))
);

describe("ServerTemplateEngine rendering (property)", () => {
  let engine: ServerTemplateEngine;

  beforeEach(() => {
    engine = new ServerTemplateEngine(stubPrisma);
  });

  it("renders the same template and context to the same output every time", () => {
    const other = new ServerTemplateEngine(stubPrisma);
    fc.assert(
      fc.property(template, context, (source, values) => {
        const first = engine.render(source, values);
        const second = engine.render(source, values);
        const fresh = other.render(source, values);

        assert.ok(first.success, first.errors?.join("; ") ?? "render reported no error");
        assert.strictEqual(second.content, first.content);
        assert.strictEqual(fresh.content, first.content);
        assert.deepStrictEqual(second.usedVariables, first.usedVariables);
        assert.strictEqual(second.metadata?.wordCount, first.metadata?.wordCount);
      }),
      PROPERTY_RUN
    );
  });

  it("escapes every dangerous character of {{v}} reversibly and keeps {{{v}}} verbatim", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string({ unit: "grapheme" })), (value) => {
        const escaped = engine.render("{{v}}", { v: value }).content ?? "";
        const raw = engine.render("{{{v}}}", { v: value }).content;

        assert.doesNotMatch(escaped, RAW_DANGEROUS);
        assert.doesNotMatch(escaped, BARE_AMPERSAND);
        assert.strictEqual(unescape(escaped), value);
        assert.strictEqual(raw, value);
      }),
      PROPERTY_RUN
    );
  });

  it("answers any template string with a result instead of throwing", () => {
    fc.assert(
      fc.property(anyTemplate, context, (source, values) => {
        const result = engine.render(source, values);

        if (result.success) {
          assert.strictEqual(typeof result.content, "string");
        } else {
          assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
        }
      }),
      PROPERTY_RUN
    );
  });

  it("counts the characters and the whitespace-separated words of the rendered content", () => {
    fc.assert(
      fc.property(template, context, (source, values) => {
        const result = engine.render(source, values);
        const content = result.content ?? "";

        assert.strictEqual(result.metadata?.characterCount, content.length);
        assert.strictEqual(result.metadata?.wordCount, content.match(/\S+/g)?.length ?? 0);
      }),
      PROPERTY_RUN
    );
  });
});
