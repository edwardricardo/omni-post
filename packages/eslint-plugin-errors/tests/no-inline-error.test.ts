/**
 * @file no-inline-error.test.ts
 * @description RuleTester suite for `errors/no-inline-error`. An error built at its site carries a
 *              code, a status and a text the central registry does not hold, and a class that
 *              extends `Error` starts a vocabulary of its own beside the registry. The invalid
 *              cases are every way the rule reads those two shapes: `new` on an error class (an
 *              identifier that starts with an upper-case letter and ends in `Error`), whether the
 *              callee is bare, a member, a static computed key or a private name, under any type
 *              wrapper; and a class whose superclass is `Error` or `globalThis.Error`, under any
 *              type wrapper, named or anonymous. The valid cases are what the rule must not
 *              mistake for them: the runtime's own error classes, a lower-case identifier that
 *              ends in `Error`, a name that only contains `Error`, `new` inside the `static of` of
 *              the class it builds, a class of `baseClasses`, a class that extends anything but
 *              `Error`, and an interface. The options replace their defaults rather than adding to
 *              them, and an option the rule does not declare is refused.
 *
 *              The registry path's own shapes follow. A call of any member of an error class but
 *              `of` is a factory, with or without arguments and through any wrapper. Any other use
 *              of an error class as a value is reported, so an alias cannot build one unseen: an
 *              initializer, an argument, a member read that is not called, a default export, an
 *              import, export or destructuring that binds it to a name that is no error class;
 *              while `instanceof`, `extends`, `.prototype`, `.name`, a called `of` and every type
 *              position, `typeof` included, are not. The first argument of `of` is a table's
 *              code, `<NAME>_ERRORS.<CODE>`, with the table imported by its own name from
 *              `@shared/types` (a relative import inside the registry), and nothing else: not an
 *              object, a variable, a cast, a computed key, a spread, a call, a renamed, type-only,
 *              namespace or subpath import, nor a shadowed name. `defineErrors` is used only inside
 *              the registry's directory, where its declaration is not a use. `err` from the
 *              shared kernel is never given a string, a template or a `+` with a string in it, is
 *              never renamed and never used as a value; `err` from another module, and `err`
 *              given a value, a registered error or a number, are not reported.
 *
 *              A failure answered by hand closes the list. Any use of a legacy reply helper is
 *              reported, called, bound, destructured, passed on or read under a static key, and only
 *              the helper's own declaration is not; `replyHelpers` replaces its default. A `send`
 *              on a reply (the identifier `reply`, or a chain that reads a member `reply`) is
 *              reported when its chain sets a status that is not a numeric literal below 400, or
 *              when it sends an object literal with an `error` key or `ok: false`, through type
 *              wrappers, other chained calls and static keys. A success, a body in a variable, a
 *              reply under another name and a status set apart from the `send` are not. The one
 *              file `bodyWriter` names writes the error body unreported, by its exact path: another
 *              file, a file of the same name elsewhere, and the same file without the option are
 *              reported, and every other shape still applies inside it.
 * @layer infrastructure
 */
import path from "node:path";
import { Linter, RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { describe, expect, it } from "vitest";
import plugin from "../src/index.js";
import rule from "../src/rules/no-inline-error.js";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
});

const lines = (...source: string[]): string => source.join("\n");
const construction = (name: string, line = 1) => ({
  messageId: "construction",
  data: { name },
  line,
});
const errorClass = (name: string, line = 1) => ({
  messageId: "errorClass",
  data: { name },
  line,
});

const factory = (name: string, member: string, line = 1) => ({
  messageId: "factory",
  data: { name, member },
  line,
});
const classReference = (name: string, line = 1) => ({
  messageId: "classReference",
  data: { name },
  line,
});
const definitionSource = (name: string, line = 1) => ({
  messageId: "definitionSource",
  data: { name },
  line,
});
const registryDefinition = (line = 1) => ({ messageId: "registryDefinition", line });
const replyHelper = (name: string, line = 1) => ({
  messageId: "replyHelper",
  data: { name },
  line,
});
const inlineReply = (line = 1) => ({ messageId: "inlineReply", line });
const codeLiteral = (what: string, line = 1) => ({
  messageId: "codeLiteral",
  data: { what },
  line,
});

const ANONYMOUS = "(anonymous class)";
const COMPUTED = "[computed]";
const IN_PLACE = "given a code or a message written in place";
const RENAMED = "imported or exported under another name";
const AS_VALUE = "passed on as a value instead of being called";

