/**
 * @file .dependency-cruiser-resolve.cjs
 * @description The one resolve option `.dependency-cruiser.cjs` cannot hold itself: its schema
 *   accepts no `alias`, so the alias reaches the resolver through that file's
 *   `options.webpackConfig`, which reads the `resolve` section below. Everything else about the
 *   cruise (rules, scope, every other resolve option) lives in `.dependency-cruiser.cjs`.
 *
 *   `@shared/types` publishes no `development` export condition. Without this alias its `.js`
 *   subpaths resolve into `packages/shared/dist/` whenever that build output exists, which the
 *   cruise excludes, and 73 edges drop out of the graph.
 */
const path = require("node:path");

module.exports = {
  resolve: {
    alias: {
      // `module.path` is this file's directory, the repository root.
      "@shared/types": path.resolve(module.path, "packages/shared/src"),
    },
  },
};
