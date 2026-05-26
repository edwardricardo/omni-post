/**
 * @file TeamInvitationMailer.ts
 * @description Role port for sending the team-invitation email. The use case
 *              provides business data; the infrastructure adapter renders the
 *              template and sends it.
 * @layer domain
 */

import type { Result } from "@shared/types";

/** Business data for the team-invitation email. */
export interface TeamInvitationEmailData {
  inviterName: string;
  accountName: string;
  role: string;
  acceptUrl: string;
}

/** Sends the team-invitation email to an invitee. */
export interface TeamInvitationMailer {
  sendTeamInvitation(to: string, data: TeamInvitationEmailData): Promise<Result<void, Error>>;
}
