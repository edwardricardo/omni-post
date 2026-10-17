/**
 * @file gate.ts
 * @description A one-shot gate: armed, it holds the next call routed through it until the test
 *              releases it. Two concurrent actors are ordered with it instead of with a sleep: the
 *              held call is a point the first actor provably reached, and the release is a point
 *              the test chooses. A double routes the call to hold through `pass`, for instance a
 *              repository read: `findById: (id) => gate.pass(() => readPost(id))`.
 * @layer infrastructure
 */

import { createDeferred } from "./deferred.js";

/** A one-shot gate over the calls routed through `pass`. */
export interface Gate {
  /**
   * Holds the next call to `pass`, and only that one. Throws once the gate has held a call or been
   * released: a spent gate holds nothing, and arming one again would let a test assert an ordering
   * that never happened.
   */
  arm(): void;
  /** Whether the held call has arrived at the gate. */
  hasReached(): boolean;
  /** Resolves once the held call has arrived. It stays pending while nothing is held. */
  reached(): Promise<void>;
  /** Lets the held call through, or the next one if it has not arrived yet. Safe to repeat. */
  release(): void;
  /** Runs `read`, waiting at the gate first when this is the call the gate holds. */
  pass<T>(read: () => T | Promise<T>): Promise<T>;
}

/**
 * @description Creates an unarmed gate. Until `arm` is called, every `pass` runs straight through.
 * @returns The gate.
 */
export function createGate(): Gate {
  let armed = false;
  const arrival = createDeferred<void>();
  const opening = createDeferred<void>();
  return {
    arm: () => {
      if (arrival.settled || opening.settled) {
        throw new Error(
          "createGate: the gate already held a call or was released; create a new one"
        );
      }
      armed = true;
    },
    hasReached: () => arrival.settled,
    reached: () => arrival.promise,
    release: () => {
      opening.resolve();
    },
    async pass<T>(read: () => T | Promise<T>): Promise<T> {
      if (armed) {
        armed = false;
        arrival.resolve();
        await opening.promise;
      }
      return await read();
    },
  };
}
