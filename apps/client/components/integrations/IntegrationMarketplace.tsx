/**
 * @file IntegrationMarketplace.tsx
 * @component IntegrationMarketplace
 * @description Integration marketplace with category filters and status display.
 * @layer infrastructure
 */

"use client";

import { useState, useMemo } from "react";
import { Input } from "@packages/ui";
import { Search, ExternalLink } from "lucide-react";
import Link from "next/link";
import {
  INTEGRATIONS,
  type IntegrationCategory,
  type IntegrationDefinition,
} from "@/lib/integrations/registry";

const CATEGORIES: Array<{ label: string; value: IntegrationCategory | "all" }> = [
  { label: "All", value: "all" },
  { label: "Automation", value: "automation" },
  { label: "CRM", value: "crm" },
  { label: "Storage", value: "storage" },
  { label: "Security", value: "security" },
  { label: "Coming Soon", value: "coming_soon" },
];

function IntegrationCard({ integration }: { integration: IntegrationDefinition }) {
  const isComingSoon = integration.isComingSoon === true;

  return (
    <div
      className={`rounded-lg border bg-card p-5 ${isComingSoon ? "opacity-60" : "hover:shadow-sm transition-shadow"}`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-foreground">{integration.name}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">{integration.description}</p>
        </div>
        {isComingSoon && (
          <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full shrink-0">
            Coming Soon
          </span>
        )}
      </div>

      <ul className="space-y-1 mb-4">
        {integration.features.map((f) => (
          <li key={f} className="text-xs text-muted-foreground flex items-start gap-1.5">
            <span className="text-green-600 mt-0.5">&#10003;</span>
            {f}
          </li>
        ))}
      </ul>

      {!isComingSoon && (
        <Link
          href={integration.settingsPath}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          Configure
          <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}

export function IntegrationMarketplace() {
  const [category, setCategory] = useState<IntegrationCategory | "all">("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let list = INTEGRATIONS;
    if (category !== "all") {
      list = list.filter((i) => i.category === category);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
      );
    }
    return list;
  }, [category, search]);

  const liveCount = INTEGRATIONS.filter((i) => !i.isComingSoon).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search integrations..."
            className="pl-9"
          />
        </div>
        <p className="text-sm text-muted-foreground">{liveCount} integrations available</p>
      </div>

      <div className="flex gap-2 overflow-x-auto">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            type="button"
            onClick={() => setCategory(cat.value)}
            className={`px-3 py-1.5 text-sm rounded-full border whitespace-nowrap transition-colors ${
              category === cat.value
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No integrations match your search.
        </div>
      )}
    </div>
  );
}
