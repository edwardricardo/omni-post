/**
 * @file auditExportColumns.test.ts
 * @description Unit tests for the audit-log CSV export columns. Exercises the
 *              REAL `exportToCSV` writer against the production column table,
 *              so the assertions are on emitted CSV bytes — not on a mock.
 *              Guards the two halves of the export contract: a CUSTOMER-actor
 *              row carries its actor identity, and an ADMIN-actor row's actor
 *              column stays byte-identical to the pre-change export.
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { exportToCSV, type ColumnDefinition } from "@packages/api-common";
import { AUDIT_EXPORT_COLUMNS } from "../../../src/audit/auditExportColumns.js";
import type { AuditLogEntry } from "../../../src/audit/auditService.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The export columns as they were BEFORE this change — the approval baseline.
 * The admin row emitted through these columns must remain a byte-identical
 * PREFIX of the row emitted through `AUDIT_EXPORT_COLUMNS`.
 */
const LEGACY_COLUMNS: ColumnDefinition<AuditLogEntry>[] = [
  {
    key: "createdAt",
    header: "Timestamp",
    format: (date) => (date instanceof Date ? date.toISOString() : String(date)),
  },
  { key: "user.email", header: "User Email" },
  { key: "action", header: "Action" },
  { key: "resource", header: "Resource" },
  { key: "resourceId", header: "Resource ID" },
  { key: "success", header: "Success", format: (val) => String(val) },
  { key: "ipAddress", header: "IP Address" },
  { key: "userAgent", header: "User Agent" },
  { key: "error", header: "Error" },
];

const CREATED_AT = new Date("2026-07-01T10:00:00.000Z");

const ADMIN_ROW = {
  id: "log-csv-admin",
  userId: "admin-1",
  customerUserId: null,
  actorType: "ADMIN",
  action: "LOGIN",
  resource: "Session",
  resourceId: "session-1",
  success: true,
  createdAt: CREATED_AT,
  ipAddress: "127.0.0.1",
  userAgent: "test-agent",
  user: { id: "admin-1", email: "admin@example.com", name: "Admin One", role: "ADMIN" },
  customerUser: null,
} as unknown as AuditLogEntry;

const CUSTOMER_ROW = {
  id: "log-csv-customer",
  customerUserId: "customer-1",
  actorType: "CUSTOMER",
  action: "MFA_ENABLED",
  resource: "CustomerUser",
  resourceId: "customer-1",
  success: true,
  createdAt: CREATED_AT,
  ipAddress: "10.0.0.9",
  userAgent: "test-agent",
  customerUser: {
    id: "customer-1",
    email: "customer@example.com",
    firstName: "Cust",
    lastName: "Omer",
  },
} as unknown as AuditLogEntry;

/** SYSTEM actor: both actor FKs are null, so neither identity relation resolves. */
const SYSTEM_ROW = {
  id: "log-csv-system",
  userId: null,
  customerUserId: null,
  actorType: "SYSTEM",
  action: "TOKEN_CLEANUP",
  resource: "Session",
  resourceId: "session-9",
  success: true,
  createdAt: CREATED_AT,
  ipAddress: "127.0.0.1",
  userAgent: "system",
  user: null,
  customerUser: null,
} as unknown as AuditLogEntry;