/** A path under the directory the linter runs from, which the rule reads paths relative to. */
const at = (relative: string): string => path.join(process.cwd(), relative);
const FEATURE = at("apps/api/src/feature/featureRoutes.ts");
const REGISTRY = "packages/shared/src/error-registry";

const IMPORT_COMMON = 'import { COMMON_ERRORS } from "@shared/types";';
const IMPORT_ERR = 'import { err } from "@shared/types";';

ruleTester.run("no-inline-error: construction", rule, {
  valid: [
    lines(
      'new Error("x");',
      'new TypeError("x");',
      'new RangeError("x");',
      "new SyntaxError();",
      "new ReferenceError();",
      "new EvalError();",
      "new URIError();",
      "new AggregateError([]);"
    ),
    'new globalThis.Error("x");',
    "new lastError(); new errors.oauthError(); new this.persistError();",
    "new ErrorBoundary(); new Errors(); new ErrorLike(); new Map();",
    "new errors[`FooError${suffix}`](); new errors[name]();",
    lines(
      'import { COMMON_ERRORS } from "@shared/types";',
      "UseCaseError.of(COMMON_ERRORS.NOT_FOUND);"
    ),
    "throw value;",
    "const instance = new (condition ? First : Second)();",
    lines(
      "class UseCaseError extends Error {",
      "  static of(definition) {",
      '    return new UseCaseError("", definition.code);',
      "  }",
      "}"
    ),
    lines(
      "class RegisteredError extends Error {",
      "  static of(definition) {",
      "    const build = () => new RegisteredError(definition);",
      "    return build();",
      "  }",
      "}"
    ),
    {
      code: 'new FooError("x");',
      options: [{ runtimeErrors: ["FooError"] }],
    },
  ],
  invalid: [
    {
      code: "new UseCaseError(MESSAGES.x, USE_CASE_ERRORS.CONFLICT);",
      errors: [construction("UseCaseError")],
    },
    {
      code: 'new errors.AppError(code, 409, "text");',
      errors: [construction("AppError")],
    },
    {
      code: "new FooError;",
      errors: [construction("FooError")],
    },
    {
      code: 'new errors["AppError"]("x");',
      errors: [construction("AppError")],
    },
    {
      code: "new errors[`AppError`]();",
      errors: [construction("AppError")],
    },
    {
      code: lines(
        "new (FooError as ErrorConstructor)();",
        "new FooError!();",
        "new (FooError satisfies ErrorConstructor)();",
        "new (FooError<string>)();",
        "new (<ErrorConstructor>FooError)();",
        "new ((errors.AppError as unknown) as ErrorConstructor)();"
      ),
      errors: [
        construction("FooError", 1),
        construction("FooError", 2),
        construction("FooError", 3),
        construction("FooError", 4),
        construction("FooError", 5),
        construction("AppError", 6),
      ],
    },
    {
      code: lines(
        "class Holder {",
        "  #FooError = Base;",
        "  build() {",
        "    return new this.#FooError();",
        "  }",
        "}"
      ),
      errors: [construction("FooError", 4)],
    },
    {
      code: lines(
        "class RegisteredError extends Error {",
        "  static of() {",
        '    return new UseCaseError("x", "Y");',
        "  }",
        "}"
      ),
      errors: [construction("UseCaseError", 3)],
    },
    {
      code: lines(
        "class UseCaseError extends Error {",
        "  of() {",
        "    return new UseCaseError();",
        "  }",
        "  static from() {",
        "    return new UseCaseError();",
        "  }",
        "  static of = () => new UseCaseError();",
        '  static ["of"]() {',
        "    return new UseCaseError();",
        "  }",
        "  static [of]() {",
        "    return new UseCaseError();",
        "  }",
        "}"
      ),
      errors: [
        construction("UseCaseError", 3),
        construction("UseCaseError", 6),
        construction("UseCaseError", 8),
        construction("UseCaseError", 10),
        construction("UseCaseError", 13),
      ],
    },
    {
      code: lines(
        "class UseCaseError extends Error {",
        "  static get of() {",
        "    return new UseCaseError();",
        "  }",
        "}"
      ),
      errors: [construction("UseCaseError", 3)],
    },
    {
      code: lines(
        "class UseCaseError extends Error {",
        "  @register(new UseCaseError())",
        "  static of() {",
        "    return undefined;",
        "  }",
        "}"
      ),
      errors: [construction("UseCaseError", 2)],
    },
    {
      code: lines(
        "class UseCaseError extends Error {",
        "  static of() {",
        "    class Inner {",
        "      build() {",
        "        return new UseCaseError();",
        "      }",
        "    }",
        "    return new Inner().build();",
        "  }",
        "}"
      ),
      errors: [construction("UseCaseError", 5)],
    },
    {
      code: lines(
        "const UseCaseError = class {",
        "  static of() {",
        "    return new UseCaseError();",
        "  }",
        "};"
      ),
      errors: [construction("UseCaseError", 3)],
    },
    {
      code: lines('new Error("x");', "new TypeError();"),
      options: [{ runtimeErrors: [] }],
      errors: [construction("Error", 1), construction("TypeError", 2)],
    },
    {
      code: lines('new FooError("x");', "new RangeError();"),
      options: [{ runtimeErrors: ["FooError"] }],
      errors: [construction("RangeError", 2)],
    },
  ],
});

