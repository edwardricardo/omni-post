/**
 * @file sanitizerOutputs.test.ts
 * @description Characterization of `ServerTemplateEngine.sanitize`, the API's one caller of
 *   DOMPurify (its default profile), over a fixed hostile corpus, asserting the EXACT output
 *   string of each input. It reaches DOMPurify through `isomorphic-dompurify`, which parses
 *   with jsdom on the server, so a parser or sanitizer upgrade can change what survives
 *   without any source change. Containment checks cannot see that drift; exact equality can.
 *   Every expected string is an output observed on the resolved dependency stack, never
 *   derived by hand: a row that goes red is a behaviour change of the sanitizer to be
 *   reviewed, not a literal to refresh.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { PrismaClient } from "@infra/prisma";
import { ServerTemplateEngine } from "../../../src/lib/templates/ServerTemplateEngine.js";

interface SanitizerCase {
  /** What the input exercises; becomes the test name. */
  readonly name: string;
  /** Markup handed to the engine unchanged. */
  readonly input: string;
  /** Observed output of `ServerTemplateEngine.sanitize(input)`. */
  readonly templateEngineHtml: string;
}

/**
 * The client the engine's constructor requires. `sanitize` never reaches the database, so a read
 * of any member is a broken premise of this suite: it throws an error naming the member, instead of
 * returning `undefined` for a later call to fail on with a bare TypeError.
 */
const makeUnusedPrismaClient = (): PrismaClient =>
  new Proxy({} as PrismaClient, {
    get(_client, member): never {
      throw new Error(
        `the sanitizer suite's unused PrismaClient was read at "${String(member)}": ` +
          "ServerTemplateEngine.sanitize must not reach the database"
      );
    },
  });

const CASES: readonly SanitizerCase[] = [
  {
    name: "a script element",
    input: "<p>kept</p><script>alert(1)</script>",
    templateEngineHtml: "<p>kept</p>",
  },
  {
    name: "an inline event handler on an image",
    input: "<img src=x onerror=alert(1)>",
    templateEngineHtml: '<img src="x">',
  },
  {
    name: "a mixed-case javascript URL on an image",
    input: "<IMG SRC=JaVaScRiPt:alert('XSS')>",
    templateEngineHtml: "<img>",
  },
  {
    name: "a javascript URL on a link",
    input: '<a href="javascript:alert(1)">link</a>',
    templateEngineHtml: "<a>link</a>",
  },
  {
    name: "a tab-encoded javascript URL on a link",
    input: '<a href="jav&#x09;ascript:alert(1)">link</a>',
    templateEngineHtml: "<a>link</a>",
  },
  {
    name: "a data URL on a link",
    input: '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">data</a>',
    templateEngineHtml: "<a>data</a>",
  },
  {
    name: "a data URL on an image",
    input: '<img src="data:image/png;base64,iVBORw0KGgo=">',
    templateEngineHtml: '<img src="data:image/png;base64,iVBORw0KGgo=">',
  },
  {
    name: "an https link with target and rel",
    input: '<a href="https://example.com/" target="_blank" rel="noopener">site</a>',
    templateEngineHtml: '<a href="https://example.com/" rel="noopener">site</a>',
  },
  {
    name: "an svg carrying onload",
    input: '<svg onload=alert(1)><circle r="1"></circle></svg>',
    templateEngineHtml: '<svg><circle r="1"></circle></svg>',
  },
  {
    name: "a math element carrying a javascript href",
    input: '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    templateEngineHtml: "<math><mi>x</mi></math>",
  },
  {
    name: "an iframe",
    input: '<iframe src="https://evil.example/"></iframe><p>after</p>',
    templateEngineHtml: "<p>after</p>",
  },
  {
    name: "object and embed elements",
    input: '<object data="evil.swf"></object><embed src="evil.swf"><p>after</p>',
    templateEngineHtml: "<p>after</p>",
  },
  {
    name: "a style element",
    input: "<style>body{background:url(javascript:alert(1))}</style><p>styled</p>",
    templateEngineHtml: "<p>styled</p>",
  },
  {
    name: "style and event attributes on an allowed tag",
    input: '<p style="color:red" onclick="alert(1)">attrs</p>',
    templateEngineHtml: '<p style="color:red">attrs</p>',
  },
  {
    name: "class, id and data attributes on an allowed tag",
    input: '<strong class="x" id="y" data-x="1">kept tag</strong>',
    templateEngineHtml: '<strong class="x" id="y" data-x="1">kept tag</strong>',
  },
  {
    name: "an html comment",
    input: "<!-- secret --><p>after comment</p>",
    templateEngineHtml: "<p>after comment</p>",
  },
  // The next row carries no markup at all: it exercises the parser's entity serialization alone.
  {
    name: "escaped entities with no markup",
    input: "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot; &#x3C;b&#x3E;",
    templateEngineHtml:
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot; &#x3C;b&#x3E;",
  },
  {
    name: "escaped entities inside markup",
    input: "<p>&lt;b&gt; &amp; &#x3C;i&#x3E; &quot;q&quot; &nbsp;&copy;</p>",
    templateEngineHtml: '<p>&lt;b&gt; &amp; &lt;i&gt; "q" &nbsp;©</p>',
  },
  {
    name: "unclosed markup",
    input: "<p>unclosed <strong>bold <em>both",
    templateEngineHtml: "<p>unclosed <strong>bold <em>both</em></strong></p>",
  },
  {
    name: "misnested markup",
    input: "<div><p>nested</div></p>",
    templateEngineHtml: "<div><p>nested</p></div><p></p>",
  },
  {
    name: "a noscript title mutation payload",
    input: '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    templateEngineHtml: "<p></p>",
  },
  {
    name: "an svg style mutation payload",
    input: "<svg><style><img src=x onerror=1></style></svg>",
    templateEngineHtml: '<svg><style></style></svg><img src="x">',
  },
  {
    name: "a form and mglyph namespace-confusion payload",
    input: "<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>",
    templateEngineHtml: "<form><math><mtext><form></form></mtext></math></form>",
  },
  {
    name: "list, break and underline markup",
    input: '<ul><li title="t">one</li><li>two</li></ul><ol><li>x</li></ol><br><u>u</u>',
    templateEngineHtml:
      '<ul><li title="t">one</li><li>two</li></ul><ol><li>x</li></ol><br><u>u</u>',
  },
  {
    name: "a table",
    input: "<table><tr><td>cell</td></tr></table>",
    templateEngineHtml: "<table><tbody><tr><td>cell</td></tr></tbody></table>",
  },
  {
    name: "plain text with an ampersand",
    input: "Hello world & friends",
    templateEngineHtml: "Hello world & friends",
  },
  {
    name: "an empty string",
    input: "",
    templateEngineHtml: "",
  },
];

describe("ServerTemplateEngine.sanitize with the default DOMPurify profile", () => {
  let engine: ServerTemplateEngine;

  beforeEach(() => {
    engine = new ServerTemplateEngine(makeUnusedPrismaClient());
  });

  it.each(CASES)(
    "returns the observed output when given $name",
    ({ input, templateEngineHtml }) => {
      const output = engine.sanitize(input);

      expect(output).toBe(templateEngineHtml);
    }
  );
});
