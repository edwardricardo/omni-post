/**
 * @file i18nLint.test.ts
 * @description Pins `scripts/testing/i18n-lint.mjs`, fitness #51. The gate discovers every portal
 *   (a directory directly under `apps/` holding `i18n/routing.ts` and `messages/`), reads the
 *   routing's `locales` and `defaultLocale`, discovers the catalogs from `messages/*.json`, and holds
 *   the two locale sets equal. Every leaf of every catalog must be a string that parses as ICU, and
 *   every locale must carry the default locale's keys and, per message, its argument and tag names.
 *   A new locale is its catalog plus its entry in `locales`: the third-locale case pins that, and the
 *   two half-made cases pin that the gate names the missing half.
 *
 *   Each case plants a tree in a fresh directory under `tmpdir()` and runs the script with `--root`,
 *   asserting its exit code, stdout and stderr: 0 clean, 1 a violation, 2 usage, 3 an input it
 *   could not read in full. The last case runs it over this repository's own catalogs.
 * @layer infrastructure
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts", "testing", "i18n-lint.mjs");

/** One portal of a planted tree. */
interface PortalFixture {
  /** The routing's `locales`; ignored when `routingText` is given. */
  readonly locales?: readonly string[];
  /** The routing's `defaultLocale`; ignored when `routingText` is given. */
  readonly defaultLocale?: string;
  /** Replaces the whole routing.ts, for the unreadable-routing cases. */
  readonly routingText?: string;
  /** Locale → catalog; a string is written as is, so a fixture can hold text that is not JSON. */
  readonly messages: Readonly<Record<string, unknown>>;
}

interface GateResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

const EN = {
  common: {
    save: "Save",
    greeting: "Hello {name}",
    items: "{count, plural, one {# item} other {# items}}",
    terms: "Read the <link>terms of {product}</link>",
  },
  help: { steps: ["Open the menu", { title: "Pick {option}" }] },
};

const ES = {
  common: {
    save: "Guardar",
    greeting: "Hola {name}",
    items: "{count, plural, one {# elemento} other {# elementos}}",
    terms: "Lee los <link>términos de {product}</link>",
  },
  help: { steps: ["Abre el menú", { title: "Elige {option}" }] },
};

const FR = {
  common: {
    save: "Enregistrer",
    greeting: "Bonjour {name}",
    items: "{count, plural, one {# élément} other {# éléments}}",
    terms: "Lisez les <link>conditions de {product}</link>",
  },
  help: { steps: ["Ouvrez le menu", { title: "Choisissez {option}" }] },
};

/** A copy of a catalog with one value replaced at a dot path; `undefined` deletes the key. */
const withValue = (catalog: object, keyPath: string, value: unknown): Record<string, unknown> => {
  const copy = structuredClone(catalog) as Record<string, unknown>;
  const parts = keyPath.split(".");
  const last = parts.pop() ?? "";
  let node: Record<string, unknown> = copy;
  for (const part of parts) node = node[part] as Record<string, unknown>;
  if (value === undefined) delete node[last];
  else node[last] = value;
  return copy;
};

const routingFor = (locales: readonly string[], defaultLocale: string): string =>
  [
    'import { defineRouting } from "next-intl/routing";',
    "",
    "export const routing = defineRouting({",
    `  locales: [${locales.map((locale) => JSON.stringify(locale)).join(", ")}],`,
    `  defaultLocale: ${JSON.stringify(defaultLocale)},`,
    '  localePrefix: "always",',
    "});",
    "",
  ].join("\n");

const PORTAL: PortalFixture = {
  locales: ["en", "es"],
  defaultLocale: "en",
  messages: { en: EN, es: ES },
};