ruleTester.run("no-inline-error: errorClass", rule, {
  valid: [
    "class DomainError extends Error {}",
    "class UseCaseError extends Error {}",
    "class RegisteredError extends Error {}",
    "class NotFoundError extends DomainError {}",
    "class FooError extends TypeError {}",
    "class Foo extends globalThis.TypeError {}",
    "class Foo {}",
    "interface FooError extends Error {}",
    {
      code: "class CrmError extends Error {}",
      options: [{ baseClasses: ["CrmError"] }],
    },
  ],
  invalid: [
    {
      code: "class CrmConnectionValidationError extends Error {}",
      errors: [errorClass("CrmConnectionValidationError")],
    },
    {
      code: "class Failure extends Error {}",
      errors: [errorClass("Failure")],
    },
    {
      code: "class persistError extends Error {}",
      errors: [errorClass("persistError")],
    },
    {
      code: "abstract class BaseError extends Error {}",
      errors: [errorClass("BaseError")],
    },
    {
      code: "class FooError extends Error<never> {}",
      errors: [errorClass("FooError")],
    },
    {
      code: "const Failure = class extends Error {};",
      errors: [errorClass(ANONYMOUS)],
    },
    {
      code: "export default class extends Error {}",
      errors: [errorClass(ANONYMOUS)],
    },
    {
      code: lines(
        "class First extends globalThis.Error {}",
        'class Second extends globalThis["Error"] {}',
        "class Third extends (globalThis as typeof globalThis).Error {}"
      ),
      errors: [errorClass("First", 1), errorClass("Second", 2), errorClass("Third", 3)],
    },
    {
      code: lines(
        "class First extends (Error as ErrorConstructor) {}",
        "class Second extends Error! {}",
        "class Third extends (Error satisfies ErrorConstructor) {}",
        "class Fourth extends (Error<never>) {}",
        "class Fifth extends (<ErrorConstructor>Error) {}",
        "class Sixth extends ((Error as unknown) as ErrorConstructor) {}"
      ),
      errors: [
        errorClass("First", 1),
        errorClass("Second", 2),
        errorClass("Third", 3),
        errorClass("Fourth", 4),
        errorClass("Fifth", 5),
        errorClass("Sixth", 6),
      ],
    },
    {
      code: "class DomainError extends Error {}",
      options: [{ baseClasses: [] }],
      errors: [errorClass("DomainError")],
    },
    {
      code: lines("class CrmError extends Error {}", "class DomainError extends Error {}"),
      options: [{ baseClasses: ["CrmError"] }],
      errors: [errorClass("DomainError", 2)],
    },
  ],
});

ruleTester.run("no-inline-error: factory", rule, {
  valid: [
    lines(IMPORT_COMMON, "UseCaseError.of(COMMON_ERRORS.NOT_FOUND);"),
    "Error.captureStackTrace(this, Holder); TypeError.prototype.toString.call(value);",
    "lastError.toString(); errors.oauthError.retry(); ErrorBoundary.render();",
  ],
  invalid: [
    {
      code: "AppError.internal();",
      errors: [factory("AppError", "internal")],
    },
    {
      code: 'ProviderError.notFound("Channel");',
      errors: [factory("ProviderError", "notFound")],
    },
    {
      code: 'errors.AppError.badRequest("x");',
      errors: [factory("AppError", "badRequest")],
    },
    {
      code: "UseCaseError.from(cause);",
      errors: [factory("UseCaseError", "from")],
    },
    {
      code: lines(
        "(AppError as typeof AppError).internal();",
        "AppError!.internal();",
        "AppError.internal!();",
        "(AppError.internal as () => Error)();",
        "AppError?.internal();",
        "(AppError?.internal)();"
      ),
      errors: [
        factory("AppError", "internal", 1),
        factory("AppError", "internal", 2),
        factory("AppError", "internal", 3),
        factory("AppError", "internal", 4),
        factory("AppError", "internal", 5),
        factory("AppError", "internal", 6),
      ],
    },
    {
      code: lines('AppError["internal"]();', "AppError[method]();"),
      errors: [factory("AppError", "internal", 1), factory("AppError", COMPUTED, 2)],
    },
  ],
});

