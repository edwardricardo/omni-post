/**
 * @file request.ts
 * @description next-intl request-scoped configuration. Delegates locale
 *   resolution + message loading to the shared `createRequestConfig` factory
 *   from `@shared/types/i18n/createRequestConfig` so admin + client stay in
 *   lockstep.
 * @layer infrastructure
 */
import { createRequestConfig } from "@shared/types/i18n/createRequestConfig";
import { routing } from "./routing.js";

export default createRequestConfig(routing, (locale) => import(`../messages/${locale}.json`));