function lines(csv: string): string[] {
  return csv.split("\r\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AUDIT_EXPORT_COLUMNS", () => {
  it("appends the actor columns after the pre-change column set", () => {
    expect(AUDIT_EXPORT_COLUMNS.map((c) => c.header)).toEqual([
      "Timestamp",
      "User Email",
      "Action",
      "Resource",
      "Resource ID",
      "Success",
      "IP Address",
      "User Agent",
      "Error",
      "Actor Type",
      "Customer Email",
    ]);
  });

  it("exports a customer row with a non-blank actor identity", () => {
    const csv = exportToCSV([CUSTOMER_ROW], AUDIT_EXPORT_COLUMNS, {
      preventInjection: true,
      lineEnding: "CRLF",
    });

    const [, dataLine] = lines(csv);
    const cells = dataLine!.split(",");

    expect(cells[9]).toBe("CUSTOMER");
    expect(cells[10]).toBe("customer@example.com");
    // The legacy actor column resolves the AdminUser relation, so it can never
    // carry a customer identity — which is exactly why the customer needs a
    // column of its own.
    expect(cells[1]).not.toContain("customer@example.com");
  });

  it("keeps the admin actor row byte-identical to the pre-change export", () => {
    const legacyCsv = exportToCSV([ADMIN_ROW], LEGACY_COLUMNS, {
      preventInjection: true,
      lineEnding: "CRLF",
    });
    const currentCsv = exportToCSV([ADMIN_ROW], AUDIT_EXPORT_COLUMNS, {
      preventInjection: true,
      lineEnding: "CRLF",
    });

    const [legacyHeader, legacyRow] = lines(legacyCsv);
    const [currentHeader, currentRow] = lines(currentCsv);

    expect(currentHeader!.startsWith(`${legacyHeader!},`)).toBe(true);
    expect(currentRow!.startsWith(`${legacyRow!},`)).toBe(true);
    expect(currentRow!.split(",")[1]).toBe("admin@example.com");
    expect(currentRow!.split(",")[9]).toBe("ADMIN");
  });

  it("leaves the customer column blank for an admin row", () => {
    const csv = exportToCSV([ADMIN_ROW], AUDIT_EXPORT_COLUMNS, {
      preventInjection: true,
      lineEnding: "CRLF",
    });

    const cells = lines(csv)[1]!.split(",");
    expect(cells[10]).toBe("");
  });

  // The "User Email" column resolves the AdminUser relation, which is absent on
  // a CUSTOMER row and null on a SYSTEM row. An unformatted column stringifies
  // that absence, so the cell would read as the literal text "undefined" — a
  // fabricated value inside an audit artifact. An absent actor email must be an
  // empty cell.
  it("renders an empty User Email cell for a customer row", () => {
    const csv = exportToCSV([CUSTOMER_ROW], AUDIT_EXPORT_COLUMNS, {
      preventInjection: true,
      lineEnding: "CRLF",
    });

    const cells = lines(csv)[1]!.split(",");
    expect(cells[1]).toBe("");
    expect(cells[1]).not.toBe("undefined");
  });

  it("renders an empty User Email cell for a system row", () => {
    const csv = exportToCSV([SYSTEM_ROW], AUDIT_EXPORT_COLUMNS, {
      preventInjection: true,
      lineEnding: "CRLF",
    });

    const cells = lines(csv)[1]!.split(",");
    expect(cells[1]).toBe("");
    expect(cells[1]).not.toBe("undefined");
  });

  // The three actor columns must never fabricate a value. The six legacy
  // columns that stringify an absent optional (e.g. "Error") are deliberately
  // NOT covered here: their bytes are frozen by the admin-export parity
  // guarantee, so changing them is a separate, spec-visible decision.
  it("never fabricates a value in an actor column, for any actor type", () => {
    const csv = exportToCSV([ADMIN_ROW, CUSTOMER_ROW, SYSTEM_ROW], AUDIT_EXPORT_COLUMNS, {
      preventInjection: true,
      lineEnding: "CRLF",
    });

    const ACTOR_COLUMN_INDICES = [1, 9, 10]; // User Email, Actor Type, Customer Email

    for (const dataLine of lines(csv).slice(1)) {
      const cells = dataLine.split(",");
      for (const index of ACTOR_COLUMN_INDICES) {
        expect(cells[index]).not.toBe("undefined");
        expect(cells[index]).not.toBe("null");
      }
    }
  });

  it("keeps the admin User Email cell byte-identical once the column is formatted", () => {
    const legacyCsv = exportToCSV([ADMIN_ROW], LEGACY_COLUMNS, {
      preventInjection: true,
      lineEnding: "CRLF",
    });
    const currentCsv = exportToCSV([ADMIN_ROW], AUDIT_EXPORT_COLUMNS, {
      preventInjection: true,
      lineEnding: "CRLF",
    });

    // The blank-cell formatter is a no-op when the relation resolves, which is
    // always the case for an ADMIN row: the admin export stays frozen.
    expect(lines(currentCsv)[1]!.split(",")[1]).toBe(lines(legacyCsv)[1]!.split(",")[1]);
    expect(lines(currentCsv)[1]!.startsWith(`${lines(legacyCsv)[1]!},`)).toBe(true);
  });
});
