/**
 * @file PrismaCustomerRoleRepository.ts
 * @description Infrastructure adapter implementing CustomerRoleRepository using
 *   Prisma. Reads CustomerRole + CustomerRolePermission rows and assembles
 *   denormalised snapshots consumed by CustomerUser-mutating use cases.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import { type Result, ok, err } from "@shared/types";
import type {
  CustomerRoleRepository,
  CustomerRoleSnapshot,
} from "../../domain/repositories/CustomerRoleRepository.js";
import { EntityNotFoundError, type DomainError } from "../../domain/errors/index.js";

const ROLE_INCLUDE = { permissions: true } as const;

interface PrismaCustomerRoleRow {
  id: string;
  name: string;
  level: number;
  isActive: boolean;
  permissions: { permission: string }[];
}

export class PrismaCustomerRoleRepository implements CustomerRoleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getSnapshotById(roleId: string): Promise<Result<CustomerRoleSnapshot, DomainError>> {
    try {
      const row = await this.prisma.customerRole.findUnique({
        where: { id: roleId },
        include: ROLE_INCLUDE,
      });
      if (!row) return err(new EntityNotFoundError("CustomerRole", roleId));
      return ok(this.toSnapshot(row as unknown as PrismaCustomerRoleRow));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "CustomerRole",
          `${roleId} (query failed: ${error instanceof Error ? error.message : String(error)})`
        )
      );
    }
  }

  async getSnapshotByName(roleName: string): Promise<Result<CustomerRoleSnapshot, DomainError>> {
    try {
      const row = await this.prisma.customerRole.findUnique({
        where: { name: roleName },
        include: ROLE_INCLUDE,
      });
      if (!row) return err(new EntityNotFoundError("CustomerRole", `name:${roleName}`));
      return ok(this.toSnapshot(row as unknown as PrismaCustomerRoleRow));
    } catch (error: unknown) {
      return err(
        new EntityNotFoundError(
          "CustomerRole",
          `name:${roleName} (query failed: ${error instanceof Error ? error.message : String(error)})`
        )
      );
    }
  }

  async listAll(): Promise<CustomerRoleSnapshot[]> {
    const rows = await this.prisma.customerRole.findMany({
      where: { isActive: true },
      include: ROLE_INCLUDE,
      orderBy: { level: "desc" },
    });
    return rows.map((r) => this.toSnapshot(r as unknown as PrismaCustomerRoleRow));
  }

  private toSnapshot(row: PrismaCustomerRoleRow): CustomerRoleSnapshot {
    return {
      roleId: row.id,
      roleName: row.name,
      roleLevel: row.level,
      permissions: new Set(row.permissions.map((p) => p.permission)),
    };
  }
}
