/**
 * @file authClient.ts
 * @description Admin authentication endpoints. Login here is rare — most
 *              admin auth flows go through the Server Action in
 *              `app/actions/auth.ts`. This client exposes the raw login
 *              endpoint for legacy code paths that bypass the Server Action.
 * @layer infrastructure
 */

import { http } from "./http.js";

export interface LoginCredentials {
  email: string;
  password: string;
  mfaToken?: string;
}

export interface LoginResponse {
  ok: boolean;
  user?: unknown;
  tokens?: unknown;
  mfaRequired?: boolean;
}

/**
 * @const authClient
 * @description Methods for `/auth/login`.
 */
export const authClient = {
  login: (credentials: LoginCredentials) =>
    http<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials),
    }),
};
