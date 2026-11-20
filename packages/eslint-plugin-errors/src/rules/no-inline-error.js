// @ts-check
/**
 * @file no-inline-error.js
 * @description ESLint rule `errors/no-inline-error`: an error's code, status and text live in the
 *   central error registry, `packages/shared/src/error-registry/`, and an error is built from it
 *   by `<Class>.of(<TABLE>.<CODE>, params)`, which takes no text. An error built anywhere else
 *   carries a code, a status or a sentence the registry does not hold, and no front can look it
 *   up by its code.
 *
 *   An error class is an identifier that starts with an upper-case letter, ends in `Error`, and is
 *   not one of the `runtimeErrors` option. A lower-case identifier that ends in `Error` names a
 *   value (`lastError`), not a class.
 *
 *   What the rule reports, decided on the syntax tree, with no type information:
 *   - `construction`: `new X(…)` whose callee's last name is an error class: a bare identifier,
 *     or the property a member reads (a private name, and a computed key written as a string with
 *     no expression, included), read through any TypeScript type wrapper. A `new` written inside
 *     the body of the `static of` method of the class of that name, with no other class between
 *     them, is the registry path itself and is not reported.
 *   - `errorClass`: a class, declared or an expression, named or not, whose superclass is `Error`
 *     or the member `Error` of `globalThis`, read through any TypeScript type wrapper, and whose
 *     name is not one of the `baseClasses` option.
 *   - `factory`: a call of any member of an error class but `of`, whatever its arguments, through
 *     any type wrapper or optional chain; a member computed at run time included.
 *   - `classReference`: any other read of an error class as a value, so that no alias can build
 *     one unseen: an initializer, an argument, a member read that is not called, a default
 *     export, an object's value; and an import, an export or a destructuring that binds it to a
 *     name that is no error class. Allowed: the callee of `new` and of a called member (the two
 *     shapes above), the right side of `instanceof`, an `extends` clause, `.prototype`, `.name`,
 *     and every type position, `typeof` in a type included.
 *   - `definitionSource`: a call of `of` on an error class whose first argument is not
 *     `<TABLE>.<CODE>`: a member, not computed, whose property has the grammar of a code and whose
 *     object is a name ending in `_ERRORS` that the file imports, as a value, by that same name,
 *     from `@shared/types` (inside the registry, from a relative module). A name the file
 *     shadows reads the shadowing binding, not the import.
 *   - `registryDefinition`: any use of the name `defineErrors` (an import or export specifier, a
 *     call, a member read, a static computed key) outside the registry's directory. The
 *     declaration of a function of that name is not a use.
 *   - `codeLiteral`: a call of the kernel's `err` (imported by name, through a path of the kernel,
 *     read on a namespace import of it, or imported relatively by a file of the kernel itself)
 *     whose first argument holds a string or a template: through a `+`, either branch of a
 *     conditional, either side of a logical expression and the property values of an object
 *     literal; an import or export of `err` under another name; and any other read of it as a
 *     value, an export included, since an alias would call it unseen.
 *   - `replyHelper`: any use of a name of the `replyHelpers` option, called or not (bound,
 *     destructured, passed on, read under a static key), except the declaration of the helper
 *     itself as a function or a method.
 *   - `inlineReply`: a call of `send` on a reply, the chain whose root is the identifier `reply`
 *     or that reads a member `reply`, when a `status` or `code` call of the chain is given
 *     anything but a numeric literal below 400, or when `send` is given an object literal with a
 *     key `error`, or a key `ok` whose value is the literal `false`; through type wrappers,
 *     optional chains, the chain's other calls and static keys. A body literal whose `ok` is the
 *     literal `true` excuses a status that is no numeric literal, and nothing else: with a
 *     numeric literal of 400 or above, or with a key `error` beside it, the call is reported. Not
 *     reported in the one file the `bodyWriter` option names, by its exact path, and only there;
 *     every other shape is.
 *
 *   Paths are read relative to the directory ESLint runs from, the repository root; run from
 *   anywhere else, the registry's own files and the body writer are reported, never the other way
 *   round.
 *
 *   Options, one object, each replacing its default: `runtimeErrors`, the classes that are not
 *   error classes (the runtime's own, by default); `baseClasses`, the classes that may extend
 *   `Error` (the bases of the registry path, by default); `replyHelpers`, the legacy reply
 *   helpers and the wrappers around them (the six measured on the tree, by default);
 *   `bodyWriter`, one path relative to the root, refused when empty, absolute, starting at `./` or
 *   `../`, or holding a backslash (none by default, so no file is exempt).
 *
 *   Not reported: a call of `of` on a registry table's code, a `throw` of a value, `new` on a
 *   lower-case identifier or on a name that does not end in `Error`, a class that extends
 *   anything but `Error`, an interface, `err` given a value, and `err` of another module.
 *
 *   Not seen: a class that extends an error class under a name that does not end in `Error`,
 *   built with `new`; a construction through the prototype (`Object.create(X.prototype)`); a
 *   superclass that is an alias of `Error`, or `Error` read from an object other than
 *   `globalThis`; a default import of an error class under another name; an alias made with
 *   TypeScript's `import x = N.X`; a result written by hand, `{ ok: false, error: "CODE" }`; a
 *   wrapper of a reply helper under a name the option does not list; and a failure answered by
 *   hand in a shape this reading does not follow: a body in a variable sent with the default
 *   status, a status set apart from its `send`, a reply under another name, the raw response; and
 *   a value that carries a `statusCode` and is answered at that status by the error handler's
 *   last step (`Object.assign(new Error(), { statusCode })`, a thrown object literal).
 *
 *   Matched by name, and so wider or narrower than the intent: `baseClasses` is a list of names,
 *   so a feature file may declare a class of one of those names that extends `Error`; a `new`
 *   inside the `static of` of the class it builds is exempt in any file, not only the registry's
 *   bases; and a class field, a const arrow, an interface member or an abstract member named like
 *   a reply helper is reported, where a method or a function declaration of that name is not.
 * @layer infrastructure
 */
