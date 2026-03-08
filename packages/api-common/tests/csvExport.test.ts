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
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exportToCSV, generateCSVFilename, type ColumnDefinition } from "../src/utils/csvExport";

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

    assert.ok(csv.includes("ID,Name,Email"), "should contain header row");
    assert.ok(csv.includes("1,John Doe,john@example.com"), "should contain first data row");
    assert.ok(csv.includes("2,Jane Smith,jane@example.com"), "should contain second data row");
  });

  it("should generate CSV without header when disabled", () => {
    const columns: ColumnDefinition<TestData>[] = [
      { key: "id", header: "ID" },
      { key: "name", header: "Name" },
    ];

    const csv = exportToCSV(testData, columns, { includeHeader: false });

    assert.ok(!csv.includes("ID,Name"), "should not contain header row");
    assert.ok(csv.includes("1,John Doe"), "should contain data row");
  });

  it("should use CRLF line endings by default (RFC 4180)", () => {
    const columns: ColumnDefinition<TestData>[] = [{ key: "id", header: "ID" }];

    const csv = exportToCSV(testData, columns);

    assert.ok(csv.includes("\r\n"), "should use CRLF line endings");
  });

  it("should use LF line endings when specified", () => {
    const columns: ColumnDefinition<TestData>[] = [{ key: "id", header: "ID" }];

    const csv = exportToCSV(testData, columns, { lineEnding: "LF" });

    assert.ok(!csv.includes("\r\n"), "should not contain CRLF");
    assert.ok(csv.includes("\n"), "should contain LF");
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

    assert.ok(csv.includes('"Smith, John"'), "should quote field containing comma");
  });

  it("should quote fields containing double quotes", () => {
    const data: TestData[] = [{ text: 'He said "Hello"' }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "text", header: "Text" }];

    const csv = exportToCSV(data, columns);

    assert.ok(csv.includes('"He said ""Hello"""'), "should escape double quotes");
  });

  it("should quote fields containing line breaks", () => {
    const data: TestData[] = [{ text: "Line 1\nLine 2" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "text", header: "Text" }];

    const csv = exportToCSV(data, columns);

    assert.ok(csv.includes('"Line 1\nLine 2"'), "should quote field containing newline");
  });

  it("should quote fields containing CR", () => {
    const data: TestData[] = [{ text: "Text\rWith\rCR" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "text", header: "Text" }];

    const csv = exportToCSV(data, columns);

    assert.match(csv, /"Text\rWith\rCR"/);
  });

  it("should quote all fields when quoteAll is enabled", () => {
    const data: TestData[] = [{ text: "simple" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "text", header: "Text" }];

    const csv = exportToCSV(data, columns, { quoteAll: true });

    assert.ok(csv.includes('"Text"'), "should quote header when quoteAll");
    assert.ok(csv.includes('"simple"'), "should quote value when quoteAll");
  });

  it("should not quote simple fields by default", () => {
    const data: TestData[] = [{ text: "simple" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "text", header: "Text" }];

    const csv = exportToCSV(data, columns);

    const lines = csv.split("\r\n");
    assert.strictEqual(lines[1], "simple"); // No quotes
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

    assert.ok(csv.includes("'=1+1"), "should prefix dangerous = with apostrophe");
  });

  it("should prevent formula injection with + prefix", () => {
    const data: TestData[] = [{ formula: "+1234" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    assert.ok(csv.includes("'+1234"), "should prefix dangerous + with apostrophe");
  });

  it("should prevent formula injection with - prefix", () => {
    const data: TestData[] = [{ formula: "-5678" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    assert.ok(csv.includes("'-5678"), "should prefix dangerous - with apostrophe");
  });

  it("should prevent formula injection with @ prefix", () => {
    const data: TestData[] = [{ formula: "@SUM(A1:A10)" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    assert.ok(csv.includes("'@SUM(A1:A10)"), "should prefix dangerous @ with apostrophe");
  });

  it("should prevent formula injection with tab prefix", () => {
    const data: TestData[] = [{ formula: "\tformula" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    assert.ok(csv.includes("'\tformula"), "should prefix tab-prefixed value with apostrophe");
  });

  it("should allow disabling injection prevention", () => {
    const data: TestData[] = [{ formula: "=1+1" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns, { preventInjection: false });

    assert.ok(csv.includes("=1+1"), "should pass through = without prefix when disabled");
    assert.ok(!csv.includes("'=1+1"), "should not prefix = when injection prevention disabled");
  });

  it("should not affect normal strings starting with safe characters", () => {
    const data: TestData[] = [{ formula: "Hello World" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "formula", header: "Value" }];

    const csv = exportToCSV(data, columns);

    assert.ok(csv.includes("Hello World"), "should keep safe string unchanged");
    assert.ok(!csv.includes("'Hello World"), "should not prefix safe string");
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

    assert.ok(csv.includes("123"), "should contain nested id");
    assert.ok(csv.includes("user@example.com"), "should contain nested email");
  });

  it("should access deeply nested fields", () => {
    const columns: ColumnDefinition<TestData>[] = [{ key: "user.profile.name", header: "Name" }];

    const csv = exportToCSV(nestedData, columns);

    assert.ok(csv.includes("John Doe"), "should contain deeply nested name");
  });

  it("should handle missing nested fields gracefully", () => {
    const columns: ColumnDefinition<TestData>[] = [
      { key: "user.missing.field", header: "Missing" },
    ];

    const csv = exportToCSV(nestedData, columns);

    assert.ok(csv.includes("undefined"), "should render undefined for missing path");
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

    assert.ok(csv.includes("2025-09-30"), "should apply date formatter");
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

    assert.ok(csv.includes("$1234.56"), "should apply number formatter");
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

    assert.ok(csv.includes("ACTIVE"), "should apply enum formatter");
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

    assert.ok(csv.includes("active: $1234.56"), "should pass row context to formatter");
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

    assert.strictEqual(csv, "Value"); // Only header
  });

  it("should handle empty strings", () => {
    const data: TestData[] = [{ value: "" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "value", header: "Value" }];

    const csv = exportToCSV(data, columns);

    const lines = csv.split("\r\n");
    assert.strictEqual(lines[1], ""); // Empty value
  });

  it("should handle null values", () => {
    const data = [{ value: null }];
    const columns: ColumnDefinition<any>[] = [{ key: "value", header: "Value" }];

    const csv = exportToCSV(data, columns);

    assert.ok(csv.includes("null"), "should render null as string 'null'");
  });

  it("should handle undefined values", () => {
    const data = [{ value: undefined }];
    const columns: ColumnDefinition<any>[] = [{ key: "value", header: "Value" }];

    const csv = exportToCSV(data, columns);

    assert.ok(csv.includes("undefined"), "should render undefined as string 'undefined'");
  });

  it("should handle unicode characters", () => {
    const data: TestData[] = [{ value: "Hello 🚀 世界" }];
    const columns: ColumnDefinition<TestData>[] = [{ key: "value", header: "Value" }];

    const csv = exportToCSV(data, columns);

    assert.ok(csv.includes("Hello 🚀 世界"), "should preserve unicode characters");
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

    assert.ok(csv.includes("9999,value-9999"), "should contain last row of large dataset");
    assert.ok(duration < 1000, `should complete in under 1 second, took ${duration}ms`);
  });
});

describe("CSV Export - Filename Generation", { concurrency: 1 }, () => {
  it("should generate filename with timestamp", () => {
    const filename = generateCSVFilename("export");

    assert.match(filename, /^export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/);
  });

  it("should support custom extension", () => {
    const filename = generateCSVFilename("report", "txt");

    assert.match(filename, /\.txt$/);
  });

  it("should handle special characters in base name", () => {
    const filename = generateCSVFilename("audit-log-2025");

    assert.ok(filename.includes("audit-log-2025"), "should preserve base name in filename");
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

    assert.ok(csv.includes("sub-123"), "should contain subscription id");
    assert.ok(
      csv.includes('"Smith, John ""Jr."""'),
      "should quote and escape name with comma and quotes"
    );
    assert.ok(csv.includes("'=PRO"), "should prevent formula injection in plan field");
    assert.ok(csv.includes("$99.99"), "should format revenue");
    assert.ok(csv.includes("2025-01-15T10:30:00.000Z"), "should format date");
    assert.ok(csv.includes("web"), "should include nested metadata source");
  });
});
