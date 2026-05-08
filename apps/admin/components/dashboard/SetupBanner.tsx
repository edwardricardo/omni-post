/**
 * @file SetupBanner.tsx
 * @description First-run setup banner shown on the admin dashboard when
 *   critical platform settings are not configured. Dismissible via localStorage.
 * @layer infrastructure
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertTriangle, X, CreditCard, Mail, Globe, Cpu } from "lucide-react";

import { useSettingsStatus } from "@/hooks/api/useSettings";

const DISMISS_KEY = "admin-setup-dismissed";

interface SetupItem {
  key: string;
  groups: string[];
  icon: typeof CreditCard;
  label: string;
  description: string;
  tab: string;
}

/**
 * @component SetupBanner
 * @description Guides new admin users through initial platform configuration.
 *   Hidden when all critical groups are configured or user has dismissed.
 */
export function SetupBanner() {
  const tc = useTranslations("common");
  const { data: status } = useSettingsStatus();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(localStorage.getItem(DISMISS_KEY) === "true");
  }, []);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  }, []);

  if (dismissed || !status) return null;
  if (status.overallHealth === "healthy") return null;

  const items: SetupItem[] = [
    {
      key: "gateway",
      groups: ["STRIPE", "PADDLE"],
      icon: CreditCard,
      label: "Payment gateway",
      description: "Required for subscriptions",
      tab: "gateways",
    },
    {
      key: "email",
      groups: ["RESEND"],
      icon: Mail,
      label: "Email provider",
      description: "Required for notifications",
      tab: "email",
    },
    {
      key: "platform",
      groups: ["PLATFORM"],
      icon: Globe,
      label: "Platform details",
      description: "Name, URL, branding",
      tab: "platform",
    },
    {
      key: "ai",
      groups: ["AI_POOL"],
      icon: Cpu,
      label: "AI providers",
      description: "Optional — enables AI features",
      tab: "ai",
    },
  ];

  const unconfigured = items.filter((item) => !item.groups.some((g) => status.groups[g]));

  if (unconfigured.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--warning)] bg-[var(--warning-subtle)] p-4 mb-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle aria-hidden="true" className="h-5 w-5 text-[var(--warning)]" />
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              Complete initial setup
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              Configure the following to start accepting customers.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] p-1"
          aria-label={tc("close")}
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      <ul className="space-y-2">
        {unconfigured.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.key} className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded bg-[var(--bg-elevated)]">
                <Icon className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
              </div>
              <div className="flex-1">
                <span className="text-sm text-[var(--text-primary)]">{item.label}</span>
                <span className="text-xs text-[var(--text-tertiary)] ml-2">
                  — {item.description}
                </span>
              </div>
              <Link
                href={`/settings?tab=${item.tab}`}
                className="text-xs font-medium text-[var(--accent)] hover:underline"
              >
                Configure
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex justify-between items-center mt-3 pt-3 border-t border-[var(--border-subtle)]">
        <Link href="/settings" className="text-xs font-medium text-[var(--accent)] hover:underline">
          Go to Settings
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] underline"
        >
          Dismiss — I&apos;ll do this later
        </button>
      </div>
    </div>
  );
}
