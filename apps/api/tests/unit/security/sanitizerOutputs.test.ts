/**
 * @file sanitizerOutputs.test.ts
 * @description Characterization of the two production HTML sanitizer callers —
 *   `EnhancedValidator.sanitizeString(input, "html")` (an explicit allowlist with no
 *   attributes) and `ServerTemplateEngine.sanitize` (DOMPurify's default profile) — over
 *   a fixed hostile corpus, asserting the EXACT output string of each. Both reach
 *   DOMPurify through `isomorphic-dompurify`, which parses with jsdom on the server, so
 *   a parser or sanitizer upgrade can change what survives without any source change.
 *   Containment checks cannot see that drift; exact equality can. Every expected
 *   string is an output observed on the resolved dependency stack, never derived by
 *   hand: a row that goes red is a behaviour change of the sanitizer to be reviewed,
 *   not a literal to refresh.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { PrismaClient } from "@infra/prisma";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { EnhancedValidator } from "../../../src/security/enhancedValidator.js";
import { ServerTemplateEngine } from "../../../src/lib/templates/ServerTemplateEngine.js";

interface SanitizerCase {
  /** What the input exercises; becomes the test name. */
  readonly name: string;
  /** Markup handed to both callers unchanged. */
  readonly input: string;
  /** Observed output of `EnhancedValidator.sanitizeString(input, "html")`. */
  readonly validatorHtml: string;
  /** Observed output of `ServerTemplateEngine.sanitize(input)`. */
  readonly templateEngine: string;
}

// `sanitize` never reaches the database, so the engine is built over an empty client.
const unusedPrisma = {} as unknown as PrismaClient;

