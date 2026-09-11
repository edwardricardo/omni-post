/**
 * @file RequestPasswordResetUseCase.ts
 * @description Issues one DISTINCT password-reset token per matching customer-user
 *   row and composes a single e-mail carrying one labelled link per account. Always
 *   returns ok with the same message, whatever the address matched, so the endpoint
 *   is not an account-enumeration oracle.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { CustomerUserRepository } from "@core/domain/repositories/CustomerUserRepository.js";
import type { AccountQueryRepositoryPort } from "@core/domain/repositories/AccountQueryRepository.js";
import type { EmailPort } from "@core/domain/repositories/EmailPort.js";
import { randomBytes } from "crypto";

/** Error code union */
export type RequestPasswordResetError = "INTERNAL_ERROR";

/** Input DTO */
export interface RequestPasswordResetInput {
  readonly email: string;
  readonly resetBaseUrl?: string;
}

/** Output DTO */
export interface RequestPasswordResetOutput {
  /** The uniform message. Identical for zero, one and N matches. */
  readonly message: string;
  /**
   * How many matched rows could NOT have their token persisted. Carried on the
   * success value so the caller can observe a per-row failure instead of it being
   * discarded; the transport projects a CONSTANT body and reports this separately,
   * so surfacing it here can never widen the response silhouette.
   */
  readonly unpersistedCount: number;
}

/** Label used when the account read model cannot name an account. */
const GENERIC_ACCOUNT_LABEL = "Your account";

/** Token lifetime, mirrored in the e-mail copy. */
const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Escape text that is interpolated into the HTML body. An account name is
 * tenant-controlled text, so it reaches the e-mail as data, never as markup.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One reset link, already bound to the account it resets. */
interface ResetLink {
  readonly label: string;
  readonly url: string;
}

/**
 * @class RequestPasswordResetUseCase
 * @description Persists a per-row reset token for every account the address belongs
 *   to and sends exactly ONE e-mail listing them. Always returns ok to prevent
 *   e-mail enumeration.
 */
export class RequestPasswordResetUseCase {
  constructor(
    private readonly customerUserRepo: CustomerUserRepository,
    private readonly clientUrl: string,
    private readonly emailPort?: EmailPort,
    private readonly unitOfWork?: UnitOfWork,
    private readonly accountQueryRepo?: AccountQueryRepositoryPort
  ) {}

  /**
   * @method execute
   * @description Issues one distinct token per matched row, then sends one e-mail
   *   carrying a link per row whose token was actually persisted.
   * @param input - The requested address and an optional reset base URL.
   * @returns ok with the uniform message and the count of rows whose token could not
   *   be persisted; `INTERNAL_ERROR` only when the lookup itself fails.
   */
  async execute(
    input: RequestPasswordResetInput
  ): Promise<Result<RequestPasswordResetOutput, RequestPasswordResetError>> {
    const responseMessage = "If the email exists, a reset link has been sent";

    try {
      const users = await this.customerUserRepo.findByEmailAcrossAccounts(input.email);

      if (users.length === 0) {
        return ok({ message: responseMessage, unpersistedCount: 0 });
      }

      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
      const issued: Array<{ accountId: string; token: string }> = [];
      let unpersistedCount = 0;

      const doWork = async (): Promise<void> => {
        for (const user of users) {
          // Generated INSIDE the loop. `resetToken` is globally unique, so one token
          // reused across the rows sharing this address collides: one arbitrary row
          // wins and the rest fail.
          const token = randomBytes(32).toString("hex");
          const persisted = await this.customerUserRepo.issueResetToken(user.id, token, expiresAt);
          if (!persisted.ok) {
            unpersistedCount += 1;
            continue;
          }
          issued.push({ accountId: user.accountId, token });
        }
      };

      if (this.unitOfWork) {
        await this.unitOfWork.executeInTransaction(doWork);
      } else {
        await doWork();
      }

      // Send OUTSIDE the transaction (external call), and only for rows whose token
      // is actually on the row — a link nobody can claim is worse than no link.
      if (this.emailPort && issued.length > 0) {
        const baseUrl = input.resetBaseUrl || this.clientUrl;
        const links: ResetLink[] = [];
        for (const entry of issued) {
          links.push({
            label: await this.labelFor(entry.accountId),
            url: `${baseUrl}/reset-password?token=${entry.token}`,
          });
        }
        await this.emailPort.send({
          to: [input.email],
          subject: "OmniPost — Password Reset Request",
          body: this.composeText(links),
          html: this.composeHtml(links),
        });
      }

      return ok({ message: responseMessage, unpersistedCount });
    } catch (_error: unknown) {
      return err("INTERNAL_ERROR");
    }
  }

  /**
   * @method labelFor
   * @description Resolves the display name of the account a link resets so the
   *   recipient can choose between several. An account the read model cannot name
   *   degrades to a generic label — never to an error, because a labelling gap must
   *   not cost the recipient their reset link.
   * @param accountId - The account owning the row the link resets.
   * @returns The account name, or the generic label.
   */
  private async labelFor(accountId: string): Promise<string> {
    if (!this.accountQueryRepo) return GENERIC_ACCOUNT_LABEL;
    const found = await this.accountQueryRepo.findById(accountId);
    if (!found.ok || found.value.name.trim() === "") return GENERIC_ACCOUNT_LABEL;
    return found.value.name;
  }

  /**
   * @method composeText
   * @description Builds the plain-text body, one labelled link per line.
   * @param links - The labelled links to include.
   * @returns The plain-text e-mail body.
   */
  private composeText(links: ResetLink[]): string {
    const intro =
      links.length === 1
        ? "You requested a password reset. Use the link below to reset your password:"
        : "You requested a password reset. This address is registered on more than one account — use the link for the account you want to reset:";
    return [
      intro,
      "",
      ...links.map((link) => `${link.label}: ${link.url}`),
      "",
      "These links expire in 1 hour. If you did not request this, please ignore this email.",
    ].join("\n");
  }

  /**
   * @method composeHtml
   * @description Builds the HTML body. Account names are escaped; the URLs are
   *   composed from the configured base URL and a hex token, so they carry no
   *   caller-supplied text.
   * @param links - The labelled links to include.
   * @returns The HTML e-mail body.
   */
  private composeHtml(links: ResetLink[]): string {
    const intro =
      links.length === 1
        ? "<p>You requested a password reset.</p>"
        : "<p>You requested a password reset. This address is registered on more than one account — choose the account you want to reset:</p>";
    const items = links
      .map(
        (link) =>
          `<li>${escapeHtml(link.label)}: <a href="${link.url}">Reset your password</a></li>`
      )
      .join("");
    return `${intro}<ul>${items}</ul><p>These links expire in 1 hour. If you did not request this, please ignore this email.</p>`;
  }
}
