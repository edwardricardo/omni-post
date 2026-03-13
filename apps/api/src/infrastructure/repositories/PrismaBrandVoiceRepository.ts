/**
 * @file PrismaBrandVoiceRepository.ts
 * @description Prisma implementation of BrandVoiceRepository. Uses upsert to enforce
 *              the one-brand-voice-per-account constraint at the DB level.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  BrandVoiceRepository,
  BrandVoiceData,
} from "../../domain/repositories/BrandVoiceRepository.js";

export class PrismaBrandVoiceRepository implements BrandVoiceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByAccountId(accountId: string): Promise<BrandVoiceData | null> {
    const row = await this.prisma.brandVoice.findUnique({ where: { accountId } });
    return row ? this.toData(row) : null;
  }

  async upsert(
    data: Omit<BrandVoiceData, "id" | "createdAt" | "updatedAt">
  ): Promise<BrandVoiceData> {
    const row = await this.prisma.brandVoice.upsert({
      where: { accountId: data.accountId },
      create: {
        accountId: data.accountId,
        name: data.name,
        systemPrompt: data.systemPrompt,
        tone: data.tone,
        examples: data.examples,
        isActive: data.isActive,
      },
      update: {
        name: data.name,
        systemPrompt: data.systemPrompt,
        tone: data.tone,
        examples: data.examples,
        isActive: data.isActive,
      },
    });
    return this.toData(row);
  }

  async deleteByAccountId(accountId: string): Promise<void> {
    await this.prisma.brandVoice.deleteMany({ where: { accountId } });
  }

  private toData(row: {
    id: string;
    accountId: string;
    name: string;
    systemPrompt: string;
    tone: string[];
    examples: string[];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): BrandVoiceData {
    return {
      id: row.id,
      accountId: row.accountId,
      name: row.name,
      systemPrompt: row.systemPrompt,
      tone: row.tone,
      examples: row.examples,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
