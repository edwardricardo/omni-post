/**
 * @file page.tsx
 * @component PrivacyPage
 * @description Privacy rights page at /dashboard/settings/privacy.
 *              Allows users to submit Data Subject Access Requests (DSAR)
 *              for data export, access, or deletion under GDPR, LGPD, CCPA,
 *              and PIPEDA regulations.
 * @layer infrastructure
 */

"use client";

import { useState, useCallback } from "react";
import { useAuth } from "@/lib/auth/authContext";
import { useSubmitDsarRequest } from "@/hooks/api/usePrivacy";
import type { DsarSubmitResult } from "@/hooks/api/usePrivacy";
import { Button } from "@packages/ui";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REQUEST_TYPES = [
  { value: "ACCESS", label: "Access my data" },
  { value: "EXPORT", label: "Export my data" },
  { value: "DELETION", label: "Delete my account and data" },
] as const;

type RequestType = (typeof REQUEST_TYPES)[number]["value"];

const JURISDICTIONS = [
  { value: "GDPR", label: "European Union (GDPR - 30 days)", days: 30 },
  { value: "LGPD", label: "Brazil (LGPD - 15 days)", days: 15 },
  { value: "CCPA", label: "United States (CCPA - 45 days)", days: 45 },
  { value: "PIPEDA", label: "Canada (PIPEDA - 30 days)", days: 30 },
  { value: "OTHER", label: "Other (30 days)", days: 30 },
] as const;

type Jurisdiction = (typeof JURISDICTIONS)[number]["value"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDeadlineDays(jurisdiction: Jurisdiction): number {
  const match = JURISDICTIONS.find((j) => j.value === jurisdiction);
  return match?.days ?? 30;
}

// ---------------------------------------------------------------------------
// Confirmation card shown after successful submission
// ---------------------------------------------------------------------------

function ConfirmationCard({
  result,
  email,
  jurisdiction,
  onReset,
}: {
  result: DsarSubmitResult;
  email: string;
  jurisdiction: Jurisdiction;
  onReset: () => void;
}) {
  const days = getDeadlineDays(jurisdiction);

  return (
    <div className="rounded-lg border-2 border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30 p-6">
      <h2 className="text-lg font-semibold text-foreground">Request received</h2>
      <div className="mt-4 space-y-2 text-sm text-foreground">
        <p>
          <span className="font-medium">Reference ID:</span> {result.id}
        </p>
        <p>
          We will respond to <span className="font-medium">{email}</span> within{" "}
          <span className="font-medium">{days} days</span>.
        </p>
      </div>
      <div className="mt-4 rounded-md bg-muted p-3 text-xs text-muted-foreground">
        Keep this reference ID if you need to follow up.
      </div>
      <Button variant="outline" size="sm" className="mt-4" onClick={onReset}>
        Submit another request
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function PrivacyPage() {
  const { user } = useAuth();
  const submitDsar = useSubmitDsarRequest();

  // Form state
  const [requestType, setRequestType] = useState<RequestType>("ACCESS");
  const [email, setEmail] = useState(user?.email ?? "");
  const [name, setName] = useState(user?.name ?? "");
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>("GDPR");
  const [formError, setFormError] = useState<string | null>(null);

  // Success state
  const [submittedResult, setSubmittedResult] = useState<DsarSubmitResult | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState("");
  const [submittedJurisdiction, setSubmittedJurisdiction] = useState<Jurisdiction>("GDPR");

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setFormError(null);

      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        setFormError("Email address is required.");
        return;
      }

      submitDsar.mutate(
        {
          email: trimmedEmail,
          type: requestType,
          jurisdiction,
          ...(name.trim() && { name: name.trim() }),
        },
        {
          onSuccess: (result) => {
            setSubmittedResult(result);
            setSubmittedEmail(trimmedEmail);
            setSubmittedJurisdiction(jurisdiction);
          },
          onError: (error) => {
            setFormError(
              error instanceof Error ? error.message : "Request failed. Please try again."
            );
          },
        }
      );
    },
    [email, name, requestType, jurisdiction, submitDsar]
  );

  const handleReset = useCallback(() => {
    setSubmittedResult(null);
    setSubmittedEmail("");
    setRequestType("ACCESS");
    setFormError(null);
  }, []);

  // After successful submission, show the confirmation card
  if (submittedResult) {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Your Privacy Rights</h1>
        </div>
        <ConfirmationCard
          result={submittedResult}
          email={submittedEmail}
          jurisdiction={submittedJurisdiction}
          onReset={handleReset}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Your Privacy Rights</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          OmniPost stores personal data to provide its services. Under GDPR, LGPD, CCPA, and other
          privacy regulations, you have rights over your data. Use this form to exercise those
          rights.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Request type */}
        <fieldset className="border-0 p-0 m-0 min-w-0 space-y-3">
          <legend className="text-sm font-medium text-foreground">Request type</legend>
          {REQUEST_TYPES.map((rt) => (
            <label key={rt.value} className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="requestType"
                value={rt.value}
                checked={requestType === rt.value}
                onChange={() => setRequestType(rt.value)}
                className="mt-0.5"
              />
              <span className="text-sm text-foreground">{rt.label}</span>
            </label>
          ))}
        </fieldset>

        {/* Email */}
        <div className="space-y-1.5">
          <label htmlFor="dsar-email" className="text-sm font-medium text-foreground">
            Email address
          </label>
          <input
            id="dsar-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Name (optional) */}
        <div className="space-y-1.5">
          <label htmlFor="dsar-name" className="text-sm font-medium text-foreground">
            Name <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            id="dsar-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your full name"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Jurisdiction */}
        <div className="space-y-1.5">
          <label htmlFor="dsar-jurisdiction" className="text-sm font-medium text-foreground">
            Region
          </label>
          <select
            id="dsar-jurisdiction"
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value as Jurisdiction)}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {JURISDICTIONS.map((j) => (
              <option key={j.value} value={j.value}>
                {j.label}
              </option>
            ))}
          </select>
        </div>

        {/* Error message */}
        {formError && (
          <div className="rounded-md border border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950/30 p-3 text-sm text-red-800 dark:text-red-200">
            {formError}
          </div>
        )}

        {/* Deletion warning */}
        {requestType === "DELETION" && (
          <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            Account deletion is permanent. All your data, posts, and connected accounts will be
            removed. This action cannot be undone.
          </div>
        )}

        {/* Submit */}
        <Button type="submit" disabled={submitDsar.isPending}>
          {submitDsar.isPending ? "Submitting..." : "Submit request"}
        </Button>
      </form>
    </div>
  );
}
