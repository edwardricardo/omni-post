/**
 * @file OnboardingChecklist.tsx
 * @description Setup checklist shown to new users on the dashboard until
 *   onboarding is complete or dismissed. Displays progress bar, step list
 *   with action links, and a dismiss button.
 * @layer infrastructure
 */
"use client";

import { useCallback } from "react";
import Link from "next/link";
import { X, Check, Circle, Link2, FileText, Users, CreditCard } from "lucide-react";
import { useOnboarding, useCompleteStep, useDismissOnboarding } from "@/hooks/api/useOnboarding";

const STEP_CONFIG: Record<string, { icon: typeof Link2; href: string }> = {
  connectedFirstProvider: { icon: Link2, href: "/dashboard/channels" },
  createdFirstPost: { icon: FileText, href: "/dashboard/posts/new" },
  invitedTeamMember: { icon: Users, href: "/dashboard/team" },
  configuredBilling: { icon: CreditCard, href: "/dashboard/settings/billing" },
};

/**
 * @component OnboardingChecklist
 * @description Progress checklist for new users. Hidden when completed or dismissed.
 */
export function OnboardingChecklist() {
  const { data, isLoading } = useOnboarding();
  const completeMutation = useCompleteStep();
  const dismissMutation = useDismissOnboarding();

  const handleDismiss = useCallback(() => {
    dismissMutation.mutate();
  }, [dismissMutation]);

  if (isLoading || !data) return null;
  if (data.completedAt || data.dismissedAt) return null;

  const progressPct = data.totalSteps > 0 ? (data.completedCount / data.totalSteps) * 100 : 0;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-5 mb-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-base font-semibold text-zinc-100">Get started with OmniPost</h3>
          <p className="text-sm text-zinc-400 mt-0.5">
            {data.completedCount}/{data.totalSteps} steps completed
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={dismissMutation.isPending}
          className="text-zinc-500 hover:text-zinc-300 p-1"
          aria-label="Dismiss onboarding"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="w-full bg-zinc-800 rounded-full h-2 mb-4">
        <div
          className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <ul className="space-y-2">
        {data.steps.map((step) => {
          const config = STEP_CONFIG[step.key];
          const Icon = config?.icon ?? Circle;

          return (
            <li key={step.key} className="flex items-center gap-3">
              {step.completed ? (
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20">
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                </div>
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-600">
                  <Circle className="h-3 w-3 text-zinc-500" />
                </div>
              )}
              <span
                className={`flex-1 text-sm ${step.completed ? "text-zinc-500 line-through" : "text-zinc-200"}`}
              >
                {step.label}
              </span>
              {!step.completed && config && (
                <Link
                  href={config.href}
                  className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium text-indigo-400 hover:text-indigo-300 hover:bg-zinc-800"
                >
                  <Icon className="h-3 w-3" />
                  Go
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={handleDismiss}
        disabled={dismissMutation.isPending}
        className="mt-4 text-xs text-zinc-500 hover:text-zinc-400 underline"
      >
        Skip for now
      </button>
    </div>
  );
}
