/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  packageManager: "pnpm",
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  // checkers eliminado — corre `tsc --noEmit` antes de Stryker en su lugar
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
  reporters: ["html", "clear-text", "progress"],
  htmlReporter: {
    fileName: "reports/mutation/index.html",
  },
  thresholds: {
    high: 80,
    low: 60,
    break: 52,
  },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
  concurrency: 2,
  maxTestRunnerReuse: 20, // recicla workers, evita memory leak acumulativo
  timeoutMS: 60000,
  timeoutFactor: 2,
};
