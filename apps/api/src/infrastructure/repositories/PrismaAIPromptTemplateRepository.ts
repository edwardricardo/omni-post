/**
 * @file PrismaAIPromptTemplateRepository.ts
 * @description Prisma adapter implementing the AIPromptTemplateRepository port.
 * @layer infrastructure
 */

import type { PrismaClient, Prisma } from "@infra/prisma";
import type {
  AIPromptTemplateRepository,
  AIPromptTemplateData,
  CreateAIPromptTemplateData,
  UpdateAIPromptTemplateData,
} from "@core/domain/repositories/AIPromptTemplateRepository.js";

/**
 * @class PrismaAIPromptTemplateRepository
 * @description Adapts PrismaClient to the AIPromptTemplateRepository port.
 */
export class PrismaAIPromptTemplateRepository implements AIPromptTemplateRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findAll(accountId?: string): Promise<AIPromptTemplateData[]> {
    return this.prisma.aIPromptTemplate.findMany({
      where: {
        OR: [{ isSystem: true }, ...(accountId !== undefined ? [{ accountId }] : [])],
      },
      orderBy: [{ isSystem: "desc" }, { createdAt: "asc" }],
    });
  }

  async findById(id: string): Promise<AIPromptTemplateData | null> {
    return this.prisma.aIPromptTemplate.findUnique({ where: { id } });
  }

  async create(data: CreateAIPromptTemplateData): Promise<AIPromptTemplateData> {
    return this.prisma.aIPromptTemplate.create({
      data: {
        ...data,
        variables: data.variables as Prisma.InputJsonValue,
      },
    });
  }

  async update(id: string, data: UpdateAIPromptTemplateData): Promise<AIPromptTemplateData> {
    return this.prisma.aIPromptTemplate.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.platforms !== undefined && { platforms: data.platforms }),
        ...(data.prompt !== undefined && { prompt: data.prompt }),
        ...(data.variables !== undefined && { variables: data.variables as Prisma.InputJsonValue }),
        ...(data.tone !== undefined && { tone: data.tone }),
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.aIPromptTemplate.delete({ where: { id } });
  }
}
