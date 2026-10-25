/**
 * @file eslint.jsdoc.config.ts
 * @description The method-level JSDoc rules of CODING_STANDARDS §Documentation, as a flat config
 *   loaded only by the touched-files gate (`pnpm check:jsdoc`) and by its rules suite,
 *   `jsdocRules.test.ts`. `pnpm lint` never reads it: ESLint discovers `eslint.config.*` and nothing
 *   else, so the files no change has touched yet cannot turn every lint run red.
 *
 *   What it requires:
 *   - an exported function, or an exported `const` arrow or function expression: a block with a
 *     non-empty `@description`, one `@param` per parameter, and `@returns` unless it returns nothing;
 *   - a public method (not `private`, `protected`, `#private`, a constructor or an accessor) of an
 *     exported class: the same block, plus `@method`. Every documented public method follows that
 *     form, in any class;
 *   - a React component (a PascalCase or default-exported function holding JSX, in a `.tsx` of
 *     `apps/admin`, `apps/client` or `packages/ui`): a block with a description, in its body or in
 *     `@description`, and needs no `@param` or `@returns`, because the canon documents its props
 *     on the props interface;
 *   - in every block: a tag JSDoc defines, or one of the canon's own (`@layer`, `@component`,
 *     `@hook`). `@method` stays valid beside `@function`, which JSDoc would otherwise prefer.
 *
 *   "Returns nothing" is read from the body (no `return` with a value) or from a `void` or
 *   `Promise<void>` return annotation, whichever says so.
 *
 *   Two selector forms, on purpose. `require-tags` and `no-restricted-syntax` re-match their context
 *   against the node alone, with no ancestors, so a selector with a combinator never matches there:
 *   theirs are single-node selectors. That is why `@method` reaches every documented public method,
 *   not only those of an exported class.
 * @layer infrastructure
 */
import type { Linter } from "eslint";
import { defineConfig } from "eslint/config";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import jsxA11yPlugin from "eslint-plugin-jsx-a11y";
import vitestPlugin from "@vitest/eslint-plugin";
import testingPlugin from "@packages/eslint-plugin-testing";
import jsdoc from "eslint-plugin-jsdoc";

const EXPORTED = ":matches(ExportNamedDeclaration, ExportDefaultDeclaration)";
const ANY_FUNCTION = ":matches(FunctionDeclaration, ArrowFunctionExpression, FunctionExpression)";
const FUNCTION_EXPRESSION = ":matches(ArrowFunctionExpression, FunctionExpression)";
const HOLDS_JSX = ":has(JSXElement, JSXFragment)";
const PASCAL_CASE = "[id.name=/^[A-Z]/]";
const PUBLIC =
  ':not([accessibility="private"], [accessibility="protected"], [key.type="PrivateIdentifier"])';
/** A function, or the member of a node at `prefix`, annotated to return `void` or `Promise<void>`. */
const returnsVoid = (prefix = ""): string =>
  `:matches([${prefix}returnType.typeAnnotation.type="TSVoidKeyword"], ` +
  `[${prefix}returnType.typeAnnotation.typeName.name="Promise"]` +
  `[${prefix}returnType.typeAnnotation.typeArguments.params.0.type="TSVoidKeyword"])`;

const METHOD = `MethodDefinition[kind="method"]${PUBLIC}`;
const ABSTRACT_METHOD = `TSAbstractMethodDefinition[kind="method"]${PUBLIC}`;
const CLASS_BODY = `${EXPORTED} > :matches(ClassDeclaration, ClassExpression) > ClassBody`;

/** The public methods of an exported class, which must carry a block. */
const EXPORTED_METHODS = [`${CLASS_BODY} > ${METHOD}`, `${CLASS_BODY} > ${ABSTRACT_METHOD}`];
/** Every public method's function, whose block follows the canon form when it has one. */
const METHOD_FUNCTIONS = [
  `${METHOD} > FunctionExpression`,
  `${ABSTRACT_METHOD} > TSEmptyBodyFunctionExpression`,
];

/** Every exported function, components included. */
const FUNCTIONS = [
  `${EXPORTED} > FunctionDeclaration`,
  `ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ${FUNCTION_EXPRESSION}`,
  `ExportDefaultDeclaration > ${FUNCTION_EXPRESSION}`,
];