ruleTester.run("no-inline-error: classReference", rule, {
  valid: [
    "if (error instanceof AppError) {} if (error instanceof (errors.AppError as never)) {}",
    "class NotFound extends AppError {} class Gone extends (errors.AppError as typeof AppError) {}",
    "AppError.prototype; AppError.name; AppError['name']; errors.AppError.prototype;",
    "Object.setPrototypeOf(this, AppError.prototype); AppError.prototype.toString.call(value);",
    lines(
      "let error: AppError;",
      "type Kind = typeof AppError;",
      "type Instance = InstanceType<typeof errors.AppError>;",
      "function isApp(value: unknown): value is AppError { return value !== null; }",
      "class Holder implements AppError {}",
      "const cast = value as AppError;"
    ),
    lines(
      'import { AppError } from "./errors";',
      'import { AppError as LegacyError } from "./errors";',
      'import type { AppError as A } from "./errors";',
      'import { type AppError as B } from "./errors";',
      'export type { AppError as C } from "./errors";',
      'export { AppError } from "./errors";'
    ),
    "const { AppError } = errors; const { AppError: LegacyError } = errors;",
    "const make = lastError; register(oauthError); const { persistError: saved } = state;",
    "const handlers = { AppError: onAppError, [`FooError`]: onFoo };",
  ],
  invalid: [
    {
      code: "const E = UseCaseError;",
      errors: [classReference("UseCaseError")],
    },
    {
      code: "const { badRequest } = AppError;",
      errors: [classReference("AppError")],
    },
    {
      code: "const make = UseCaseError.of;",
      errors: [classReference("UseCaseError")],
    },
    {
      code: "UseCaseError.of.call(null, definition); AppError.internal;",
      errors: [classReference("UseCaseError"), classReference("AppError")],
    },
    {
      code: "const E = errors.AppError; errors.AppError;",
      errors: [classReference("AppError"), classReference("AppError")],
    },
    {
      code: lines(
        'import { AppError as A } from "./errors";',
        'import { AppError as appError } from "./errors";',
        'import { AppError as Error } from "./errors";'
      ),
      errors: [
        classReference("AppError", 1),
        classReference("AppError", 2),
        classReference("AppError", 3),
      ],
    },
    {
      code: lines(
        'import { AppError } from "./errors";',
        "export { AppError as A };",
        'export { AppError as default } from "./errors";',
        "export default AppError;",
        'export { AppError as "Renamed" } from "./errors";'
      ),
      errors: [2, 3, 4, 5].map((line) => classReference("AppError", line)),
    },
    {
      code: lines(
        "register(AppError);",
        "Reflect.construct(AppError, []);",
        "throw AppError;",
        "const handlers = { AppError };",
        "const chosen = condition ? AppError : Other;"
      ),
      errors: [
        classReference("AppError", 1),
        classReference("AppError", 2),
        classReference("AppError", 3),
        classReference("AppError", 4),
        classReference("AppError", 5),
      ],
    },
    {
      code: lines(
        "const { AppError: Legacy } = errors;",
        "const { AppError: { internal } } = errors;",
        "const { AppError: fallback = Other } = errors;",
        'const { ["AppError"]: computed } = errors;'
      ),
      errors: [1, 2, 3, 4].map((line) => classReference("AppError", line)),
    },
  ],
});