import path from "node:path";

/** The suffix that, after an upper-case first letter, makes an identifier an error class. */
const ERROR_CLASS_SUFFIX = "Error";
const UPPER_CASE_START = /^\p{Lu}/u;

/** The name a report gives a class written with no name. */
const ANONYMOUS_CLASS = "(anonymous class)";

/** A member of an error class that builds nothing when read. */
const INERT_MEMBERS = new Set(["prototype", "name"]);

/** The one member of an error class that builds an error from the registry. */
const REGISTRY_PATH = "of";

/** The name a report gives a member whose key is computed at run time. */
const COMPUTED_MEMBER = "[computed]";

/**
 * The grammar of a registered code, `ERROR_CODE_PATTERN` of the registry's `definition.ts`. This
 * package reads no workspace package, so the pattern is written here again; the registry gate's
 * R8 and R11 read the codes and tables an `of` names against the registry itself.
 */
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

/** The suffix of the name of every registry table. */
const TABLE_SUFFIX = "_ERRORS";

/** The shared kernel's module, the only one a registry table is imported from. */
const SHARED_KERNEL = "@shared/types";

/** The shared kernel's source and the registry's directory, relative to where ESLint runs. */
const KERNEL_DIRECTORY = "packages/shared/src/";
const REGISTRY_DIRECTORY = `${KERNEL_DIRECTORY}error-registry/`;

/** The function that builds a registry table, and the kernel's failed `Result`. */
const DEFINE_ERRORS = "defineErrors";
const RESULT_FAILURE = "err";

/** What a `codeLiteral` report says `err` was made to do. */
const FAILURE_MISUSE = {
  IN_PLACE: "given a code or a message written in place",
  RENAMED: "imported or exported under another name",
  AS_VALUE: "passed on as a value instead of being called",
};

/** The reply's members that set the status a `send` answers with. */
const STATUS_SETTERS = new Set(["status", "code"]);

/** The lowest status that answers a failure. */
const FIRST_FAILURE_STATUS = 400;

/** TypeScript expressions that change the type of the expression they wrap and not its value. */
const TYPE_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

/**
 * @typedef {{ type: string, [key: string]: unknown }} AstNode
 */

/**
 * @typedef {object} RuleOptions
 * @property {readonly string[]} runtimeErrors Classes that are not error classes.
 * @property {readonly string[]} baseClasses Classes that may extend `Error`.
 * @property {readonly string[]} replyHelpers The legacy reply helpers and their wrappers.
 * @property {string} [bodyWriter] The one file, relative to the root, that writes the error body.
 */

/** @type {RuleOptions} */
const DEFAULT_OPTIONS = {
  runtimeErrors: [
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "ReferenceError",
    "EvalError",
    "URIError",
    "AggregateError",
  ],
  baseClasses: ["DomainError", "UseCaseError", "RegisteredError"],
  replyHelpers: [
    "sendError",
    "handleUnexpectedError",
    "handleOAuthError",
    "sendValidationError",
    "sendMfaLoginError",
    "sendMappedError",
  ],
};

