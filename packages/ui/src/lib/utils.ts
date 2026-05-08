/**
 * @file utils.ts
 * @description Shared UI utility functions — cn() combines clsx class conditionals with
 *              tailwind-merge to deduplicate conflicting Tailwind classes.
 * @layer infrastructure
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
