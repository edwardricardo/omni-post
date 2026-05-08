/**
 * @file healthClient.ts
 * @description Admin health endpoint client.
 * @layer infrastructure
 */

import { http } from "./http";

/**
 * @function health
 * @description Pings the backend `/health` endpoint through the admin proxy.
 */
export const healthClient = {
  health: () => http<{ ok: boolean }>("/health"),
};
