/**
 * @file PrismaRoleManagementRepository.ts
 * @description Prisma adapter implementing `RoleManagementRepository`.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type {
  RoleCreateInput,
  RoleManagementDetail,
  RoleManagementRepository,
  RoleManagementStoreError,
  RoleManagementSummary,
  RoleUpdateInput,
} from "@core/domain/repositories/RoleManagementRepository.js";

const DETAIL_INCLUDE = {
  permissions: true,
  _count: { select: { users: true } },
} as const;

const SUMMARY_SELECT = {
  id: true,
  name: true,
  isSystem: true,
  _count: { select: { users: true } },
} as const;

type DetailRow = {
  id: string;
  name: string;
  description: string;
  level: number;
  isSystem: boolean;
  isActive: boolean;
  permissions: Array<{ permission: string }>;
  _count: { users: number };
  createdAt: Date;
  updatedAt: Date;
};

type SummaryRow = {
  id: string;
  name: string;
  isSystem: boolean;
  _count: { users: number };
};

function rowToDetail(row: DetailRow): RoleManagementDetail {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    level: row.level,
    isSystem: row.isSystem,
    isActive: row.isActive,
    permissions: row.permissions.map((p) => p.permission),
    userCount: row._count.users,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToSummary(row: SummaryRow): RoleManagementSummary {
  return {
    id: row.id,
    name: row.name,
    isSystem: row.isSystem,
    userCount: row._count.users,
  };
}

export class PrismaRoleManagementRepository implements RoleManagementRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByName(
    name: string
  ): Promise<Result<RoleManagementSummary | null, RoleManagementStoreError>> {
    try {
      const row = await this.prisma.role.findUnique({
        where: { name },
        select: SUMMARY_SELECT,
      });
      return ok(row ? rowToSummary(row as SummaryRow) : null);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async findSummaryById(
    id: string
  ): Promise<Result<RoleManagementSummary | null, RoleManagementStoreError>> {
    try {
      const row = await this.prisma.role.findUnique({
        where: { id },
        select: SUMMARY_SELECT,
      });
      return ok(row ? rowToSummary(row as SummaryRow) : null);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async findDetailById(
    id: string
  ): Promise<Result<RoleManagementDetail | null, RoleManagementStoreError>> {
    try {
      const row = await this.prisma.role.findUnique({
        where: { id },
        include: DETAIL_INCLUDE,
      });
      return ok(row ? rowToDetail(row as DetailRow) : null);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async create(
    input: RoleCreateInput
  ): Promise<Result<RoleManagementDetail, RoleManagementStoreError>> {
    try {
      const row = await this.prisma.role.create({
        data: {
          name: input.name,
          description: input.description,
          level: input.level,
          isSystem: false,
          isActive: true,
          permissions: {
            create: input.permissions.map((p) => ({ permission: p })),
          },
        },
        include: DETAIL_INCLUDE,
      });
      return ok(rowToDetail(row as DetailRow));
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async update(
    id: string,
    fields: RoleUpdateInput
  ): Promise<Result<RoleManagementDetail, RoleManagementStoreError>> {
    try {
      const row = await this.prisma.role.update({
        where: { id },
        data: fields,
        include: DETAIL_INCLUDE,
      });
      return ok(rowToDetail(row as DetailRow));
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async replacePermissions(
    id: string,
    permissions: string[]
  ): Promise<Result<RoleManagementDetail, RoleManagementStoreError>> {
    try {
      await this.prisma.rolePermission.deleteMany({ where: { roleId: id } });
      await this.prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: id, permission: p })),
      });
      const row = await this.prisma.role.findUnique({
        where: { id },
        include: DETAIL_INCLUDE,
      });
      if (!row) return err("DATABASE_ERROR");
      return ok(rowToDetail(row as DetailRow));
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async delete(id: string): Promise<Result<void, RoleManagementStoreError>> {
    try {
      await this.prisma.role.delete({ where: { id } });
      return ok(undefined);
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
