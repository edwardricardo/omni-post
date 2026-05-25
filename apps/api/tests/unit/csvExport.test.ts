/**
 * Unit tests for CSV Export Utility
 *
 * Tests:
 * - RFC 4180 compliance (CRLF, quoting, escaping)
 * - CSV injection prevention
 * - Nested field access
 * - Custom formatters
 * - Header generation
 * - Edge cases (empty data, special characters)
 *
 * @file csvExport.test.ts
 * @description Tests for CSV Export - Basic Functionality
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { exportToCSV, generateCSVFilename, type ColumnDefinition } from "@shared/types";

describe("CSV Export - Basic Functionality", { concurrency: 1 }, () => {
  interface TestData {
    id: string;
    name: string;
    email: string;
  }

  const testData: TestData[] = [
    { id: "1", name: "John Doe", email: "john@example.com" },
    { id: "2", name: "Jane Smith", email: "jane@example.com" },
  ];

  it("should generate CSV with header", () => {
    const columns: ColumnDefinition<TestData>[] = [
      { key: "id", header: "ID" },
      { key: "name", header: "Name" },
      { key: "email", header: "Email" },
    ];

    const csv = exportToCSV(testData, columns);

    expect(csv).toContain("ID,Name,Email");
    expect(csv).toContain("1,John Doe,john@example.com");
    expect(csv).toContain("2,Jane Smith,jane@example.com");
  });

  it("should generate CSV without header when disabled", () => {
    const columns: ColumnDefinition<TestData>[] = [
      { key: "id", header: "ID" },
      { key: "name", header: "Name" },
    ];

    const csv = exportToCSV(testData, columns, { includeHeader: false });

    expect(csv).not.toContain("ID,Name");
    expect(csv).toContain("1,John Doe");
  });

  it("should use CRLF line endings by default (RFC 4180)", () => {
    const columns: ColumnDefinition<TestData>[] = [{ key: "id", header: "ID" }];

    const csv = exportToCSV(testData, columns);

    expect(csv).toContain("\r\n");
  });

  it("should use LF line endings when specified", () => {
    const columns: ColumnDefinition<TestData>[] = [{ key: "id", header: "ID" }];

    const csv = exportToCSV(testData, columns, { lineEnding: "LF" });

    expect(csv).not.toContain("\r\n");
    expect(csv).toContain("\n");
  });
});

describe("CSV Export - RFC 4180 Quoting", { concurrency: 1 }, () => {
  interface TestData {
    text: string;
  }

  it("should quote fields containing commas", () => {
    const data: TestData[] = [{ text: "Smith, John" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "text", header: "Text" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain('"Smith, John"');
  });

  it("should quote fields containing double quotes", () => {
    const data: TestData[] = [{ text: 'He said "Hello"' }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "text", header: "Text" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain('"He said ""Hello"""');
  });

  it("should quote fields containing line breaks", () => {
    const data: TestData[] = [{ text: "Line 1\nLine 2" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "text", header: "Text" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain('"Line 1\nLine 2"');
  });

  it("should quote fields containing CR", () => {
    const data: TestData[] = [{ text: "Text\rWith\rCR" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "text", header: "Text" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toMatch(/"Text\rWith\rCR"/);
  });

  it("should quote all fields when quoteAll is enabled", () => {
    const data: TestData[] = [{ text: "simple" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "text", header: "Text" }];

    const csv = exportToCSV(data, columns, { quoteAll: true });

    expect(csv).toContain('"Text"');
    expect(csv).toContain('"simple"');
  });

  it("should not quote simple fields by default", () => {
    const data: TestData[] = [{ text: "simple" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "text", header: "Text" }];

    const csv = exportToCSV(data, columns);

    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("simple"); // No quotes
  });
});

describe("CSV Export - CSV Injection Prevention", { concurrency: 1 }, () => {
  interface TestData {
    formula: string;
  }

  it("should prevent formula injection with = prefix", () => {
    const data: TestData[] = [{ formula: "=1+1" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain("'=1+1");
  });

  it("should prevent formula injection with + prefix", () => {
    const data: TestData[] = [{ formula: "+1234" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain("'+1234");
  });

  it("should prevent formula injection with - prefix", () => {
    const data: TestData[] = [{ formula: "-5678" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain("'-5678");
  });

  it("should prevent formula injection with @ prefix", () => {
    const data: TestData[] = [{ formula: "@SUM(A1:A10)" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain("'@SUM(A1:A10)");
  });

  it("should prevent formula injection with tab prefix", () => {
    const data: TestData[] = [{ formula: "\tformula" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain("'\tformula");
  });

  it("should prevent formula injection with newline (LF) prefix", () => {
    const data: TestData[] = [{ formula: "\n=1+1" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    // Field with leading LF gets prefixed with `'` and quoted (LF requires quoting per RFC 4180)
    expect(csv).toContain("'\n=1+1");
  });

  it("should prevent formula injection with full-width equals (＝) prefix", () => {
    const data: TestData[] = [{ formula: "＝SUM(A1:A10)" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain("'＝SUM(A1:A10)");
  });

  it("should prevent formula injection with full-width plus (＋) prefix", () => {
    const data: TestData[] = [{ formula: "＋1234" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain("'＋1234");
  });

  it("should prevent formula injection with full-width minus (－) prefix", () => {
    const data: TestData[] = [{ formula: "－5678" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain("'－5678");
  });

  it("should prevent formula injection with full-width at-sign (＠) prefix", () => {
    const data: TestData[] = [{ formula: "＠HYPERLINK" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain("'＠HYPERLINK");
  });

  it("should allow disabling injection prevention", () => {
    const data: TestData[] = [{ formula: "=1+1" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns, { preventInjection: false });

    expect(csv).toContain("=1+1");
    expect(csv).not.toContain("'=1+1");
  });

  it("should not affect normal strings starting with safe characters", () => {
    const data: TestData[] = [{ formula: "Hello World" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain("Hello World");
    expect(csv).not.toContain("'Hello World");
  });
});

describe("CSV Export - Nested Field Access", { concurrency: 1 }, () => {
  interface TestData {
    user: {
      id: string;
      email: string;
      profile: {
        name: string;
      };
    };
  }

  const nestedData: TestData[] = [
    {
      user: {
        id: "123",
        email: "user@example.com",
        profile: {
          name: "John Doe",
        },
      },
    },
  ];

  it("should access nested fields with dot notation", () => {
    const columns: ColumnDefinition<TestData>[] = [
      { key: "user.id", header: "User ID" },
      { key: "user.email", header: "Email" },
    ];

    const csv = exportToCSV(nestedData, columns);

    expect(csv).toContain("123");
    expect(csv).toContain("user@example.com");
  });

  it("should access deeply nested fields", () => {
    const columns: ColumnDefinition<TestData>[] = [{ key: "user.profile.name", header: "Name" }];

    const csv = exportToCSV(nestedData, columns);

    expect(csv).toContain("John Doe");
  });

  it("should handle missing nested fields gracefully", () => {
    const columns: ColumnDefinition<TestData>[] = [
      { key: "user.missing.field", header: "Missing" },
    ];

    const csv = exportToCSV(nestedData, columns);

    expect(csv).toContain("undefined");
  });
});

describe("CSV Export - Custom Formatters", { concurrency: 1 }, () => {
  interface TestData {
    date: Date;
    amount: number;
    status: "active" | "inactive";
  }

  const formatterData: TestData[] = [
    {
      date: new Date("2025-09-30T12:00:00Z"),
      amount: 1234.56,
      status: "active",
    },
  ];

  it("should format dates with custom formatter", () => {
    const columns: ColumnDefinition<TestData>[] = [
      {
        key: "date",
        header: "Date",
        format: (date: Date) => date.toISOString().split("T")[0] ?? "",
      },
    ];

    const csv = exportToCSV(formatterData, columns);

    expect(csv).toContain("2025-09-30");
  });

  it("should format numbers with custom formatter", () => {
    const columns: ColumnDefinition<TestData>[] = [
      {
        key: "amount",
        header: "Amount",
        format: (amount: number) => `$${amount.toFixed(2)}`,
      },
    ];

    const csv = exportToCSV(formatterData, columns);

    expect(csv).toContain("$1234.56");
  });

  it("should format enums with custom formatter", () => {
    const columns: ColumnDefinition<TestData>[] = [
      {
        key: "status",
        header: "Status",
        format: (status: string) => status.toUpperCase(),
      },
    ];

    const csv = exportToCSV(formatterData, columns);

    expect(csv).toContain("ACTIVE");
  });

  it("should provide row context to formatter", () => {
    const columns: ColumnDefinition<TestData>[] = [
      {
        key: "amount",
        header: "Display",
        format: (amount: number, row: TestData) => `${row.status}: $${amount.toFixed(2)}`,
      },
    ];

    const csv = exportToCSV(formatterData, columns);

    expect(csv).toContain("active: $1234.56");
  });
});

describe("CSV Export - Edge Cases", { concurrency: 1 }, () => {
  interface TestData {
    value: string;
  }

  it("should handle empty data array", () => {
    const data: TestData[] = [];
    const columns: ColumnDefinition<TestData>[] = [{ key: "value", header: "Value" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toBe("Value"); // Only header
  });

  it("should handle empty strings", () => {
    const data: TestData[] = [{ value: "" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "value", header: "Value" }];

    const csv = exportToCSV(data, columns);

    const lines = csv.split("\r\n");
    expect(lines[1]).toBe(""); // Empty value
  });

  it("should handle null values", () => {
    const data = [{ value: null }];
    const columns: ColumnDefinition<any>[] = [{ key: "value", header: "Value" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain("null");
  });

  it("should handle undefined values", () => {
    const data = [{ value: undefined }];
    const columns: ColumnDefinition<any>[] = [{ key: "value", header: "Value" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain("undefined");
  });

  it("should handle unicode characters", () => {
    const data: TestData[] = [{ value: "Hello 🚀 世界" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "value", header: "Value" }];

    const csv = exportToCSV(data, columns);

    expect(csv).toContain("Hello 🚀 世界");
  });

  it("should handle large datasets efficiently", () => {
    const largeData = Array.from({ length: 10000 }, (_, i) => ({
      id: `${i}`,
      value: `value-${i}`,
    }));

    const columns: ColumnDefinition<any>[] = [
      { key: "id", header: "ID" },
      { key: "value", header: "Value" },
    ];

    const start = Date.now();
    const csv = exportToCSV(largeData, columns);
    const duration = Date.now() - start;

    expect(csv).toContain("9999,value-9999");
    expect(duration).toBeLessThan(1000);
  });
});

describe("CSV Export - Filename Generation", { concurrency: 1 }, () => {
  it("should generate filename with timestamp", () => {
    const filename = generateCSVFilename("export");

    expect(filename).toMatch(/^export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/);
  });

  it("should support custom extension", () => {
    const filename = generateCSVFilename("report", "txt");

    expect(filename).toMatch(/\.txt$/);
  });

  it("should handle special characters in base name", () => {
    const filename = generateCSVFilename("audit-log-2025");

    expect(filename).toContain("audit-log-2025");
  });
});

describe("CSV Export - Complex Real-World Scenarios", { concurrency: 1 }, () => {
  it("should handle subscription export with all features", () => {
    interface Subscription {
      id: string;
      email: string;
      name: string;
      plan: string;
      revenue: number;
      createdAt: Date;
      metadata: {
        source: string;
      };
    }

    const subscriptions: Subscription[] = [
      {
        id: "sub-123",
        email: "user@example.com",
        name: 'Smith, John "Jr."', // Comma and quotes
        plan: "=PRO", // CSV injection attempt
        revenue: 99.99,
        createdAt: new Date("2025-01-15T10:30:00Z"),
        metadata: { source: "web" },
      },
    ];

    const columns: ColumnDefinition<Subscription>[] = [
      { key: "id", header: "ID" },
      { key: "email", header: "Email" },
      { key: "name", header: "Name" },
      { key: "plan", header: "Plan" },
      {
        key: "revenue",
        header: "Revenue",
        format: (amount) => `$${amount.toFixed(2)}`,
      },
      {
        key: "createdAt",
        header: "Created",
        format: (date) => date.toISOString(),
      },
      { key: "metadata.source", header: "Source" },
    ];

    const csv = exportToCSV(subscriptions, columns);

    expect(csv).toContain("sub-123");
    expect(csv).toContain('"Smith, John ""Jr."""');
    expect(csv).toContain("'=PRO");
    expect(csv).toContain("$99.99");
    expect(csv).toContain("2025-01-15T10:30:00.000Z");
    expect(csv).toContain("web");
  });
});