ruleTester.run("no-inline-error: definitionSource", rule, {
  valid: [
    lines(
      IMPORT_COMMON,
      'import { AUTH_ERRORS } from "@shared/types";',
      "UseCaseError.of(COMMON_ERRORS.NOT_FOUND);",
      "RegisteredError.of(COMMON_ERRORS.INTERNAL_ERROR, { cause });",
      'errors.RegisteredError.of(AUTH_ERRORS.ADMINISTRATOR_ALREADY_EXISTS, { email: "x" });',
      "UseCaseError?.of(COMMON_ERRORS.CONFLICT);"
    ),
    {
      code: lines(
        'import { HTTP_ERRORS } from "./domains/http.js";',
        "RegisteredError.of(HTTP_ERRORS.ROUTE_NOT_FOUND);"
      ),
      filename: at(`${REGISTRY}/registered-error.ts`),
    },
    "Interval.of({ days: 1 }); lastError.of(definition);",
  ],
  invalid: [
    {
      code: lines(
        IMPORT_COMMON,
        'UseCaseError.of({ code: "X" });',
        "UseCaseError.of(definition);",
        "UseCaseError.of(COMMON_ERRORS.NOT_FOUND as never);",
        'UseCaseError.of(COMMON_ERRORS["NOT_FOUND"]);',
        "UseCaseError.of(COMMON_ERRORS[code]);",
        "UseCaseError.of(COMMON_ERRORS.notFound);",
        "UseCaseError.of(...definitions);",
        "UseCaseError.of();",
        "UseCaseError.of(pick(COMMON_ERRORS));",
        "UseCaseError.of(COMMON_ERRORS[NOT_FOUND]);"
      ),
      errors: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((line) =>
        definitionSource("UseCaseError", line)
      ),
    },
    {
      code: lines('import { CODES } from "@shared/types";', "RegisteredError.of(CODES.NOT_FOUND);"),
      errors: [definitionSource("RegisteredError", 2)],
    },
    {
      code: lines("const LOCAL_ERRORS = build();", "RegisteredError.of(LOCAL_ERRORS.NOT_FOUND);"),
      errors: [definitionSource("RegisteredError", 2)],
    },
    {
      code: lines(
        'import { LOCAL_ERRORS } from "./errors";',
        "RegisteredError.of(LOCAL_ERRORS.NOT_FOUND);"
      ),
      errors: [definitionSource("RegisteredError", 2)],
    },
    {
      code: lines(
        'import { COMMON_ERRORS as AUTH_ERRORS } from "@shared/types";',
        "RegisteredError.of(AUTH_ERRORS.NOT_FOUND);"
      ),
      errors: [definitionSource("RegisteredError", 2)],
    },
    {
      code: lines(
        'import type { COMMON_ERRORS } from "@shared/types";',
        "RegisteredError.of(COMMON_ERRORS.NOT_FOUND);"
      ),
      errors: [definitionSource("RegisteredError", 2)],
    },
    {
      code: lines(
        'import { type COMMON_ERRORS } from "@shared/types";',
        "RegisteredError.of(COMMON_ERRORS.NOT_FOUND);"
      ),
      errors: [definitionSource("RegisteredError", 2)],
    },
    {
      code: lines(
        'import * as kernel from "@shared/types";',
        "RegisteredError.of(kernel.COMMON_ERRORS.NOT_FOUND);"
      ),
      errors: [definitionSource("RegisteredError", 2)],
    },
    {
      code: lines(
        'import { COMMON_ERRORS } from "@shared/types/error-registry/index.js";',
        "RegisteredError.of(COMMON_ERRORS.NOT_FOUND);"
      ),
      errors: [definitionSource("RegisteredError", 2)],
    },
    {
      code: lines(
        IMPORT_COMMON,
        "function build(COMMON_ERRORS) {",
        "  return RegisteredError.of(COMMON_ERRORS.NOT_FOUND);",
        "}"
      ),
      errors: [definitionSource("RegisteredError", 3)],
    },
    {
      code: lines(
        'import { COMMON_ERRORS } from "./domains/common.js";',
        "RegisteredError.of(COMMON_ERRORS.NOT_FOUND);"
      ),
      filename: FEATURE,
      errors: [definitionSource("RegisteredError", 2)],
    },
    {
      code: "errors.UseCaseError.of({}); (UseCaseError.of as typeof UseCaseError.of)(definition);",
      errors: [definitionSource("UseCaseError"), definitionSource("UseCaseError")],
    },
  ],
});

