/**
 * @file a11y.ts
 * @description Helper canónico para asserts WCAG en E2E de apps/client.
 *              Espejo del admin (apps/admin/tests/e2e/utils/a11y.ts) per
 *              canon `axe-core-playwright-a11y-testing-for-e2e-suites`.
 *              Defaults cubren WCAG 2.0 + 2.1 Level A + AA. Impact threshold
 *              `['serious', 'critical']` per Deque CI guidance — minor /
 *              moderate son informational, no bloquean CI. La function
 *              `CustomAssertions.expectPageToBeAccessible` en `assertions.ts`
 *              ahora delega a esta function (compat backward para callers
 *              existentes).
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
    tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
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