const CASES: readonly SanitizerCase[] = [
  {
    name: "a script element",
    input: "<p>kept</p><script>alert(1)</script>",
    validatorHtml: "<p>kept</p>",
    templateEngine: "<p>kept</p>",
  },
  {
    name: "an inline event handler on an image",
    input: "<img src=x onerror=alert(1)>",
    validatorHtml: "",
    templateEngine: '<img src="x">',
  },
  {
    name: "a mixed-case javascript URL on an image",
    input: "<IMG SRC=JaVaScRiPt:alert('XSS')>",
    validatorHtml: "",
    templateEngine: "<img>",
  },
  {
    name: "a javascript URL on a link",
    input: '<a href="javascript:alert(1)">link</a>',
    validatorHtml: "link",
    templateEngine: "<a>link</a>",
  },
  {
    name: "a tab-encoded javascript URL on a link",
    input: '<a href="jav&#x09;ascript:alert(1)">link</a>',
    validatorHtml: "link",
    templateEngine: "<a>link</a>",
  },
  {
    name: "a data URL on a link",
    input: '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">data</a>',
    validatorHtml: "data",
    templateEngine: "<a>data</a>",
  },
  {
    name: "a data URL on an image",
    input: '<img src="data:image/png;base64,iVBORw0KGgo=">',
    validatorHtml: "",
    templateEngine: '<img src="data:image/png;base64,iVBORw0KGgo=">',
  },
  {
    name: "an https link with target and rel",
    input: '<a href="https://example.com/" target="_blank" rel="noopener">site</a>',
    validatorHtml: "site",
    templateEngine: '<a href="https://example.com/" rel="noopener">site</a>',
  },
  {
    name: "an svg carrying onload",
    input: '<svg onload=alert(1)><circle r="1"></circle></svg>',
    validatorHtml: "",
    templateEngine: '<svg><circle r="1"></circle></svg>',
  },
  {
    name: "a math element carrying a javascript href",
    input: '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    validatorHtml: "",
    templateEngine: "<math><mi>x</mi></math>",
  },
  {
    name: "an iframe",
    input: '<iframe src="https://evil.example/"></iframe><p>after</p>',
    validatorHtml: "<p>after</p>",
    templateEngine: "<p>after</p>",
  },
  {
    name: "object and embed elements",
    input: '<object data="evil.swf"></object><embed src="evil.swf"><p>after</p>',
    validatorHtml: "<p>after</p>",
    templateEngine: "<p>after</p>",
  },
  {
    name: "a style element",
    input: "<style>body{background:url(javascript:alert(1))}</style><p>styled</p>",
    validatorHtml: "<p>styled</p>",
    templateEngine: "<p>styled</p>",
  },
  {
    name: "style and event attributes on an allowed tag",
    input: '<p style="color:red" onclick="alert(1)">attrs</p>',
    validatorHtml: "<p>attrs</p>",
    templateEngine: '<p style="color:red">attrs</p>',
  },
  // `ALLOWED_ATTR: []` does not remove `data-*`: DOMPurify's ALLOW_DATA_ATTR defaults to
  // true and is checked independently of the attribute allowlist.
  {
    name: "class, id and data attributes on an allowed tag",
    input: '<strong class="x" id="y" data-x="1">kept tag</strong>',
    validatorHtml: '<strong data-x="1">kept tag</strong>',
    templateEngine: '<strong class="x" id="y" data-x="1">kept tag</strong>',
  },
  {
    name: "an html comment",
    input: "<!-- secret --><p>after comment</p>",
    validatorHtml: "<p>after comment</p>",
    templateEngine: "<p>after comment</p>",
  },
  // Input without a `<` is returned untouched, never parsed; the next row exercises the
  // parser's entity serialization instead.
  {
    name: "escaped entities with no markup",
    input: "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot; &#x3C;b&#x3E;",
    validatorHtml: "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot; &#x3C;b&#x3E;",
    templateEngine: "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot; &#x3C;b&#x3E;",
  },
  {
    name: "escaped entities inside markup",
    input: "<p>&lt;b&gt; &amp; &#x3C;i&#x3E; &quot;q&quot; &nbsp;&copy;</p>",
    validatorHtml: '<p>&lt;b&gt; &amp; &lt;i&gt; "q" &nbsp;©</p>',
    templateEngine: '<p>&lt;b&gt; &amp; &lt;i&gt; "q" &nbsp;©</p>',
  },
  {
    name: "unclosed markup",
    input: "<p>unclosed <strong>bold <em>both",
    validatorHtml: "<p>unclosed <strong>bold <em>both</em></strong></p>",
    templateEngine: "<p>unclosed <strong>bold <em>both</em></strong></p>",
  },
  {
    name: "misnested markup",
    input: "<div><p>nested</div></p>",
    validatorHtml: "<p>nested</p><p></p>",
    templateEngine: "<div><p>nested</p></div><p></p>",
  },
  {
    name: "a noscript title mutation payload",
    input: '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    validatorHtml: "<p></p>",
    templateEngine: "<p></p>",
  },
  {
    name: "an svg style mutation payload",
    input: "<svg><style><img src=x onerror=1></style></svg>",
    validatorHtml: "",
    templateEngine: '<svg><style></style></svg><img src="x">',
  },
  {
    name: "a form and mglyph namespace-confusion payload",
    input: "<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>",
    validatorHtml: "",
    templateEngine: "<form><math><mtext><form></form></mtext></math></form>",
  },
  {
    name: "list, break and underline markup",
    input: '<ul><li title="t">one</li><li>two</li></ul><ol><li>x</li></ol><br><u>u</u>',
    validatorHtml: "<ul><li>one</li><li>two</li></ul><ol><li>x</li></ol><br><u>u</u>",
    templateEngine: '<ul><li title="t">one</li><li>two</li></ul><ol><li>x</li></ol><br><u>u</u>',
  },
  {
    name: "a table",
    input: "<table><tr><td>cell</td></tr></table>",
    validatorHtml: "cell",
    templateEngine: "<table><tbody><tr><td>cell</td></tr></tbody></table>",
  },
  {
    name: "plain text with an ampersand",
    input: "Hello world & friends",
    validatorHtml: "Hello world & friends",
    templateEngine: "Hello world & friends",
  },
  {
    name: "an empty string",
    input: "",
    validatorHtml: "",
    templateEngine: "",
  },
];

describe("EnhancedValidator.sanitizeString in the html context", () => {
  let validator: EnhancedValidator;

  beforeEach(() => {
    validator = new EnhancedValidator(new NoopBackgroundTaskScheduler());
  });

  afterEach(() => {
    validator.destroy();
  });

  it.each(CASES)("returns the observed output when given $name", ({ input, validatorHtml }) => {
    const output = validator.sanitizeString(input, "html");

    expect(output).toBe(validatorHtml);
  });

  it("returns the observed sanitized body when validateInput reaches the html context", () => {
    const body = { body: '<p class="lead" title="t">Hello <em>there</em></p><u>u</u>' };

    const result = validator.validateInput(body, "html");

    expect(result).toStrictEqual({
      isValid: true,
      sanitized: { body: "<p>Hello <em>there</em></p><u>u</u>" },
      threats: [],
      risk: "low",
    });
  });
});

describe("ServerTemplateEngine.sanitize with the default DOMPurify profile", () => {
  let engine: ServerTemplateEngine;

  beforeEach(() => {
    engine = new ServerTemplateEngine(unusedPrisma);
  });

  it.each(CASES)("returns the observed output when given $name", ({ input, templateEngine }) => {
    const output = engine.sanitize(input);

    expect(output).toBe(templateEngine);
  });
});
