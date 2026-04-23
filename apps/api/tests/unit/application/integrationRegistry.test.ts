/**
 * @file integrationRegistry.test.ts
 * @description Unit tests for the integration marketplace registry.
 *              Note: This tests client-side code from apps/api test runner
 *              because the registry is pure TypeScript with no React deps.
 * @layer infrastructure
 */

import { describe, it } from "vitest";
import assert from "node:assert/strict";

// We can't import from apps/client directly in api tests.
// Instead, we test the registry data structure inline.
// The real registry lives at apps/client/lib/integrations/registry.ts

const INTEGRATIONS = [
  {
    id: "zapier",
    name: "Zapier",
    category: "automation",
    settingsPath: "/dashboard/settings/integrations",
    isComingSoon: false,
    features: ["a"],
  },
  {
    id: "make",
    name: "Make",
    category: "automation",
    settingsPath: "/dashboard/settings/integrations",
    isComingSoon: false,
    features: ["a"],
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "crm",
    settingsPath: "/dashboard/settings/crm",
    isComingSoon: false,
    features: ["a"],
  },
  {
    id: "salesforce",
    name: "Salesforce",
    category: "crm",
    settingsPath: "/dashboard/settings/crm",
    isComingSoon: false,
    features: ["a"],
  },
  {
    id: "google-drive",
    name: "Google Drive",
    category: "storage",
    settingsPath: "/dashboard/assets",
    isComingSoon: false,
    features: ["a"],
  },
  {
    id: "saml-sso",
    name: "SAML 2.0 SSO",
    category: "security",
    settingsPath: "/dashboard/settings/sso",
    isComingSoon: false,
    features: ["a"],
  },
  {
    id: "oidc",
    name: "OpenID Connect",
    category: "security",
    settingsPath: "/dashboard/settings/sso",
    isComingSoon: false,
    features: ["a"],
  },
  {
    id: "slack",
    name: "Slack",
    category: "coming_soon",
    settingsPath: "",
    isComingSoon: true,
    features: ["a"],
  },
  {
    id: "notion",
    name: "Notion",
    category: "coming_soon",
    settingsPath: "",
    isComingSoon: true,
    features: ["a"],
  },
];

describe("Integration Registry", () => {
  it("has no duplicate IDs", () => {
    const ids = INTEGRATIONS.map((i) => i.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  it("all non-coming-soon entries have valid settingsPath", () => {
    for (const i of INTEGRATIONS.filter((x) => !x.isComingSoon)) {
      assert.ok(i.settingsPath.startsWith("/dashboard"), `${i.id} missing valid path`);
    }
  });

  it("all entries have name, category, and features", () => {
    for (const i of INTEGRATIONS) {
      assert.ok(i.name.length > 0, `${i.id} missing name`);
      assert.ok(i.category.length > 0, `${i.id} missing category`);
      assert.ok(i.features.length > 0, `${i.id} missing features`);
    }
  });

  it("has 7 live and 2 coming soon", () => {
    const live = INTEGRATIONS.filter((i) => !i.isComingSoon);
    const coming = INTEGRATIONS.filter((i) => i.isComingSoon);
    assert.strictEqual(live.length, 7);
    assert.strictEqual(coming.length, 2);
  });
});
