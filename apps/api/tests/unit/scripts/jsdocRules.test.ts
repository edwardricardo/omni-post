/**
 * @file jsdocRules.test.ts
 * @description Pins the rules of `eslint.jsdoc.config.ts`, the dedicated config of the JSDoc gate.
 *   ESLint loads the config by its path, as the gate does, so the tests' type program never compiles
 *   it. Each case lints one fixture source through the ESLint Node API, under a path the config
 *   reaches, and compares every finding as `line rule message`, so a rule that stops firing, or
 *   starts firing on a case it should leave alone, fails here. The gate's own mechanics (which files
 *   it reads, the base, the modes) are pinned by their own suite.
 * @layer infrastructure
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { findMonorepoRoot } from "@packages/vitest-shared";
import { describe, expect, it } from "vitest";

const REPO_ROOT = findMonorepoRoot(path.dirname(fileURLToPath(import.meta.url)));
/** Fixture paths no file of the repository holds; `lintText` never reads them from disk. */
const FIXTURES = "__jsdoc_fixture__";
const SERVICE = `apps/api/src/${FIXTURES}/service.ts`;
const CONFIG_FILE = path.join(REPO_ROOT, "eslint.jsdoc.config.ts");
const eslint = new ESLint({ cwd: REPO_ROOT, overrideConfigFile: CONFIG_FILE });

/** Every finding the config reports for one source at one path, as `line rule message`. */
const findingsFor = async (file: string, text: string): Promise<string[]> => {
  const [result] = await eslint.lintText(text, { filePath: path.join(REPO_ROOT, file) });
  return (result?.messages ?? []).map((m) => `${m.line} ${m.ruleId ?? "fatal"} ${m.message}`);
};

describe("the config's place", () => {
  it("stays out of `pnpm lint`: the config ESLint discovers holds no jsdoc rule", async () => {
    const discovered = new ESLint({ cwd: REPO_ROOT });
    const file = path.join(REPO_ROOT, SERVICE);

    const lint = (await discovered.calculateConfigForFile(file)) as { rules?: object };
    const gate = (await eslint.calculateConfigForFile(file)) as { rules?: object };

    expect(Object.keys(lint.rules ?? {}).filter((rule) => rule.startsWith("jsdoc/"))).toEqual([]);
    expect(Object.keys(gate.rules ?? {}).filter((rule) => rule.startsWith("jsdoc/"))).not.toEqual(
      []
    );
  });
});