/** The exported functions of the component directories that are not React components. */
const NOT_COMPONENTS = [
  `ExportNamedDeclaration > FunctionDeclaration:not(${PASCAL_CASE}${HOLDS_JSX})`,
  `ExportNamedDeclaration > VariableDeclaration > VariableDeclarator:not(${PASCAL_CASE}) > ${FUNCTION_EXPRESSION}`,
  `ExportNamedDeclaration > VariableDeclaration > VariableDeclarator${PASCAL_CASE} > ${FUNCTION_EXPRESSION}:not(${HOLDS_JSX})`,
  `ExportDefaultDeclaration > ${ANY_FUNCTION}:not(${HOLDS_JSX})`,
];

/**
 * @description The jsdoc rules of one block of files.
 * @param tagged - The exported functions that need the canon's full tag form.
 * @param components - Whether React components, documented by a description only, live here.
 * @returns The rule entries of one flat-config block.
 */
function jsdocRules(tagged: readonly string[], components: boolean): Linter.RulesRecord {
  const notVoid = (selector: string): string => `${selector}:not(${returnsVoid()})`;
  return {
    "jsdoc/require-jsdoc": [
      "error",
      {
        require: {
          ArrowFunctionExpression: false,
          ClassDeclaration: false,
          ClassExpression: false,
          FunctionDeclaration: false,
          FunctionExpression: false,
          MethodDefinition: false,
        },
        contexts: [...FUNCTIONS, ...EXPORTED_METHODS],
        enableFixer: false,
      },
    ],
    "jsdoc/require-description": [
      "error",
      { descriptionStyle: "tag", contexts: [...tagged, ...METHOD_FUNCTIONS] },
    ],
    "jsdoc/require-tags": [
      "error",
      { tags: [METHOD, ABSTRACT_METHOD].map((context) => ({ tag: "method", context })) },
    ],
    "jsdoc/require-param": [
      "error",
      { contexts: [...tagged, ...METHOD_FUNCTIONS], checkDestructured: false, enableFixer: false },
    ],
    "jsdoc/require-returns": [
      "error",
      {
        contexts: [
          ...[...tagged, `${METHOD} > FunctionExpression`].map(notVoid),
          // An abstract method has no body to read a return from, so its annotation decides; the
          // single-node form is the one this option's own matching can see.
          {
            context: `${ABSTRACT_METHOD}:not(${returnsVoid("value.")})`,
            forceRequireReturn: true,
          },
        ],
      },
    ],
    ...(components && {
      "jsdoc/no-restricted-syntax": [
        "error",
        {
          contexts: [
            {
              context: `${ANY_FUNCTION}${HOLDS_JSX}`,
              comment:
                "JsdocBlock[description=/^\\s*$/]" +
                ':not(:has(JsdocTag[tag="description"][description=/\\S/]))',
              message:
                "A React component's JSDoc block needs a description, in its body or in @description.",
            },
          ],
        },
      ],
    }),
    "jsdoc/check-tag-names": ["error", { definedTags: ["layer", "component", "hook"] }],
  };
}

export default defineConfig([
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/*.d.ts",
      "**/*.test.*",
      "**/*.spec.*",
      "**/*.stories.*",
      "infra/prisma/generated/**",
    ],
  },
  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    // The source carries directives for the main config's rules. Its plugins are registered so
    // those directives resolve, and none of their rules is enabled; a directive this config does
    // not use is not a finding here, because `pnpm lint` already judges it.
    linterOptions: { reportUnusedDisableDirectives: "off" },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      jsdoc,
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooksPlugin,
      "jsx-a11y": jsxA11yPlugin,
      vitest: vitestPlugin,
      testing: testingPlugin,
    },
    settings: { jsdoc: { mode: "typescript", tagNamePreference: { method: "method" } } },
    rules: jsdocRules(FUNCTIONS, false),
  },
  {
    files: ["apps/admin/**/*.tsx", "apps/client/**/*.tsx", "packages/ui/**/*.tsx"],
    rules: jsdocRules(NOT_COMPONENTS, true),
  },
]);
