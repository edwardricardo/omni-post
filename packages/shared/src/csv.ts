/**
 * @file csv.ts
 * @description RFC 4180 compliant CSV export utility providing type-safe generation, nested
 *              field access, custom formatters, and CSV-injection prevention. Pure, dependency-free
 *              and browser-safe — shared across the API, workers and frontend.
 * @layer domain
 */
/**
 * RFC 4180 Compliant CSV Export Utility
 *
 * Provides type-safe CSV generation with proper escaping and formatting.
 *
 * Features:
 * - RFC 4180 compliance (CRLF line endings, proper quoting)
 * - CSV injection prevention (leading =, +, -, @, \t, \r)
 * - Type-safe column definitions with generics
 * - Nested field access (e.g., 'user.email')
 * - Custom formatters for complex data types
 * - Configurable options (header inclusion, line endings, quote behavior)
 *
 * Security:
 * - Prevents CSV injection attacks by prefixing dangerous characters with '
 * - Escapes quotes by doubling ("" → """")
 * - Properly quotes fields containing: comma, quote, CR, LF
 *
 * @example
 * ```typescript
 * interface User {
 *   id: string;
 *   email: string;
 *   createdAt: Date;
 * }
 *
 * const csv = exportToCSV(users, [
 *   { key: 'id', header: 'User ID' },
 *   { key: 'email', header: 'Email Address' },
 *   { key: 'createdAt', header: 'Created', format: (date) => date.toISOString() }
 * ]);
 * ```
 */

/**
 * Column definition for CSV export
 */
export interface ColumnDefinition<T> {
  /** Key to access data (supports nested fields like 'user.email') */
  key: keyof T | string;
  /** Column header text */
  header: string;
  /** Optional custom formatter for complex data types */
  format?: (value: unknown, row: T) => string;
}

/**
 * CSV export options
 */
export interface CSVExportOptions {
  /** Include header row (default: true) */
  includeHeader?: boolean;
  /** Line ending style (default: 'CRLF' per RFC 4180) */
  lineEnding?: "CRLF" | "LF";
  /** Quote all fields regardless of content (default: false) */
  quoteAll?: boolean;
  /** Prevent CSV injection attacks (default: true) */
  preventInjection?: boolean;
}

/**
 * CSV injection prevention: characters that can execute formulas in
 * Excel/Sheets/LibreOffice. Includes ASCII formula triggers, line/tab
 * control characters, and full-width Unicode CJK variants which render
 * identically and are also interpreted as formulas in CJK locales.
 */
const CSV_INJECTION_PREFIXES = ["=", "+", "-", "@", "\t", "\r", "\n", "＝", "＋", "－", "＠"];

/**
 * Characters that require field quoting per RFC 4180
 */
const QUOTE_REQUIRED_CHARS = [",", '"', "\r", "\n"];

/**
 * Export data to RFC 4180 compliant CSV format
 *
 * @param data - Array of objects to export
 * @param columns - Column definitions with headers and formatters
 * @param options - CSV formatting options
 * @returns CSV string with proper escaping and formatting
 *
 * @example
 * ```typescript
 * const subscriptions = [
 *   { id: '123', email: 'user@example.com', plan: 'PRO' },
 *   { id: '456', email: 'admin@test.com', plan: 'ENTERPRISE' }
 * ];
 *
 * const csv = exportToCSV(subscriptions, [
 *   { key: 'id', header: 'Subscription ID' },
 *   { key: 'email', header: 'Email' },
 *   { key: 'plan', header: 'Plan' }
 * ]);
 * ```
 */
export function exportToCSV<T>(
  data: T[],
  columns: ColumnDefinition<T>[],
  options: CSVExportOptions = {}
): string {
  const {
    includeHeader = true,
    lineEnding = "CRLF",
    quoteAll = false,
    preventInjection = true,
  } = options;

  const lineEndingChar = lineEnding === "CRLF" ? "\r\n" : "\n";
  const rows: string[] = [];

  // Generate header row
  if (includeHeader) {
    const headerRow = columns
      .map((col) => escapeCSVField(col.header, quoteAll, preventInjection))
      .join(",");
    rows.push(headerRow);
  }

  // Generate data rows
  for (const row of data) {
    const csvRow = columns
      .map((col) => {
        const value = extractFieldValue(row, col.key as string);
        const formatted = col.format ? col.format(value, row) : String(value);
        return escapeCSVField(formatted, quoteAll, preventInjection);
      })
      .join(",");
    rows.push(csvRow);
  }

  return rows.join(lineEndingChar);
}

/**
 * Escape and quote a CSV field per RFC 4180
 *
 * Rules:
 * 1. Quote fields containing: comma, quote, CR, LF
 * 2. Escape quotes by doubling: " → ""
 * 3. Prevent CSV injection by prefixing dangerous characters with '
 *
 * @param field - Raw field value
 * @param quoteAll - Force quote all fields
 * @param preventInjection - Prevent CSV injection attacks
 * @returns Escaped and quoted field
 */
function escapeCSVField(field: string, quoteAll: boolean, preventInjection: boolean): string {
  let escaped = field;

  // CSV injection prevention
  if (preventInjection && field.length > 0) {
    const firstChar = field.charAt(0);
    if (CSV_INJECTION_PREFIXES.includes(firstChar)) {
      // Prefix dangerous characters with single quote to prevent formula execution
      escaped = "'" + field;
    }
  }

  // Check if quoting is required
  const needsQuoting = quoteAll || QUOTE_REQUIRED_CHARS.some((char) => escaped.includes(char));

  if (needsQuoting) {
    // Escape quotes by doubling them
    escaped = escaped.replace(/"/g, '""');
    // Wrap in quotes
    return `"${escaped}"`;
  }

  return escaped;
}

/**
 * Extract field value from object, supporting nested paths
 *
 * Supports:
 * - Direct fields: 'email'
 * - Nested fields: 'user.email'
 * - Array indices: 'users[0].name' (not implemented, returns undefined)
 *
 * @param obj - Source object
 * @param path - Field path (supports dot notation)
 * @returns Field value or undefined
 */
function extractFieldValue(obj: unknown, path: string): unknown {
  if (!path || !obj) {
    return undefined;
  }

  // Handle nested paths like 'user.email'
  const keys = path.split(".");
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

/**
 * Generate CSV filename with timestamp
 *
 * @param baseName - Base filename (e.g., 'subscriptions')
 * @param extension - File extension (default: 'csv')
 * @returns Filename with ISO timestamp
 *
 * @example
 * ```typescript
 * generateCSVFilename('audit-log'); // 'audit-log-2025-09-30T12-30-45.csv'
 * ```
 */
export function generateCSVFilename(baseName: string, extension: string = "csv"): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-") // Replace colons for Windows compatibility
    .replace(/\.\d+Z$/, ""); // Remove milliseconds and Z
  return `${baseName}-${timestamp}.${extension}`;
}