let scratch = "";

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "i18n-lint-"));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Plants the portals under `<scratch>/apps` and returns the tree's root. */
const plant = (portals: Readonly<Record<string, PortalFixture>>): string => {
  const root = path.join(scratch, "root");
  mkdirSync(path.join(root, "apps"), { recursive: true });
  for (const [name, portal] of Object.entries(portals)) {
    const dir = path.join(root, "apps", name);
    mkdirSync(path.join(dir, "i18n"), { recursive: true });
    mkdirSync(path.join(dir, "messages"), { recursive: true });
    writeFileSync(
      path.join(dir, "i18n", "routing.ts"),
      portal.routingText ?? routingFor(portal.locales ?? [], portal.defaultLocale ?? "")
    );
    for (const [locale, catalog] of Object.entries(portal.messages)) {
      const text = typeof catalog === "string" ? catalog : `${JSON.stringify(catalog, null, 2)}\n`;
      writeFileSync(path.join(dir, "messages", `${locale}.json`), text);
    }
  }
  return root;
};

const runGate = (args: readonly string[]): GateResult => {
  const result = spawnSync(process.execPath, [GATE_SCRIPT, ...args], { encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
};

/** Runs the gate over a planted admin portal (the given one) beside a clean client portal. */
const runOnAdmin = (admin: PortalFixture): GateResult =>
  runGate(["--root", plant({ admin, client: PORTAL })]);

const CLEAN_CLIENT_LINE = "client: 2 locales (en, es), 6 messages, reference en";

describe("i18n-lint, the clean trees", () => {
  it("passes two portals with complete catalogs and prints one summary line per portal", () => {
    const root = plant({ admin: PORTAL, client: PORTAL });

    const result = runGate(["--root", root]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        "i18n-lint: PASS",
        "admin: 2 locales (en, es), 6 messages, reference en",
        CLEAN_CLIENT_LINE,
        "",
      ].join("\n")
    );
  });

  it("passes a third locale that has its catalog and its entry in the routing, and changes nothing else", () => {
    const admin: PortalFixture = {
      locales: ["en", "es", "fr"],
      defaultLocale: "en",
      messages: { en: EN, es: ES, fr: FR },
    };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        "i18n-lint: PASS",
        "admin: 3 locales (en, es, fr), 6 messages, reference en",
        CLEAN_CLIENT_LINE,
        "",
      ].join("\n")
    );
  });

  it("passes a portal whose reference locale is not the first one in alphabetical order", () => {
    const admin: PortalFixture = {
      locales: ["es", "en"],
      defaultLocale: "es",
      messages: { en: EN, es: ES },
    };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        "i18n-lint: PASS",
        "admin: 2 locales (en, es), 6 messages, reference es",
        CLEAN_CLIENT_LINE,
        "",
      ].join("\n")
    );
  });

  it("reads a locales array wrapped onto several lines, as a formatter leaves a long one", () => {
    const wrapped = routingFor(["en", "es", "fr"], "en").replace(
      'locales: ["en", "es", "fr"],',
      'locales: [\n    "en",\n    "es",\n    "fr",\n  ],'
    );
    const admin: PortalFixture = { routingText: wrapped, messages: { en: EN, es: ES, fr: FR } };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        "i18n-lint: PASS",
        "admin: 3 locales (en, es, fr), 6 messages, reference en",
        CLEAN_CLIENT_LINE,
        "",
      ].join("\n")
    );
  });

  it("ignores a directory under apps/ that lacks i18n/routing.ts or messages/", () => {
    const root = plant({ admin: PORTAL, client: PORTAL });
    mkdirSync(path.join(root, "apps", "api", "src"), { recursive: true });
    mkdirSync(path.join(root, "apps", "workers", "messages"), { recursive: true });

    const result = runGate(["--root", root]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      [
        "i18n-lint: PASS",
        "admin: 2 locales (en, es), 6 messages, reference en",
        CLEAN_CLIENT_LINE,
        "",
      ].join("\n")
    );
  });
});

describe("i18n-lint, a locale made by one of its two edits", () => {
  it("names the routing edit when a catalog exists that the routing does not list", () => {
    const admin: PortalFixture = { ...PORTAL, messages: { en: EN, es: ES, fr: FR } };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      'i18n-lint admin: messages/fr.json exists but apps/admin/i18n/routing.ts does not list "fr"\n'
    );
  });

  it("names the catalog edit when the routing lists a locale that has no catalog", () => {
    const admin: PortalFixture = { ...PORTAL, locales: ["en", "es", "fr"] };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      'i18n-lint admin: apps/admin/i18n/routing.ts lists "fr" but messages/fr.json does not exist\n'
    );
  });

  it("refuses a defaultLocale the routing's locales do not list", () => {
    const admin: PortalFixture = { ...PORTAL, defaultLocale: "de" };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      'i18n-lint admin: apps/admin/i18n/routing.ts sets defaultLocale "de", which its locales do not list\n'
    );
  });
});

