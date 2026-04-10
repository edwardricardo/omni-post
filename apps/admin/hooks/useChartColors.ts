/**
 * @file useChartColors.ts
 * @description Resolves CSS custom-property color tokens into concrete values
 *   for Recharts SVG attributes. Re-computes when the theme toggles.
 * @layer presentation
 */
"use client";

import { useMemo, useState, useEffect } from "react";
import { useTheme } from "@/providers/ThemeProvider";

export interface ChartColors {
  accent: string;
  success: string;
  error: string;
  warning: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  bgElevated: string;
  borderSubtle: string;
  subscriptionColors: Record<string, string>;
}

function resolveVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const FALLBACK: ChartColors = {
  accent: "#6366f1",
  success: "#22c55e",
  error: "#ef4444",
  warning: "#f59e0b",
  textPrimary: "#111827",
  textSecondary: "#6b7280",
  textTertiary: "#9ca3af",
  bgElevated: "#ffffff",
  borderSubtle: "#e5e7eb",
  subscriptionColors: {
    ACTIVE: "#22c55e",
    TRIALING: "#f59e0b",
    GRANDFATHERED: "#6366f1",
    CANCELED: "#ef4444",
    PAST_DUE: "#ef4444",
  },
};

function buildColors(): ChartColors {
  const accent = resolveVar("--accent");
  if (!accent) return FALLBACK;

  const success = resolveVar("--success");
  const error = resolveVar("--error");
  const warning = resolveVar("--warning");

  return {
    accent,
    success,
    error,
    warning,
    textPrimary: resolveVar("--text-primary"),
    textSecondary: resolveVar("--text-secondary"),
    textTertiary: resolveVar("--text-tertiary"),
    bgElevated: resolveVar("--bg-elevated"),
    borderSubtle: resolveVar("--border-subtle"),
    subscriptionColors: {
      ACTIVE: success,
      TRIALING: warning,
      GRANDFATHERED: accent,
      CANCELED: error,
      PAST_DUE: error,
    },
  };
}

export function useChartColors(): ChartColors {
  const { theme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return useMemo(() => {
    if (!mounted) return FALLBACK;
    return buildColors();
  }, [theme, mounted]);
}
