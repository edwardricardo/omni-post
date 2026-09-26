/**
 * @file request.ts
 * @description next-intl request-scoped configuration. Delegates locale
 *   resolution + message loading to the shared `createRequestConfig` factory
 *   from `@packages/i18n` so admin + client stay in
 *   lockstep.
 * @layer infrastructure
 */
import { createRequestConfig } from "@packages/i18n";
import { routing } from "./routing";

export default createRequestConfig(routing, (locale) => import(`../messages/${locale}.json`));
