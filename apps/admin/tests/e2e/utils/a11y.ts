/**
 * @file a11y.ts
 * @description Helper canónico para asserts WCAG en E2E de apps/admin. Espeja el patrón de apps/client/tests/e2e/utils/assertions.ts (CustomAssertions.expectPageToBeAccessible). Uso: `await expectPageToBeAccessible(page, { tags: ["wcag2a","wcag2aa"] })`.
 * @layer infrastructure
 */
import { AxeBuilder } from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export type A11yImpact = "minor" | "moderate" | "serious" | "critical";

export interface A11yOptions {
  tags?: string[];
  exclude?: string[];
  includedImpacts?: A11yImpact[];
}

export async function expectPageToBeAccessible(
  page: Page,
  options: A11yOptions = {}
): Promise<void> {
  const {
    tags = ["wcag2a", "wcag2aa"],
    exclude = [],
    includedImpacts = ["serious", "critical"],
  } = options;

  const builder = new AxeBuilder({ page }).withTags(tags);
  for (const selector of exclude) {
    builder.exclude(selector);
  }

  const results = await builder.analyze();
  const impactSet = new Set<string>(includedImpacts);
  const blocking = results.violations.filter(
    (v) => v.impact !== null && v.impact !== undefined && impactSet.has(v.impact)
  );

  expect(
    blocking,
    `Page ${page.url()} has ${blocking.length} blocking a11y violations:\n${blocking
      .map((v) => `  - [${v.impact}] ${v.id}: ${v.description}`)
      .join("\n")}`
  ).toHaveLength(0);
}
