/**
 * @file deferred.ts
 * @description A promise with its `resolve` and `reject` handed out, for a test that settles a
 *              double's pending call at a point it chooses. Built by capturing the executor's
 *              functions: `Promise.withResolvers` belongs to ES2024, and the workspace compiles
 *              against ES2022.
 * @layer infrastructure
 */

/** A promise and the two functions that settle it. */
export interface Deferred<T> {
  /** The promise the two functions below settle. */
  readonly promise: Promise<T>;
  /** Resolves `promise`. Only the first call to `resolve` or `reject` has an effect. */
  resolve(value: T | PromiseLike<T>): void;
  /**
   * Rejects `promise`. Only the first call to `resolve` or `reject` has an effect. A rejected
   * promise that nothing awaits is an unhandled rejection, as with any promise.
   */
  reject(reason?: unknown): void;
  /** Whether `resolve` or `reject` has been called. */
  readonly settled: boolean;
}

/**
 * @description Creates a pending promise together with the functions that settle it.
 * @returns The deferred, unsettled.
 */
export function createDeferred<T>(): Deferred<T> {
  let settled = false;
  // The executor runs synchronously inside `new Promise`, so both are replaced before return.
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => {
      settled = true;
      resolvePromise(value);
    },
    reject: (reason) => {
      settled = true;
      rejectPromise(reason);
    },
    get settled() {
      return settled;
    },
  };
}
