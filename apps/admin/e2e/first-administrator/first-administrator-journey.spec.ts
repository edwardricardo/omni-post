/**
 * @file first-administrator-journey.spec.ts
 * @description The first administrator's journey across the operator command, the API and the
 *              administration portal. The spec runs the command in a pseudo-terminal, as an
 *              operator would, on the database the running API uses, which must hold no
 *              administrator; it reads the single-use password from the block the command prints.
 *              Then, in the browser: the sign-in with that password leads to the page of the
 *              required change and opens no session; the change leads back to the sign-in with its
 *              notice; the sign-in with the new password opens the dashboard and its session. The
 *              journey makes three requests to the sign-in's rate limit and fails none.
 *
 *              The passwords stay in this process. Every assertion is `expect.poll` over a URL, a
 *              visibility or a list of texts, or `expect` over the names of the cookies, and never
 *              an `expect(page)` or `expect(locator)` matcher: a failed matcher of those two kinds
 *              attaches an aria snapshot of the page, which holds the value of every input, a
 *              password field's included, to the error context Playwright writes to a file, and a
 *              poll attaches none. The command's failure leaves the password's line out. The
 *              configuration beside this file turns off the snapshot of the page of a failed test,
 *              the trace, screenshots and videos, and uses no reporter that lists steps.
 * @layer infrastructure
 */
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { runInPseudoTerminal } from "@packages/vitest-shared/pseudo-terminal";

const API_DIR = fileURLToPath(new URL("../../../api/", import.meta.url));

/** The administrator's address; the sign-in's e-mail rule accepts an example.com address. */
const EMAIL = "first.admin@example.com";

/** How long the command may run before it is ended: it loads the API's code through tsx. */
const COMMAND_LIMIT_MS = 120_000;

/** The label of the line of the command's block that holds the single-use password. */
const PASSWORD_LABEL = "Single-use password:";

/** The cookie a sign-in sets in the portal: the session of the administrator. */
const SESSION_COOKIE = "admin-session";

/**
 * Creates the first administrator with the operator command, in a pseudo-terminal because the
 * command writes the password to nothing else, and returns the single-use password it printed.
 * A failure names the exit code and the terminal's lines without the password's line, which a
 * command that printed its block and then failed to end would otherwise carry.
 */
async function createFirstAdministrator(): Promise<string> {
  const command = [
    process.execPath,
    "--conditions",
    "development",
    "--import",
    "tsx",
    "src/cli/createFirstAdministrator.ts",
    "--email",
    EMAIL,
  ]
    .map((word) => `'${word}'`)
    .join(" ");
  const run = await runInPseudoTerminal({
    command,
    cwd: API_DIR,
    env: process.env,
    timeoutMs: COMMAND_LIMIT_MS,
  });
  // A terminal ends its lines with CR LF.
  const lines = run.stdout.split("\r\n");
  const passwordLine = `  ${PASSWORD_LABEL} `;
  const password = lines.find((line) => line.startsWith(passwordLine))?.slice(passwordLine.length);
  if (run.code !== 0 || run.killed || password === undefined) {
    const shown = lines.filter((line) => !line.includes(PASSWORD_LABEL)).join("\n");
    throw new Error(
      `The command did not create the administrator: exit code ${String(run.code)}, ` +
        `${run.killed ? "ended by its time limit" : "ended by itself"}, ` +
        `${password === undefined ? "no" : "one"} password line. The terminal showed:\n${shown}` +
        `\nscript wrote:\n${run.stderr}`
    );
  }
  return password;
}

/** A new password the policy accepts: every class of character, and 32 random hex digits. */
function newPassword(): string {
  return `Journey-${randomBytes(16).toString("hex")}-Q7`;
}

test("the first administrator signs in with the single-use password, sets a new one and signs in with it", async ({
  page,
  context,
  baseURL,
}) => {
  const singleUsePassword = await createFirstAdministrator();
  const chosenPassword = newPassword();
  const at = (path: string): string => new URL(path, baseURL).href;
  const sessionCookies = async (): Promise<string[]> =>
    (await context.cookies()).filter(({ name }) => name === SESSION_COOKIE).map(({ name }) => name);

  await page.goto("/en/login");
  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(singleUsePassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect.poll(() => page.url()).toBe(at("/en/login/change-password"));
  await expect
    .poll(() => page.getByRole("heading", { level: 1, name: "Set a new password" }).isVisible())
    .toBe(true);
  expect(await sessionCookies()).toEqual([]);

  await page.getByLabel("E-mail address").fill(EMAIL);
  await page.getByLabel("Current password").fill(singleUsePassword);
  await page.getByLabel("New password", { exact: true }).fill(chosenPassword);
  await page.getByLabel("Confirm the new password").fill(chosenPassword);
  await page.getByRole("button", { name: "Change password" }).click();

  await expect.poll(() => page.url()).toBe(at("/en/login?passwordChanged=1"));
  await expect
    .poll(() => page.getByRole("status").allTextContents())
    .toEqual(["The password was changed. Sign in with the new password."]);
  expect(await sessionCookies()).toEqual([]);

  await page.getByLabel("Email address").fill(EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(chosenPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect.poll(() => page.url()).toBe(at("/en"));
  await expect
    .poll(() => page.getByRole("heading", { level: 1, name: "Dashboard", exact: true }).isVisible())
    .toBe(true);
  expect(await sessionCookies()).toEqual([SESSION_COOKIE]);
});
