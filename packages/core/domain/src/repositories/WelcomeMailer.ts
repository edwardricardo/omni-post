/**
 * @file WelcomeMailer.ts
 * @description Role port for sending the customer welcome email. The use case
 *              provides business data; the infrastructure adapter renders the
 *              template and sends it.
 * @layer domain
 */

import type { Result } from "@shared/types";

/** Business data for the welcome email. */
export interface WelcomeEmailData {
  accountName: string;
  onboardingUrl: string;
  supportEmail: string;
}

/** Sends the welcome email to a newly registered customer. */
export interface WelcomeMailer {
  sendWelcome(to: string, data: WelcomeEmailData): Promise<Result<void, Error>>;
}