/**
 * @param {unknown} value
 * @returns {value is AstNode}
 */
function isNode(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (/** @type {{ type?: unknown }} */ (value).type) === "string"
  );
}

/**
 * @param {unknown} value
 * @returns {AstNode}
 */
function asNode(value) {
  return /** @type {AstNode} */ (value);
}

/**
 * @param {unknown} expression An expression.
 * @returns {AstNode | null} The expression its TypeScript type wrappers hold, read through each.
 */
function unwrap(expression) {
  let current = expression;
  while (isNode(current) && TYPE_WRAPPERS.has(current.type)) current = current.expression;
  return isNode(current) ? current : null;
}

/**
 * @param {AstNode} key A computed key.
 * @returns {string | null} The string it is, when the source fixes it: a string literal, or a
 *   template literal with no expression.
 */
function staticString(key) {
  if (key.type === "Literal") return typeof key.value === "string" ? key.value : null;
  if (key.type !== "TemplateLiteral") return null;
  const { expressions, quasis } = key;
  if (!Array.isArray(expressions) || expressions.length > 0 || !Array.isArray(quasis)) return null;
  const [quasi] = quasis;
  const cooked = isNode(quasi) ? /** @type {{ cooked?: unknown }} */ (quasi.value).cooked : null;
  return typeof cooked === "string" ? cooked : null;
}

/**
 * @param {unknown} key The key of a member or of a property.
 * @param {unknown} computed Whether the key is written in brackets.
 * @returns {string | null} The name the key reads, when the source fixes it.
 */
function keyName(key, computed) {
  if (!isNode(key)) return null;
  // An object's key may be written as a string without brackets: `{ "error": message }`.
  if (computed === true || key.type === "Literal") return staticString(key);
  return typeof key.name === "string" ? key.name : null;
}

/**
 * @param {AstNode} member A `MemberExpression`.
 * @returns {string | null} The name of the property it reads, when the source fixes it.
 */
function propertyName(member) {
  return keyName(member.property, member.computed);
}

/**
 * @param {unknown} expression An expression.
 * @returns {string | null} The last name it reads: an identifier's own, or the property a member
 *   reads.
 */
function lastName(expression) {
  const node = unwrap(expression);
  if (node === null) return null;
  if (node.type === "Identifier") return typeof node.name === "string" ? node.name : null;
  return node.type === "MemberExpression" ? propertyName(node) : null;
}

/**
 * @param {unknown} superClass A class's superclass expression.
 * @returns {boolean} Whether it is `Error`, bare or a member of `globalThis`.
 */
function isErrorSuperclass(superClass) {
  const node = unwrap(superClass);
  if (node === null) return false;
  if (node.type === "Identifier") return node.name === "Error";
  if (node.type !== "MemberExpression") return false;
  const object = unwrap(node.object);
  return (
    object?.type === "Identifier" && object.name === "globalThis" && propertyName(node) === "Error"
  );
}

/**
 * @param {AstNode} declaration A class declaration or expression.
 * @returns {string | null} Its name, or null when it is written with none.
 */
function classNameOf(declaration) {
  const id = declaration.id;
  return isNode(id) && typeof id.name === "string" ? id.name : null;
}

/**
 * @param {readonly unknown[]} ancestors The ancestors of a `new` expression, outermost first.
 * @param {string} name The name of the class it builds.
 * @returns {boolean} Whether the expression is written in the body of the `static of` method of
 *   the nearest enclosing class, and that class is named `name`.
 */
function isInsideOwnOf(ancestors, name) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = asNode(ancestors[index]);
    if (ancestor.type !== "ClassDeclaration" && ancestor.type !== "ClassExpression") continue;
    // A class's ancestors run class, ClassBody, the member, then what the member holds.
    const member = ancestors[index + 2];
    return (
      classNameOf(ancestor) === name &&
      isNode(member) &&
      member.static === true &&
      member.kind === "method" &&
      member.computed === false &&
      isNode(member.key) &&
      member.key.name === "of" &&
      ancestors[index + 3] === member.value
    );
  }
  return false;
}

/**
 * @param {AstNode} node An expression.
 * @returns {AstNode} The outermost expression that holds the same value: `node` read out through
 *   every TypeScript type wrapper and optional chain around it.
 */
