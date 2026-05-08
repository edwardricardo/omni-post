/**
 * @file facebook-sdk.d.ts
 * @description Ambient type declarations for the facebook-nodejs-business-sdk module used by
 *              the Facebook provider ad-management code paths.
 * @layer infrastructure
 */
declare module "facebook-nodejs-business-sdk" {
  export class FacebookApi {
    static init(appId: string, appSecret: string): FacebookApi;
    [key: string]: unknown;
  }
  export const Ad: unknown;
  export const Campaign: unknown;
  export const AdAccount: unknown;
}
