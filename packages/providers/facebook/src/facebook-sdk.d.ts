declare module "facebook-nodejs-business-sdk" {
  export class FacebookApi {
    static init(appId: string, appSecret: string): FacebookApi;
    [key: string]: unknown;
  }
  export const Ad: unknown;
  export const Campaign: unknown;
  export const AdAccount: unknown;
}