function outermost(node) {
  let current = node;
  let parent = current.parent;
  while (
    isNode(parent) &&
    ((TYPE_WRAPPERS.has(parent.type) && parent.expression === current) ||
      parent.type === "ChainExpression")
  ) {
    current = parent;
    parent = current.parent;
  }
  return current;
}

/**
 * @param {AstNode} callee An expression.
 * @returns {AstNode | null} The call it is the callee of, read through wrappers, or null.
 */
function callOf(callee) {
  const outer = outermost(callee);
  const parent = outer.parent;
  return isNode(parent) && parent.type === "CallExpression" && parent.callee === outer
    ? parent
    : null;
}

/**
 * @param {AstNode} identifier An identifier read by a reference.
 * @returns {boolean} Whether it is read by `typeof` in a type, which the scope manager counts as a
 *   value reference although it builds nothing.
 */
function isInTypeQuery(identifier) {
  let parent = identifier.parent;
  while (isNode(parent) && parent.type === "TSQualifiedName") parent = parent.parent;
  return isNode(parent) && parent.type === "TSTypeQuery";
}

/**
 * @param {unknown} name The `imported`, `local` or `exported` name of a specifier.
 * @returns {string | null} The name it writes: an identifier's, or a string's.
 */
function specifierName(name) {
  if (!isNode(name)) return null;
  if (name.type === "Identifier") return typeof name.name === "string" ? name.name : null;
  return name.type === "Literal" && typeof name.value === "string" ? name.value : null;
}

/**
 * @param {AstNode} declaration An import or export declaration.
 * @returns {string | null} The module it names, or null when it names none.
 */
function sourceOf(declaration) {
  const source = declaration.source;
  return isNode(source) && typeof source.value === "string" ? source.value : null;
}

/**
 * @param {string} source A module specifier.
 * @returns {boolean} Whether it is the shared kernel, by its barrel or a path inside it.
 */
function isSharedKernel(source) {
  return source === SHARED_KERNEL || source.startsWith(`${SHARED_KERNEL}/`);
}

/**
 * @typedef {object} ImportedBinding
 * @property {string} source The module the import names.
 * @property {string | null} imported The name it imports; null for a namespace import.
 * @property {string | null} local The name it binds.
 */

/**
 * @param {import("eslint").Scope.Variable | null} variable A variable of the file, or null.
 * @returns {ImportedBinding | null} The value import that declares it: a named or a namespace
 *   import that is not type-only.
 */
function importOf(variable) {
  const definition = variable?.defs[0];
  if (definition?.type !== "ImportBinding") return null;
  const specifier = asNode(definition.node);
  const declaration = asNode(definition.parent);
  if (specifier.importKind === "type" || declaration.importKind === "type") return null;
  const source = sourceOf(declaration);
  if (source === null) return null;
  const local = specifierName(specifier.local);
  if (specifier.type === "ImportNamespaceSpecifier") return { source, imported: null, local };
  if (specifier.type !== "ImportSpecifier") return null;
  return { source, imported: specifierName(specifier.imported), local };
}

/**
 * @typedef {object} ObjectEntry
 * @property {string | null} key The name of the property's key, when the source fixes it.
 * @property {AstNode | null} value Its value, read through type wrappers.
 */

/**
 * @param {unknown} expression An expression.
 * @returns {ObjectEntry[] | null} The properties of the object literal it is, spreads left out, or
 *   null when it is no object literal.
 */
function objectEntries(expression) {
  const node = unwrap(expression);
  if (node?.type !== "ObjectExpression" || !Array.isArray(node.properties)) return null;
  return node.properties
    .filter((property) => isNode(property) && property.type === "Property")
    .map((property) => ({
      key: keyName(property.key, property.computed),
      value: unwrap(property.value),
    }));
}

/**
 * @param {unknown} argument The first argument given to `err`, or a part of it.
 * @returns {boolean} Whether it holds a code or a message written in place: a string or a
 *   template, read through a `+`, either branch of a conditional, either side of a logical
 *   expression, and the property values of an object literal.
 */
function isWrittenInPlace(argument) {
  const node = unwrap(argument);
  if (node === null) return false;
  if (node.type === "Literal") return typeof node.value === "string";
  if (node.type === "TemplateLiteral") return true;
  if (node.type === "ConditionalExpression") {
    return isWrittenInPlace(node.consequent) || isWrittenInPlace(node.alternate);
  }
  if (node.type === "LogicalExpression") {
    return isWrittenInPlace(node.left) || isWrittenInPlace(node.right);
  }
  if (node.type === "ObjectExpression") {
    return (objectEntries(node) ?? []).some((entry) => isWrittenInPlace(entry.value));
  }
  return (
    node.type === "BinaryExpression" &&
    node.operator === "+" &&
    (isWrittenInPlace(node.left) || isWrittenInPlace(node.right))
  );
}