describe("the canon rules", () => {
  it("a public method of an exported class needs a block with @method; private, protected, #private, constructors and accessors do not", async () => {
    const lines = await findingsFor(
      SERVICE,
      [
        "export class Service {",
        "  constructor(private readonly base: number) {}",
        "  run(value: number): number {",
        "    return value + this.base;",
        "  }",
        "  /**",
        "   * @description Adds the base.",
        "   * @param value - The number.",
        "   * @returns The sum.",
        "   */",
        "  untagged(value: number): number {",
        "    return value + this.base;",
        "  }",
        "  private hidden(value: number): number {",
        "    return value;",
        "  }",
        "  protected shared(value: number): number {",
        "    return value;",
        "  }",
        "  #secret(value: number): number {",
        "    return value;",
        "  }",
        "  get current(): number {",
        "    return this.base;",
        "  }",
        "}",
        "",
      ].join("\n")
    );

    expect(lines).toEqual([
      "3 jsdoc/require-jsdoc Missing JSDoc comment.",
      '6 jsdoc/require-tags Missing required tag "method"',
    ]);
  });

  it("an abstract method's @returns follows its annotation, and nothing outside an export needs a block", async () => {
    const lines = await findingsFor(
      SERVICE,
      [
        "function local(value: number): number {",
        "  return value;",
        "}",
        "class Hidden {",
        "  run(value: number): number {",
        "    return value;",
        "  }",
        "}",
        "export abstract class Shape {",
        "  /**",
        "   * @method area",
        "   * @description The area.",
        "   * @param scale - The scale.",
        "   */",
        "  abstract area(scale: number): number;",
        "  /**",
        "   * @method draw",
        "   * @description Draws it.",
        "   * @param scale - The scale.",
        "   */",
        "  abstract draw(scale: number): void;",
        "  abstract name(): string;",
        "}",
        "",
      ].join("\n")
    );

    expect(lines).toEqual([
      "10 jsdoc/require-returns Missing JSDoc @returns declaration.",
      "22 jsdoc/require-jsdoc Missing JSDoc comment.",
    ]);
  });

  it("@method and the canon form reach a documented public method of any class, while only an exported class needs the block", async () => {
    const lines = await findingsFor(
      SERVICE,
      [
        "class Local {",
        "  /**",
        "   * @description Adds one.",
        "   * @param value - The number.",
        "   * @returns The sum.",
        "   */",
        "  untagged(value: number): number {",
        "    return value + 1;",
        "  }",
        "  /**",
        "   * @method tagged",
        "   * @description Adds two.",
        "   * @param value - The number.",
        "   * @returns The sum.",
        "   */",
        "  tagged(value: number): number {",
        "    return value + 2;",
        "  }",
        "  /**",
        "   * @method partial",
        "   * @description Adds three.",
        "   */",
        "  partial(value: number): number {",
        "    return value + 3;",
        "  }",
        "  undocumented(value: number): number {",
        "    return value;",
        "  }",
        "}",
        "",
      ].join("\n")
    );

    expect(lines).toEqual([
      '2 jsdoc/require-tags Missing required tag "method"',
      '19 jsdoc/require-param Missing JSDoc @param "value" declaration.',
      "19 jsdoc/require-returns Missing JSDoc @returns declaration.",
    ]);
  });

  it("@returns is required when the body returns a value, and not for void or Promise<void>", async () => {
    const block = (name: string, extra = ""): string =>
      `/**\n * @description ${name}.\n * @param value - The number.\n${extra} */\n`;
    const lines = await findingsFor(
      SERVICE,
      [
        `${block("Returns")}export function returns(value: number): number {\n  return value;\n}`,
        `${block("Async")}export async function settles(value: number): Promise<void> {\n  await Promise.resolve(value);\n}`,
        `${block("Concise")}export const logs = (value: number): void => void value;`,
        `${block("Body")}export function nothing(value: number) {\n  void value;\n}`,
        "",
      ].join("\n")
    );

    expect(lines).toEqual(["1 jsdoc/require-returns Missing JSDoc @returns declaration."]);
  });

  it("an unannotated function needs @returns only when its body returns a value", async () => {
    const lines = await findingsFor(
      SERVICE,
      [
        "/**",
        " * @description Stops early.",
        " * @param value - The number.",
        " */",
        "export function stop(value: number) {",
        "  if (value > 0) return;",
        "  void value;",
        "}",
        "/**",
        " * @description Doubles a number.",
        " * @param value - The number.",
        " */",
        "export function twice(value: number) {",
        "  return value * 2;",
        "}",
        "/**",
        " * @description Halves a number.",
        " * @param value - The number.",
        " */",
        "export const half = (value: number) => value / 2;",
        "",
      ].join("\n")
    );

    expect(lines).toEqual([
      "9 jsdoc/require-returns Missing JSDoc @returns declaration.",
      "16 jsdoc/require-returns Missing JSDoc @returns declaration.",
    ]);
  });

  it("each parameter needs an @param, and one suffices for a destructured parameter", async () => {
    const lines = await findingsFor(
      SERVICE,
      [
        "/**",
        " * @description Adds.",
        " * @param left - The left number.",
        " * @returns The sum.",
        " */",
        "export function add(left: number, right: number): number {",
        "  return left + right;",
        "}",
        "/**",
        " * @description Adds an object's numbers.",
        " * @param pair - The numbers.",
        " * @returns The sum.",
        " */",
        "export function addPair({ left, right }: { left: number; right: number }): number {",
        "  return left + right;",
        "}",
        "",
      ].join("\n")
    );

    expect(lines).toEqual(['1 jsdoc/require-param Missing JSDoc @param "right" declaration.']);
  });

  it("the description is an @description tag with text, not the block's body", async () => {
    const lines = await findingsFor(
      SERVICE,
      [
        "/**",
        " * Doubles a number.",
        " * @returns Two.",
        " */",
        "export const double = (): number => 2;",
        "/**",
        " * @description",
        " * @returns Three.",
        " */",
        "export const triple = (): number => 3;",
        "",
      ].join("\n")
    );

    expect(lines).toEqual([
      "1 jsdoc/require-description Missing JSDoc @description declaration.",
      "7 jsdoc/require-description Missing JSDoc @description description.",
    ]);
  });

  it("a React component in the portals or the UI package needs a description only; elsewhere the full form", async () => {
    const component = [
      "/** Renders a card. */",
      "export function Card({ title }: { title: string }) {",
      "  return <div>{title}</div>;",
      "}",
      "/**",
      " * @param title - The title.",
      " */",
      "export function Bare({ title }: { title: string }) {",
      "  return <div>{title}</div>;",
      "}",
      "",
    ].join("\n");

    const portal = await findingsFor(`apps/client/components/${FIXTURES}/Card.tsx`, component);
    const api = await findingsFor(`apps/api/src/${FIXTURES}/Card.tsx`, component);

    expect(portal).toEqual([
      "5 jsdoc/no-restricted-syntax A React component's JSDoc block needs a description, in its body or in @description.",
    ]);
    expect(api).toEqual([
      "1 jsdoc/require-description Missing JSDoc @description declaration.",
      '1 jsdoc/require-param Missing JSDoc @param "root0" declaration.',
      "1 jsdoc/require-returns Missing JSDoc @returns declaration.",
      "5 jsdoc/require-description Missing JSDoc @description declaration.",
      "5 jsdoc/require-returns Missing JSDoc @returns declaration.",
    ]);
  });

  it("a default-exported or const component needs a description only, while a default-exported function without JSX needs the full form", async () => {
    const page = await findingsFor(
      `apps/client/app/${FIXTURES}/page.tsx`,
      [
        "/** Renders the page. */",
        "export default function Page({ params }: { params: { id: string } }) {",
        "  return <main>{params.id}</main>;",
        "}",
        "/** Renders a badge. */",
        "export const Badge = ({ label }: { label: string }) => <span>{label}</span>;",
        "/**",
        " * @param label - The label.",
        " */",
        "export const Chip = ({ label }: { label: string }) => <span>{label}</span>;",
        "",
      ].join("\n")
    );
    const bare = await findingsFor(
      `apps/client/app/${FIXTURES}/layout.tsx`,
      "export default function Layout() {\n  return <div />;\n}\n"
    );
    const handler = await findingsFor(
      `apps/client/app/${FIXTURES}/handler.tsx`,
      "/** Handles a value. */\nexport default function handler(value: number) {\n  return value;\n}\n"
    );

    expect(page).toEqual([
      "7 jsdoc/no-restricted-syntax A React component's JSDoc block needs a description, in its body or in @description.",
    ]);
    expect(bare).toEqual(["1 jsdoc/require-jsdoc Missing JSDoc comment."]);
    expect(handler).toEqual([
      "1 jsdoc/require-description Missing JSDoc @description declaration.",
      '1 jsdoc/require-param Missing JSDoc @param "value" declaration.',
      "1 jsdoc/require-returns Missing JSDoc @returns declaration.",
    ]);
  });

  it("allows the canon's own tags and both @method and @function, and refuses an unknown tag or an alias", async () => {
    const lines = await findingsFor(
      SERVICE,
      [
        "/**",
        " * @file service.ts",
        " * @description The service.",
        " * @layer infrastructure",
        " */",
        "/**",
        " * @description Reads a value.",
        " * @hook",
        " * @component Reader",
        " * @frobnicate",
        " * @returns One.",
        " */",
        "export const read = (): number => 1;",
        "/**",
        " * @function make",
        " * @description Makes one.",
        " * @returns One.",
        " */",
        "export const make = (): number => 1;",
        "/**",
        " * @func build",
        " * @description Builds one.",
        " * @returns One.",
        " */",
        "export const build = (): number => 1;",
        "",
      ].join("\n")
    );

    expect(lines).toEqual([
      '10 jsdoc/check-tag-names Invalid JSDoc tag name "frobnicate".',
      '21 jsdoc/check-tag-names Invalid JSDoc tag (preference). Replace "func" JSDoc tag with "function".',
    ]);
  });
});
