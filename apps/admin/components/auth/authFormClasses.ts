/**
 * @file authFormClasses.ts
 * @description The class strings the administrators' sign-in form and the required password change
 *   share: the text inputs and the submit button. Kept out of the components' modules so each of
 *   those exports only its component.
 * @layer infrastructure
 */

/** The classes of the text inputs of the sign-in and of the required password change. */
export const AUTH_INPUT_CLASS = [
  "appearance-none rounded-md relative block w-full px-3 py-2",
  "border border-[var(--border-default)] bg-[var(--bg-surface)]",
  "placeholder-[var(--text-tertiary)] text-[var(--text-primary)]",
  "focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)]",
  "sm:text-sm",
].join(" ");

/** The classes of the submit button of the sign-in and of the required password change. */
export const AUTH_SUBMIT_CLASS = [
  "group relative w-full flex justify-center py-2 px-4",
  "border border-transparent text-sm font-medium rounded-md",
  "text-[var(--accent-fg)] bg-[var(--accent)] hover:bg-[var(--accent-hover)]",
  "focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-[var(--accent)]",
  "disabled:opacity-50 disabled:cursor-not-allowed",
  "transition-colors",
].join(" ");