/**
 * @param {unknown} target What a destructured property is bound to.
 * @returns {string | null} The name it binds, defaults read through, or null for a nested pattern.
 */
function boundName(target) {
  const node = isNode(target) && target.type === "AssignmentPattern" ? target.left : target;
  return isNode(node) && node.type === "Identifier" && typeof node.name === "string"
    ? node.name
    : null;
}

/**
 * @typedef {object} ReplyChain
 * @property {boolean} isReply Whether the chain starts at the identifier `reply` or reads a member
 *   `reply`.
 * @property {unknown[]} statuses The first argument of each `status` or `code` call of the chain.
 */

/**
 * @param {unknown} start The object a `send` is read on.
 * @returns {ReplyChain} What the chain of calls and members ending at `start` is, read back to
 *   its root through type wrappers and optional chains.
 */
function readReplyChain(start) {
  /** @type {unknown[]} */
  const statuses = [];
  let node = unwrap(start);
  while (node !== null) {
    if (node.type === "ChainExpression") {
      node = unwrap(node.expression);
    } else if (node.type === "CallExpression") {
      const callee = unwrap(node.callee);
      if (callee?.type !== "MemberExpression") return { isReply: false, statuses };
      if (STATUS_SETTERS.has(propertyName(callee) ?? "")) {
        statuses.push(Array.isArray(node.arguments) ? node.arguments[0] : undefined);
      }
      node = unwrap(callee.object);
    } else if (node.type === "MemberExpression") {
      if (propertyName(node) === "reply") return { isReply: true, statuses };
      node = unwrap(node.object);
    } else {
      return { isReply: node.type === "Identifier" && node.name === "reply", statuses };
    }
  }
  return { isReply: false, statuses };
}

/**
 * @param {unknown} status The argument of a `status` or `code` call.
 * @returns {boolean} Whether it is a numeric literal below the first failure status.
 */
function isSuccessStatus(status) {
  const node = unwrap(status);
  return (
    node?.type === "Literal" && typeof node.value === "number" && node.value < FIRST_FAILURE_STATUS
  );
}

/**
 * @param {unknown} status The argument of a `status` or `code` call.
 * @returns {boolean} Whether it is a numeric literal at or above the first failure status.
 */
function isFailureStatus(status) {
  const node = unwrap(status);
  return (
    node?.type === "Literal" && typeof node.value === "number" && node.value >= FIRST_FAILURE_STATUS
  );
}

/**
 * @param {ObjectEntry} entry A property of an object literal.
 * @param {boolean} literal The literal `ok` must hold.
 * @returns {boolean} Whether it is the key `ok` with that literal as its value.
 */
function isOk(entry, literal) {
  return entry.key === "ok" && entry.value?.type === "Literal" && entry.value.value === literal;
}

/**
 * @param {unknown} body The argument of a `send`.
 * @returns {boolean} Whether it is an object literal written as a failure: a key `error`, or a key
 *   `ok` whose value is the literal `false`.
 */
function isFailureBody(body) {
  return (objectEntries(body) ?? []).some((entry) => entry.key === "error" || isOk(entry, false));
}

/**
 * @param {unknown} body The argument of a `send`.
 * @returns {boolean} Whether it is an object literal written as a success, a key `ok` whose value
 *   is the literal `true`. It excuses a status the rule cannot read, and nothing else: a failure
 *   status written in place, or a failure body's key beside it, is still reported.
 */