ruleTester.run("no-inline-error: registryDefinition", rule, {
  valid: [
    {
      code: lines(
        'import { defineErrors } from "../definition.js";',
        'export const AUTH_ERRORS = defineErrors("auth", {});'
      ),
      filename: at(`${REGISTRY}/domains/auth.ts`),
    },
    {
      code: "export function defineErrors(domain, entries) { return entries; }",
      filename: at(`${REGISTRY}/definition.ts`),
    },
    {
      code: 'import { defineErrors } from "./definition.js"; defineErrors("local", {});',
      filename: at(`${REGISTRY}/tables.ts`),
    },
    'log("defineErrors"); const defineErrorsCount = 1;',
  ],
  invalid: [
    {
      code: 'import { defineErrors } from "@shared/types/error-registry/definition.js";',
      errors: [registryDefinition()],
    },
    {
      code: 'import { defineErrors as define } from "../definition.js";',
      errors: [registryDefinition()],
    },
    {
      code: lines(
        'import * as registry from "./definition.js";',
        'registry.defineErrors("local", {});',
        'registry["defineErrors"]("local", {});'
      ),
      errors: [registryDefinition(2), registryDefinition(3)],
    },
    {
      code: 'const LOCAL_ERRORS = defineErrors("local", {});',
      filename: FEATURE,
      errors: [registryDefinition()],
    },
    {
      code: 'export { defineErrors } from "./error-registry/definition.js";',
      filename: at("packages/shared/src/index.ts"),
      errors: [registryDefinition()],
    },
    {
      code: 'const LOCAL_ERRORS = defineErrors("local", {});',
      filename: at(`${REGISTRY}-legacy/tables.ts`),
      errors: [registryDefinition()],
    },
    {
      code: 'const LOCAL_ERRORS = defineErrors("local", {});',
      filename: at("apps/api/src/error-registry/tables.ts"),
      errors: [registryDefinition()],
    },
  ],
});

ruleTester.run("no-inline-error: replyHelper", rule, {
  valid: [
    lines(
      "class BaseRouteHandler {",
      "  protected sendError(ctx, statusCode, message) {",
      "    return message;",
      "  }",
      "}",
      "function handleUnexpectedError(error) { return error; }"
    ),
    "this.sendSuccess(ctx, data); this.sendErrorReport(ctx); const sendErrorCount = 1;",
    {
      code: "this.sendError(ctx, 400, 'text');",
      options: [{ replyHelpers: ["sendFailure"] }],
    },
  ],
  invalid: [
    {
      code: "this.sendError(ctx, 400, 'text');",
      errors: [replyHelper("sendError")],
    },
    {
      code: lines(
        "const send = this.sendError.bind(this);",
        "const { handleUnexpectedError } = this;",
        "register(this.handleOAuthError);",
        'this["sendValidationError"](ctx, error);'
      ),
      errors: [
        replyHelper("sendError", 1),
        replyHelper("handleUnexpectedError", 2),
        replyHelper("handleOAuthError", 3),
        replyHelper("sendValidationError", 4),
      ],
    },
    {
      code: lines(
        "class AdminAuthRoutes extends BaseRouteHandler {",
        "  private answerInvalid(ctx) {",
        "    this.sendMfaLoginError(ctx, error);",
        "  }",
        "  protected sendMappedError(ctx, error) {",
        "    super.sendMappedError(ctx, error);",
        "  }",
        "  [sendError]() {}",
        "}"
      ),
      errors: [
        replyHelper("sendMfaLoginError", 3),
        replyHelper("sendMappedError", 6),
        replyHelper("sendError", 8),
      ],
    },
    {
      code: "this.sendFailure(ctx); this.sendError(ctx);",
      options: [{ replyHelpers: ["sendFailure"] }],
      errors: [replyHelper("sendFailure")],
    },
  ],
});