describe("i18n-lint, the catalogs against the reference locale", () => {
  it("names a key the reference holds and another locale lacks", () => {
    const admin: PortalFixture = {
      ...PORTAL,
      messages: { en: EN, es: withValue(ES, "common.save", undefined) },
    };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      'i18n-lint admin: messages/es.json lacks "common.save", which the reference messages/en.json holds\n'
    );
  });

  it("names a key another locale holds and the reference lacks", () => {
    const admin: PortalFixture = {
      ...PORTAL,
      messages: { en: EN, es: withValue(ES, "common.extra", "Extra") },
    };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      'i18n-lint admin: messages/es.json holds "common.extra", which the reference messages/en.json lacks\n'
    );
  });

  it("names the locale, the key and the parser's error of a message that is not valid ICU", () => {
    const admin: PortalFixture = {
      ...PORTAL,
      messages: { en: EN, es: withValue(ES, "common.greeting", "Hola {name") },
    };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      'i18n-lint admin: messages/es.json "common.greeting" is not valid ICU: EXPECT_ARGUMENT_CLOSING_BRACE\n'
    );
  });

  it("prints both argument sets when a message drops or renames an argument", () => {
    const admin: PortalFixture = {
      ...PORTAL,
      messages: { en: EN, es: withValue(ES, "common.greeting", "Hola {nombre}") },
    };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      'i18n-lint admin: messages/es.json "common.greeting" uses {nombre}, the reference messages/en.json uses {name}\n'
    );
  });

  it("reads the arguments inside a rich-text tag and the tag's own name", () => {
    const admin: PortalFixture = {
      ...PORTAL,
      messages: { en: EN, es: withValue(ES, "common.terms", "Lee los <a>términos</a>") },
    };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      'i18n-lint admin: messages/es.json "common.terms" uses {<a>}, the reference messages/en.json uses {<link>, product}\n'
    );
  });

  it("refuses a leaf that is not a string, naming its type", () => {
    const admin: PortalFixture = {
      ...PORTAL,
      messages: { en: EN, es: withValue(ES, "common.save", 42) },
    };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      'i18n-lint admin: messages/es.json "common.save" is a number, not a string\n'
    );
  });

  it("recurses an array by index, so a bad element is named by its position", () => {
    const steps = ["Abre el menú", { title: "Elige {opcion}" }];
    const admin: PortalFixture = {
      ...PORTAL,
      messages: { en: EN, es: withValue(ES, "help.steps", steps) },
    };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      'i18n-lint admin: messages/es.json "help.steps.1.title" uses {opcion}, the reference messages/en.json uses {option}\n'
    );
  });

  it("refuses a catalog whose top level is not an object", () => {
    const admin: PortalFixture = { ...PORTAL, messages: { en: EN, es: ["Guardar"] } };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "i18n-lint admin: messages/es.json holds an array, not an object of messages\n"
    );
  });

  it("reports every violation of every portal, the portals in name order", () => {
    const broken: PortalFixture = {
      ...PORTAL,
      messages: { en: EN, es: withValue(ES, "common.save", undefined) },
    };
    const root = plant({ client: broken, admin: broken });

    const result = runGate(["--root", root]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      [
        'i18n-lint admin: messages/es.json lacks "common.save", which the reference messages/en.json holds',
        'i18n-lint client: messages/es.json lacks "common.save", which the reference messages/en.json holds',
        "",
      ].join("\n")
    );
  });
});