function isSuccessBody(body) {
  return (objectEntries(body) ?? []).some((entry) => isOk(entry, true));
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow building an error outside the central error registry" },
    schema: [
      {
        type: "object",
        properties: {
          runtimeErrors: { type: "array", items: { type: "string" } },
          baseClasses: { type: "array", items: { type: "string" } },
          replyHelpers: { type: "array", items: { type: "string" } },
          // One path relative to the root, written as the rule compares it: not empty, not
          // absolute, not starting at `.` or `..`, and with no backslash.
          bodyWriter: { type: "string", pattern: "^(?!/)(?![A-Za-z]:)(?!\\.\\.?/)[^\\\\]+$" },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [DEFAULT_OPTIONS],
    messages: {
      construction:
        "`{{name}}` is built with `new`, so its code, status and text are written at this site. " +
        "Build the error from the central registry, `packages/shared/src/error-registry/`, with " +
        "`<Class>.of(<TABLE>.<CODE>, params)`, which takes no text.",
      errorClass:
        "`{{name}}` extends `Error`: a failure is a code registered in " +
        "`packages/shared/src/error-registry/` and built with `RegisteredError.of(<TABLE>.<CODE>, " +
        "params)` (`UseCaseError.of` in the core), not a class of its own.",
      factory:
        "`{{name}}.{{member}}(…)` builds an error through a member of its class, which chooses " +
        "its code, status or text outside the registry. Build it from the central registry with " +
        "`<Class>.of(<TABLE>.<CODE>, params)`.",
      classReference:
        "`{{name}}` is used as a value, so what it builds is no longer seen where it is built. " +
        "An error class is used only to build an error with `of`, on the right of `instanceof`, " +
        "in an `extends` clause, through `.prototype` or `.name`, or as a type.",
      definitionSource:
        "The first argument of `{{name}}.of` is not a definition read from a registry table: " +
        "write `<TABLE>.<CODE>`, with the table imported by its own name from `@shared/types`.",
      registryDefinition:
        "`defineErrors` is used outside `packages/shared/src/error-registry/`: an error " +
        "definition is made only in the registry.",
      codeLiteral:
        "`err` from `@shared/types` is {{what}}. Return a registered error instead, " +
        "`err(<Class>.of(<TABLE>.<CODE>, params))`, so the failure's code and text are the " +
        "registry's.",
      replyHelper:
        "`{{name}}` is a legacy reply helper: it answers a failure with a status and a text " +
        "chosen at its call. Raise or return a registered error instead, which the one error " +
        "body answers.",
      inlineReply:
        "This reply answers a failure written in place: a status that is not a numeric literal " +
        "below 400, or a body with an `error` key or `ok: false`. Raise or return a registered " +
        "error instead, which the one error body answers.",
    },
  },
  create(context) {
    const [options] = /** @type {[RuleOptions]} */ (context.options);
    const runtimeErrors = new Set(options.runtimeErrors);
    const baseClasses = new Set(options.baseClasses);
    const replyHelpers = new Set(options.replyHelpers);

    /**
     * @param {string} name An identifier.
     * @returns {boolean} Whether it names an error class.
     */
    function isErrorClass(name) {
      return (
        UPPER_CASE_START.test(name) && name.endsWith(ERROR_CLASS_SUFFIX) && !runtimeErrors.has(name)
      );
    }

    /**
     * @param {import("eslint").Rule.Node} node A class declaration or expression.
     */
    function checkClass(node) {
      const declaration = asNode(node);
      if (!isErrorSuperclass(declaration.superClass)) return;
      const name = classNameOf(declaration);
      if (name !== null && baseClasses.has(name)) return;
      context.report({ node, messageId: "errorClass", data: { name: name ?? ANONYMOUS_CLASS } });
    }

    const sourceCode = context.sourceCode;
    const file = path.relative(context.cwd, context.filename).split(path.sep).join("/");
    const inRegistry = file.startsWith(REGISTRY_DIRECTORY);
    const inKernel = file.startsWith(KERNEL_DIRECTORY);
    const isBodyWriter = options.bodyWriter !== undefined && file === options.bodyWriter;

    /**
     * @param {string} source A module specifier of this file.
     * @returns {boolean} Whether it is the shared kernel: by its name, or by a relative path from
     *   a file of the kernel itself.
     */
    function isKernelSource(source) {
      return isSharedKernel(source) || (inKernel && source.startsWith("."));
    }

    /**
     * Every reference of the file, by the identifier it reads.
     * @type {Map<unknown, import("eslint").Scope.Reference>}
     */
    const references = new Map();
    for (const scope of sourceCode.scopeManager?.scopes ?? []) {
      for (const reference of scope.references) references.set(reference.identifier, reference);
    }

    /**
     * @param {AstNode} node What to report.
     * @param {string} messageId The shape.
     * @param {Record<string, string>} [data] The message's values.
     */
    function report(node, messageId, data) {
      const estree = /** @type {import("eslint").Rule.Node} */ (/** @type {unknown} */ (node));
      context.report({ node: estree, messageId, ...(data !== undefined && { data }) });
    }

    /**
     * @param {AstNode} identifier An identifier read by a reference.
     * @returns {ImportedBinding | null} The value import it reads, when it reads one.
     */
    function importRead(identifier) {
      return importOf(references.get(identifier)?.resolved ?? null);
    }

    /**
     * @param {unknown} argument The first argument of a call of `of`.
     * @returns {boolean} Whether it is `<TABLE>.<CODE>`, the table imported by its own name from
     *   the shared kernel, or by a relative import inside the registry.
     */
    function isTableCode(argument) {
      if (!isNode(argument) || argument.type !== "MemberExpression") return false;
      if (argument.computed === true) return false;
      const code = keyName(argument.property, false);
      if (code === null || !ERROR_CODE_PATTERN.test(code)) return false;
      // Only an identifier is a reference, so a table read through a member resolves to nothing.
      const binding = importRead(asNode(argument.object));
      return (
        binding !== null &&
        binding.local !== null &&
        binding.local.endsWith(TABLE_SUFFIX) &&
        binding.imported === binding.local &&
        (binding.source === SHARED_KERNEL || (inRegistry && binding.source.startsWith(".")))
      );
    }

    /**
     * @param {AstNode} member A member read on an error class.
     * @param {string} name The class.
     */
    function checkMemberOfClass(member, name) {
      const memberName = propertyName(member);
      if (memberName !== null && INERT_MEMBERS.has(memberName)) return;
      const call = callOf(member);
      if (call === null) {
        report(member, "classReference", { name });
      } else if (memberName !== REGISTRY_PATH) {
        report(call, "factory", { name, member: memberName ?? COMPUTED_MEMBER });
      } else if (!isTableCode(Array.isArray(call.arguments) ? call.arguments[0] : null)) {
        report(call, "definitionSource", { name });
      }
    }

    /**
     * @param {AstNode} expression An identifier or a member that reads an error class as a value.
     * @param {string} name The class.
     */
    function checkClassUse(expression, name) {
      const outer = outermost(expression);
      const parent = asNode(outer.parent);
      if (parent.type === "NewExpression" && parent.callee === outer) return;
      if (parent.type === "MemberExpression" && parent.object === outer) {
        checkMemberOfClass(parent, name);
        return;
      }
      if (parent.type === "BinaryExpression" && parent.operator === "instanceof") {
        if (parent.right === outer) return;
      }
      if (parent.type === "ClassDeclaration" || parent.type === "ClassExpression") {
        if (parent.superClass === outer) return;
      }
      if (parent.type === "ExportSpecifier") return;
      report(outer, "classReference", { name });
    }

    /**
     * @param {AstNode} expression An identifier or a member that reads the kernel's `err`.
     */
    function checkFailureUse(expression) {
      const outer = outermost(expression);
      const parent = asNode(outer.parent);
      if (parent.type === "ExportSpecifier") return;
      if (parent.type !== "CallExpression" || parent.callee !== outer) {
        report(outer, "codeLiteral", { what: FAILURE_MISUSE.AS_VALUE });
      } else if (isWrittenInPlace(Array.isArray(parent.arguments) ? parent.arguments[0] : null)) {
        report(parent, "codeLiteral", { what: FAILURE_MISUSE.IN_PLACE });
      }
    }

    /**
     * @param {import("eslint").Scope.Reference} reference A value read of the file.
     */
    function checkReference(reference) {
      const identifier = asNode(reference.identifier);
      const name = typeof identifier.name === "string" ? identifier.name : "";
      if (isErrorClass(name)) checkClassUse(identifier, name);
      const binding = importRead(identifier);
      if (binding === null || !isKernelSource(binding.source)) return;
      if (binding.imported === RESULT_FAILURE) {
        checkFailureUse(identifier);
        return;
      }
      const parent = asNode(identifier.parent);
      if (parent.type !== "MemberExpression" || parent.object !== identifier) return;
      if (propertyName(parent) === RESULT_FAILURE) checkFailureUse(parent);
    }

    /**
     * @param {AstNode} specifier An import or export specifier that binds `from` as `to`.
     * @param {string | null} from The name it reads.
     * @param {string | null} to The name it binds or exports.
     * @param {boolean} fromKernel Whether `from` is the shared kernel's.
     */
    function checkSpecifier(specifier, from, to, fromKernel) {
      if (from === null) return;
      if (isErrorClass(from) && (to === null || !isErrorClass(to))) {
        report(specifier, "classReference", { name: from });
      }
      if (from !== RESULT_FAILURE || !fromKernel) return;
      if (from !== to) report(specifier, "codeLiteral", { what: FAILURE_MISUSE.RENAMED });
      else if (specifier.type === "ExportSpecifier") {
        report(specifier, "codeLiteral", { what: FAILURE_MISUSE.AS_VALUE });
      }
    }

    /**
     * Each name use already reported, by shape and start: an import or a shorthand property names
     * one binding twice at one place.
     */
    const nameUses = new Set();

    /**
     * @param {AstNode} node A use of a name the rule reports by name.
     * @param {string} messageId The shape.
     * @param {Record<string, string>} [data] The message's values.
     */
    function reportNameUse(node, messageId, data) {
      const [start] = /** @type {[number, number]} */ (node.range);
      const key = `${messageId}:${String(start)}`;
      if (nameUses.has(key)) return;
      nameUses.add(key);
      report(node, messageId, data);
    }

    /**
     * @param {AstNode} node An identifier, or a member read under a static computed key.
     * @param {string} name The name it reads.
     */
    function checkName(node, name) {
      if (name === DEFINE_ERRORS && !inRegistry) reportNameUse(node, "registryDefinition");
      if (replyHelpers.has(name)) reportNameUse(node, "replyHelper", { name });
    }

    return {
      Program() {
        for (const reference of references.values()) {
          const valueReference = /** @type {{ isValueReference?: boolean }} */ (reference)
            .isValueReference;
          if (!reference.isRead() || valueReference === false) continue;
          if (isInTypeQuery(asNode(reference.identifier))) continue;
          checkReference(reference);
        }
      },
      NewExpression(node) {
        const name = lastName(node.callee);
        if (name === null || !isErrorClass(name)) return;
        if (isInsideOwnOf(context.sourceCode.getAncestors(node), name)) return;
        context.report({ node, messageId: "construction", data: { name } });
      },
      ClassDeclaration: checkClass,
      ClassExpression: checkClass,
      MemberExpression(node) {
        const member = asNode(node);
        const name = propertyName(member);
        if (name === null) return;
        // A key in brackets is no identifier, so the `Identifier` visitor does not see it.
        if (member.computed === true) checkName(member, name);
        if (isErrorClass(name)) checkClassUse(member, name);
      },
      Identifier(node) {
        const parent = asNode(node.parent);
        // A helper's own declaration, as a function or as a method, is not a use of it.
        if (parent.type === "FunctionDeclaration" && parent.id === node) return;
        const isMethodName =
          parent.type === "MethodDefinition" && parent.key === node && parent.computed !== true;
        if (isMethodName && replyHelpers.has(node.name)) return;
        checkName(asNode(node), node.name);
      },
      CallExpression(node) {
        if (isBodyWriter) return;
        const callee = unwrap(node.callee);
        if (callee?.type !== "MemberExpression" || propertyName(callee) !== "send") return;
        const chain = readReplyChain(callee.object);
        if (!chain.isReply) return;
        const body = node.arguments[0];
        const unreadStatus = chain.statuses.some(
          (status) => !isSuccessStatus(status) && !isFailureStatus(status)
        );
        if (
          chain.statuses.some(isFailureStatus) ||
          isFailureBody(body) ||
          (unreadStatus && !isSuccessBody(body))
        ) {
          report(asNode(node), "inlineReply");
        }
      },
      Property(node) {
        const property = asNode(node);
        if (asNode(property.parent).type !== "ObjectPattern") return;
        const key = keyName(property.key, property.computed);
        if (key === null || !isErrorClass(key)) return;
        const bound = boundName(property.value);
        if (bound !== null && isErrorClass(bound)) return;
        report(property, "classReference", { name: key });
      },
      ImportSpecifier(node) {
        const specifier = asNode(node);
        const declaration = asNode(specifier.parent);
        if (specifier.importKind === "type" || declaration.importKind === "type") return;
        const source = sourceOf(declaration);
        const from = specifierName(specifier.imported);
        const to = specifierName(specifier.local);
        checkSpecifier(specifier, from, to, source !== null && isKernelSource(source));
      },
      ExportSpecifier(node) {
        const specifier = asNode(node);
        const declaration = asNode(specifier.parent);
        if (specifier.exportKind === "type" || declaration.exportKind === "type") return;
        const source = sourceOf(declaration);
        const local = asNode(specifier.local);
        const binding = source === null ? importRead(local) : null;
        // A re-export names its module; an export of a local name reads the import that binds it.
        const fromKernel =
          source !== null
            ? isSharedKernel(source)
            : binding !== null &&
              isKernelSource(binding.source) &&
              binding.imported === RESULT_FAILURE;
        checkSpecifier(
          specifier,
          specifierName(local),
          specifierName(specifier.exported),
          fromKernel
        );
      },
    };
  },
};

export default rule;