ruleTester.run("no-inline-error: inlineReply", rule, {
  valid: [
    lines(
      "reply.status(200).send(data);",
      "reply.status(200 as number).send(data);",
      "reply.code(201).send({ ok: true, data });",
      "reply.status(399).header('location', url).send();",
      "reply.send(value);",
      "reply.send({ ok: true, errors: [] });",
      "ctx.reply.send({ ok: ready });",
      "reply.status(404);",
      "reply.status(500).sendFile('down.html');",
      "res.status(500).send({ error: message });",
      "getReply().status(500).send(body);",
      "ctx.reply.code(statusCode).send({ ok: true, data });",
      "reply.status(status).send({ data, ok: true as const });"
    ),
    {
      code: "reply.code(answer.problem.status).header('content-type', type).send(body);",
      filename: at("apps/api/src/lib/errors/sendProblem.ts"),
      options: [{ bodyWriter: "apps/api/src/lib/errors/sendProblem.ts" }],
    },
  ],
  invalid: [
    {
      code: lines(
        "reply.status(404).send(x);",
        "reply.code(status).send(body);",
        "ctx.reply.code(500).send();",
        "reply.status(400).send(data);",
        "this.ctx.reply.status(HTTP_STATUS.NOT_FOUND).send(body);",
        "reply.status('200').send(body);",
        "reply.status().send(body);",
        "reply.code(status).send({ ok: ready, data });",
        "reply.code(status).send({ ok: 'true', data });"
      ),
      errors: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((line) => inlineReply(line)),
    },
    {
      code: lines(
        "ctx.reply.send({ ok: false, error: message });",
        "reply.send({ error: message });",
        "reply.send({ ok: false });",
        'reply.send({ "error": message });',
        "reply.send({ ['error']: message });",
        "reply.status(200).send({ ok: false as const, data });"
      ),
      errors: [1, 2, 3, 4, 5, 6].map((line) => inlineReply(line)),
    },
    {
      // A success body excuses only a status the rule cannot read: a failure status written in
      // place, or an `error` key beside `ok: true`, is still a failure built in place.
      code: lines(
        "reply.code(404).send({ ok: true, error: 'Not found' });",
        "reply.code(404).send({ ok: true });",
        "reply.status(status).send({ ok: true, error: message });",
        "reply.send({ ok: true, error: message });",
        "reply.status(status).code(500).send({ ok: true, data });"
      ),
      errors: [1, 2, 3, 4, 5].map((line) => inlineReply(line)),
    },
    {
      code: lines(
        "(reply as FastifyReply).status(404).send(body);",
        "reply.code(404)!.send(body);",
        'reply.status(404).header("x-reason", reason).send(body);',
        'reply["send"]({ error: message });',
        "await reply?.code(503).send(body);",
        "(reply?.code(503)).send(body);"
      ),
      errors: [1, 2, 3, 4, 5, 6].map((line) => inlineReply(line)),
    },
    {
      code: "reply.status(500).send(body);",
      filename: at("apps/api/src/lib/errors/otherWriter.ts"),
      options: [{ bodyWriter: "apps/api/src/lib/errors/sendProblem.ts" }],
      errors: [inlineReply()],
    },
    {
      code: "reply.status(500).send(body);",
      filename: at("apps/workers/src/lib/errors/sendProblem.ts"),
      options: [{ bodyWriter: "apps/api/src/lib/errors/sendProblem.ts" }],
      errors: [inlineReply()],
    },
    {
      code: "reply.status(500).send(body);",
      filename: at("packages/legacy/apps/api/src/lib/errors/sendProblem.ts"),
      options: [{ bodyWriter: "apps/api/src/lib/errors/sendProblem.ts" }],
      errors: [inlineReply()],
    },
    {
      code: "reply.status(500).send(body);",
      filename: at("apps/api/src/lib/errors/sendProblem.ts"),
      errors: [inlineReply()],
    },
    {
      code: "reply.status(500).send(new UseCaseError(message, code));",
      filename: at("apps/api/src/lib/errors/sendProblem.ts"),
      options: [{ bodyWriter: "apps/api/src/lib/errors/sendProblem.ts" }],
      errors: [construction("UseCaseError")],
    },
  ],
});

