/**
 * @file PrismaGatewaySwitchEventRepository.ts
 * @description Prisma adapter implementing `GatewaySwitchEventRepository`.
 *   Persists `GatewaySwitchEvent` rows and joins to `Account` when admin
 *   list/detail endpoints request the enriched projection.
 * @layer infrastructure
 */
import { ok, err, type Result } from "@shared/types";
import { Prisma, type PrismaClient } from "@infra/prisma";
import type {
  GatewaySwitchEventFields,
  GatewaySwitchEventRepository,
  GatewaySwitchEventWithAccount,
  SwitchEventCounts,
  SwitchEventCreate,
  SwitchEventListFilters,
  SwitchEventStoreError,
  SwitchEventUpdate,
  SwitchStatus,
} from "@core/domain/repositories/GatewaySwitchEventRepository.js";
import type { AccountGatewayProvider } from "@core/domain/repositories/AccountBillingRepository.js";

const SWITCH_EVENT_SELECT = {
  id: true,
  accountId: true,
  fromGateway: true,
  toGateway: true,
  scheduledFor: true,
  extendedUntil: true,
  extendedBy: true,
  status: true,
  completedAt: true,
  cancelledAt: true,
  suspendedAt: true,
  reminderSentAt: true,
  createdAt: true,
} as const;

type SwitchEventRow = {
  id: string;
  accountId: string;
  fromGateway: AccountGatewayProvider;
  toGateway: AccountGatewayProvider;
  scheduledFor: Date;
  extendedUntil: Date | null;
  extendedBy: string | null;
  status: SwitchStatus;
  completedAt: Date | null;
  cancelledAt: Date | null;
  suspendedAt: Date | null;
  reminderSentAt: Date | null;
  createdAt: Date;
};

type SwitchEventWithAccountRow = SwitchEventRow & {
  account: { id: string; name: string; email: string | null };
};

function rowToFields(row: SwitchEventRow): GatewaySwitchEventFields {
  return {
    id: row.id,
    accountId: row.accountId,
    fromGateway: row.fromGateway,
    toGateway: row.toGateway,
    scheduledFor: row.scheduledFor,
    extendedUntil: row.extendedUntil,
    extendedBy: row.extendedBy,
    status: row.status,
    completedAt: row.completedAt,
    cancelledAt: row.cancelledAt,
    suspendedAt: row.suspendedAt,
    reminderSentAt: row.reminderSentAt,
    createdAt: row.createdAt,
  };
}

function rowToFieldsWithAccount(row: SwitchEventWithAccountRow): GatewaySwitchEventWithAccount {
  return {
    ...rowToFields(row),
    account: row.account,
  };
}

export class PrismaGatewaySwitchEventRepository implements GatewaySwitchEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: SwitchEventCreate
  ): Promise<Result<GatewaySwitchEventFields, SwitchEventStoreError>> {
    try {
      const row = await this.prisma.gatewaySwitchEvent.create({
        data: input,
        select: SWITCH_EVENT_SELECT,
      });
      return ok(rowToFields(row as SwitchEventRow));
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async findById(
    id: string
  ): Promise<Result<GatewaySwitchEventFields | null, SwitchEventStoreError>> {
    try {
      const row = await this.prisma.gatewaySwitchEvent.findUnique({
        where: { id },
        select: SWITCH_EVENT_SELECT,
      });
      return ok(row ? rowToFields(row as SwitchEventRow) : null);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async findLatestByAccountAndStatus(
    accountId: string,
    statusIn: readonly SwitchStatus[]
  ): Promise<Result<GatewaySwitchEventFields | null, SwitchEventStoreError>> {
    if (statusIn.length === 0) return ok(null);
    try {
      const statusFilter =
        statusIn.length === 1 ? (statusIn[0] as SwitchStatus) : { in: [...statusIn] };
      const row = await this.prisma.gatewaySwitchEvent.findFirst({
        where: { accountId, status: statusFilter },
        orderBy: { createdAt: "desc" },
        select: SWITCH_EVENT_SELECT,
      });
      return ok(row ? rowToFields(row as SwitchEventRow) : null);
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async update(
    id: string,
    fields: SwitchEventUpdate
  ): Promise<Result<void, SwitchEventStoreError>> {
    try {
      await this.prisma.gatewaySwitchEvent.update({
        where: { id },
        data: fields,
      });
      return ok(undefined);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        return err("NOT_FOUND");
      }
      return err("DATABASE_ERROR");
    }
  }

  async listWithAccount(
    filters: SwitchEventListFilters
  ): Promise<
    Result<
      { events: GatewaySwitchEventWithAccount[]; counts: SwitchEventCounts },
      SwitchEventStoreError
    >
  > {
    try {
      const where = filters.status ? { status: filters.status } : {};
      const offset = (filters.page - 1) * filters.limit;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [events, total, scheduled, pendingCheckout, suspended, completed30d] =
        await Promise.all([
          this.prisma.gatewaySwitchEvent.findMany({
            where,
            include: {
              account: { select: { id: true, name: true, email: true } },
            },
            orderBy: { createdAt: "desc" },
            skip: offset,
            take: filters.limit,
          }),
          this.prisma.gatewaySwitchEvent.count({ where }),
          this.prisma.gatewaySwitchEvent.count({ where: { status: "SCHEDULED" } }),
          this.prisma.gatewaySwitchEvent.count({ where: { status: "PENDING_CHECKOUT" } }),
          this.prisma.gatewaySwitchEvent.count({ where: { status: "SUSPENDED" } }),
          this.prisma.gatewaySwitchEvent.count({
            where: { status: "COMPLETED", completedAt: { gte: thirtyDaysAgo } },
          }),
        ]);

      return ok({
        events: events.map((e) => rowToFieldsWithAccount(e as SwitchEventWithAccountRow)),
        counts: { total, scheduled, pendingCheckout, suspended, completed30d },
      });
    } catch {
      return err("DATABASE_ERROR");
    }
  }

  async findByIdWithAccount(
    id: string
  ): Promise<Result<GatewaySwitchEventWithAccount | null, SwitchEventStoreError>> {
    try {
      const row = await this.prisma.gatewaySwitchEvent.findUnique({
        where: { id },
        include: {
          account: { select: { id: true, name: true, email: true } },
        },
      });
      return ok(row ? rowToFieldsWithAccount(row as SwitchEventWithAccountRow) : null);
    } catch {
      return err("DATABASE_ERROR");
    }
  }
}
