/**
 * @file vitest.setup.ts
 * @description Setup file of the story tests: a story that writes to console.error or
 *              console.warn while it renders or plays fails its test. React reports a missing
 *              key, an update outside act() and an invalid DOM property there, so a story can
 *              pass axe and its play function and still be broken.
 * @layer infrastructure
 */
import { afterEach, beforeEach, type MockInstance, vi } from "vitest";

// @storybook/addon-vitest provisions the preview annotations itself (Storybook 10.3 and later),
// so this file carries only the console contract.

const CONSOLE_METHODS = ["error", "warn"] as const;

type ConsoleMethod = (typeof CONSOLE_METHODS)[number];

interface ConsoleCall {
  method: ConsoleMethod;
  text: string;
}

let calls: ConsoleCall[] = [];
let spies: MockInstance[] = [];

const describeArgument = (value: unknown): string => {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

beforeEach(() => {
  calls = [];
  spies = CONSOLE_METHODS.map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      calls.push({ method, text: args.map(describeArgument).join(" ") });
    })
  );
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  spies = [];
  const recorded = calls;
  calls = [];
  if (recorded.length > 0) {
    const report = recorded.map(({ method, text }) => `console.${method}: ${text}`).join("\n");
    throw new Error(`The story wrote to the console while it ran:\n${report}`);
  }
});
