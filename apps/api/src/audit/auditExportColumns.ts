/**
 * @file auditExportColumns.ts
 * @description RFC 4180 column table for the audit-log CSV export. Lives beside
 *              the route (not inside it) so the emitted bytes can be asserted
 *              directly against the real CSV writer.
 *
 *              Actor contract: `"User Email"` keeps its pre-change position and
 *              value, so an ADMIN row exports exactly as it did before. That
 *              column resolves the AdminUser FK, so it is blank on CUSTOMER and
 *              SYSTEM rows; their identity is carried by the two appended
 *              columns — `"Actor Type"` and `"Customer Email"` — which are in
 *              turn blank on ADMIN rows.
 * @layer infrastructure
 */

import type { ColumnDefinition } from "@packages/api-common";
import type { AuditLogEntry } from "./auditService.js";

/**
 * @function formatOptionalCell
 * @description Renders an absent relation value as an empty cell. `exportToCSV`
 *   stringifies whatever a column key resolves to, so an unformatted relation
 *   column emits the literal text `"undefined"` whenever the relation is not
 *   loaded — a fabricated value inside an immutable audit artifact. Formatting
 *   is a no-op when the value is present, so a resolved actor email exports
 *   exactly as it did before.
 * @param value - Raw value resolved from the column key
 * @returns The stringified value, or an empty string when absent
 */
const formatOptionalCell = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value);

/**
 * @const AUDIT_EXPORT_COLUMNS
 * @description Columns emitted by `GET /admin/audit/export?format=csv`. Order
 *   is part of the contract: the first nine columns are the pre-change set and
 *   MUST stay in place; new actor columns append at the end.
 */
export const AUDIT_EXPORT_COLUMNS: ColumnDefinition<AuditLogEntry>[] = [
  {
    key: "createdAt",
    header: "Timestamp",
    format: (date) => (date instanceof Date ? date.toISOString() : String(date)),
  },
  // The AdminUser relation is absent on a CUSTOMER row and null on a SYSTEM
  // row. Blank-cell formatting leaves an ADMIN row's bytes untouched (the
  // relation always resolves there) while keeping the fabricated "undefined"
  // string out of the two actor classes this export now surfaces.
  { key: "user.email", header: "User Email", format: formatOptionalCell },
  { key: "action", header: "Action" },
  { key: "resource", header: "Resource" },
  { key: "resourceId", header: "Resource ID" },
  { key: "success", header: "Success", format: (val) => String(val) },
  { key: "ipAddress", header: "IP Address" },
  { key: "userAgent", header: "User Agent" },
  { key: "error", header: "Error" },
  { key: "actorType", header: "Actor Type" },
  {
    key: "customerUser.email",
    header: "Customer Email",
    format: formatOptionalCell,
  },
];