describe("i18n-lint, an input it cannot read in full", () => {
  it("exits 3 when the tree holds no portal", () => {
    const root = plant({});

    const result = runGate(["--root", root]);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "i18n-lint: discovered 0 portals under apps/, below the floor of 2 (a portal is a directory directly under apps/ holding i18n/routing.ts and messages/)\n"
    );
  });

  it("exits 3 when a routing.ts holds no locales array of string literals", () => {
    const routingText = [
      'import { defineRouting } from "next-intl/routing";',
      'import { LOCALES } from "./locales";',
      "",
      "export const routing = defineRouting({",
      "  locales: LOCALES,",
      '  defaultLocale: "en",',
      "});",
      "",
    ].join("\n");
    const admin: PortalFixture = { ...PORTAL, routingText };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "i18n-lint admin: apps/admin/i18n/routing.ts holds no readable `locales: [...]` array of string literals\n"
    );
  });

  it("exits 3 when a routing.ts builds its locales array by code", () => {
    const admin: PortalFixture = {
      ...PORTAL,
      routingText: routingFor(["en", "es"], "en").replace(
        'locales: ["en", "es"]',
        'locales: [...BASE, "es"]'
      ),
    };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "i18n-lint admin: apps/admin/i18n/routing.ts holds no readable `locales: [...]` array of string literals\n"
    );
  });

  it("exits 3 when a routing.ts holds no defaultLocale string literal", () => {
    const admin: PortalFixture = {
      ...PORTAL,
      routingText: routingFor(["en", "es"], "en").replace('  defaultLocale: "en",\n', ""),
    };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      'i18n-lint admin: apps/admin/i18n/routing.ts holds no readable `defaultLocale: "..."` string literal\n'
    );
  });

  it("exits 3 when a catalog does not parse as JSON, and 3 wins over a violation elsewhere", () => {
    const admin: PortalFixture = { ...PORTAL, messages: { en: EN, es: "{ not json" } };
    const client: PortalFixture = {
      ...PORTAL,
      messages: { en: EN, es: withValue(ES, "common.save", undefined) },
    };
    const root = plant({ admin, client });

    const result = runGate(["--root", root]);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    const lines = result.stderr.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^i18n-lint admin: apps\/admin\/messages\/es\.json does not parse as JSON: .+$/
    );
    expect(lines[1]).toBe(
      'i18n-lint client: messages/es.json lacks "common.save", which the reference messages/en.json holds'
    );
  });

  it("exits 3 when a portal's messages/ holds no catalog", () => {
    const admin: PortalFixture = { ...PORTAL, messages: {} };

    const result = runOnAdmin(admin);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "i18n-lint admin: apps/admin/messages holds no <locale>.json catalog\n"
    );
  });

  it("exits 3 when --root names a directory that does not exist", () => {
    const missing = path.join(scratch, "missing");

    const result = runGate(["--root", missing]);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`i18n-lint: --root ${missing} is not a directory\n`);
  });
});

describe("i18n-lint, usage", () => {
  it("exits 2 on an unknown argument and prints the usage", () => {
    const result = runGate(["--fix"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      'i18n-lint: unknown argument "--fix"\nusage: node scripts/testing/i18n-lint.mjs [--root <dir>]\n'
    );
  });

  it("exits 2 when --root has no value", () => {
    const result = runGate(["--root"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "i18n-lint: --root needs a directory\nusage: node scripts/testing/i18n-lint.mjs [--root <dir>]\n"
    );
  });
});

describe("i18n-lint, this repository", () => {
  it("passes the repository's own portals and prints one summary line per discovered portal", () => {
    const result = runGate([]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const [first, ...summaries] = result.stdout.trimEnd().split("\n");
    expect(first).toBe("i18n-lint: PASS");
    // The shape, not the counts: a new locale, portal or message changes the numbers, never this test.
    for (const line of summaries) {
      expect(line).toMatch(
        /^[a-z][a-z0-9-]*: \d+ locales \([a-z-]+(, [a-z-]+)*\), [1-9]\d* messages, reference [a-z-]+$/
      );
    }
    const portals = summaries.map((line) => line.slice(0, line.indexOf(":")));
    expect(portals).toEqual(expect.arrayContaining(["admin", "client"]));
  });
});
