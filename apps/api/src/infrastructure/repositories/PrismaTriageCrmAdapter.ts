/**
 * @file PrismaTriageCrmAdapter.ts
 * @description Prisma adapter for TriageCrmPort.
 *              Looks up CRM contacts by social handle for triage enrichment.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type { TriageCrmPort } from "@core/inbox/TriageInboxMessageUseCase.js";

export class PrismaTriageCrmAdapter implements TriageCrmPort {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * @method findContactByHandle
   * @description Searches CRM contacts by email match on the social handle.
   *              Falls back to null when no match is found.
   */
  async findContactByHandle(
    accountId: string,
    handle: string
  ): Promise<{ id: string; name: string; company: string | null } | null> {
    const contact = await this.prisma.crmContact.findFirst({
      where: {
        accountId,
        email: { contains: handle, mode: "insensitive" },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
      },
    });

    if (!contact) return null;

    const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || handle;
    return {
      id: contact.id,
      name,
      company: contact.company,
    };
  }
}