ruleTester.run("no-inline-error: codeLiteral", rule, {
  valid: [
    lines(
      IMPORT_ERR,
      IMPORT_COMMON,
      "err(value);",
      "err(UseCaseError.of(COMMON_ERRORS.NOT_FOUND));",
      "err(1);",
      "err(code + suffix);",
      "const result = err(error);",
      'err(result.error.code === "NOT_FOUND" ? notFound : failure);',
      "err(reason ?? fallback); err(first || second); err({ code, message, ...rest });"
    ),
    {
      code: lines('import { err } from "./types.js";', 'err("ZERO_CHANNELS");'),
      filename: at("apps/api/src/saga.ts"),
    },
    'import { err } from "neverthrow"; err("USER_NOT_FOUND"); const fail = err;',
    'err("USER_NOT_FOUND");',
    lines(IMPORT_ERR, 'function fail(err) { return err("USER_NOT_FOUND"); }'),
  ],
  invalid: [
    {
      code: lines(
        IMPORT_ERR,
        'err("USER_NOT_FOUND");',
        "err(`USER_NOT_FOUND`);",
        "err(`USER_${kind}`);",
        'err("USER_" + kind);',
        'err(kind + "_NOT_FOUND");',
        'err("USER" + separator + kind);',
        'err("USER_NOT_FOUND" as const);'
      ),
      errors: [2, 3, 4, 5, 6, 7, 8].map((line) => codeLiteral(IN_PLACE, line)),
    },
    {
      code: lines(
        IMPORT_ERR,
        'err(result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "DATABASE_ERROR");',
        'err(tokenLive ? error : "INVALID_TOKEN");',
        'err(response.error?.message ?? "Image generation failed");',
        'err(reason || "Unknown failure");',
        'err({ code: "NOT_FOUND", message: "Account not found" });',
        "err({ details: { reason: `missing ${field}` } });"
      ),
      errors: [2, 3, 4, 5, 6, 7].map((line) => codeLiteral(IN_PLACE, line)),
    },
    {
      code: lines('import { err } from "./types.js";', 'err("ZERO_CHANNELS");'),
      filename: at("packages/shared/src/saga.ts"),
      errors: [codeLiteral(IN_PLACE, 2)],
    },
    {
      code: lines('import { err as fail } from "../types.js";'),
      filename: at(`${REGISTRY}/registered-error.ts`),
      errors: [codeLiteral(RENAMED)],
    },
    {
      code: lines('import { err } from "@shared/types/types.js";', 'err("USER_NOT_FOUND");'),
      errors: [codeLiteral(IN_PLACE, 2)],
    },
    {
      code: lines('import * as kernel from "@shared/types";', 'kernel.err("USER_NOT_FOUND");'),
      errors: [codeLiteral(IN_PLACE, 2)],
    },
    {
      code: lines(
        'import { err as fail } from "@shared/types";',
        'export { err as failure } from "@shared/types";'
      ),
      errors: [codeLiteral(RENAMED, 1), codeLiteral(RENAMED, 2)],
    },
    {
      code: lines(IMPORT_ERR, "const fail = err;", "results.map(err);", "export { err };"),
      errors: [codeLiteral(AS_VALUE, 2), codeLiteral(AS_VALUE, 3), codeLiteral(AS_VALUE, 4)],
    },
    {
      code: lines(IMPORT_ERR, "export { err as failure };", 'export { err } from "@shared/types";'),
      errors: [codeLiteral(RENAMED, 2), codeLiteral(AS_VALUE, 3)],
    },
  ],
});

describe("the errors plugin", () => {
  const linter = new Linter({ configType: "flat" });
  const configWith = (options: Record<string, unknown>): Linter.Config[] => [
    {
      files: ["**/*.ts"],
      languageOptions: { parser: tsParser },
      plugins: { errors: plugin },
      rules: { "errors/no-inline-error": ["error", options] },
    },
  ];

  it("reports through the plugin entry under the rule id errors/no-inline-error", () => {
    const messages = linter.verify('throw new FooError("x");', configWith({}), "feature.ts");

    expect(messages.map(({ ruleId, messageId }) => ({ ruleId, messageId }))).toEqual([
      { ruleId: "errors/no-inline-error", messageId: "construction" },
    ]);
  });

  it("accepts the options the sites gate holds the rule to, one value each", () => {
    const options = {
      runtimeErrors: ["Error"],
      baseClasses: ["UseCaseError"],
      replyHelpers: ["sendError"],
      bodyWriter: "apps/api/src/lib/errors/sendProblem.ts",
    };

    expect(linter.verify("const value = 1;", configWith(options), "feature.ts")).toEqual([]);
  });

  it("refuses a list of body writers: the exemption names one file", () => {
    expect(() =>
      linter.verify("const value = 1;", configWith({ bodyWriter: ["a.ts", "b.ts"] }), "feature.ts")
    ).toThrow(/should be string/);
  });

  it.each([
    ["empty", ""],
    ["absolute", "/srv/apps/api/src/lib/errors/sendProblem.ts"],
    ["absolute with a drive", "C:/apps/api/src/lib/errors/sendProblem.ts"],
    ["starting with ./", "./apps/api/src/lib/errors/sendProblem.ts"],
    ["starting with ../", "../apps/api/src/lib/errors/sendProblem.ts"],
    ["holding a backslash", "apps\\api\\src\\lib\\errors\\sendProblem.ts"],
  ])("refuses a body writer path that is %s", (_form, bodyWriter) => {
    expect(() =>
      linter.verify("const value = 1;", configWith({ bodyWriter }), "feature.ts")
    ).toThrow(/should match pattern/);
  });

  it("refuses an option the rule does not declare", () => {
    expect(() =>
      linter.verify("const value = 1;", configWith({ unknown: [] }), "feature.ts")
    ).toThrow(/should NOT have additional properties/);
  });
});
