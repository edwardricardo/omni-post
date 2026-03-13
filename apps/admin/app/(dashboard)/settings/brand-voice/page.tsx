/**
 * @file page.tsx
 * @description Settings → Brand Voice page at /admin/settings/brand-voice?accountId=<uuid>.
 *              Allows configuring a custom AI system prompt for a specific account.
 *              The admin selects the target account via the `accountId` query param.
 * @layer ui
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyAccessToken } from "@/lib/auth/backend-client";
import { BrandVoiceForm } from "@/components/settings/BrandVoiceForm";

export const metadata = {
  title: "Brand Voice — OmniPost Admin",
};

interface PageProps {
  searchParams: Promise<{ accountId?: string }>;
}

export default async function BrandVoicePage({ searchParams }: PageProps) {
  const cookieStore = await cookies();
  const token = cookieStore.get("admin-session")?.value;
  if (!token) redirect("/auth/login");

  const user = await verifyAccessToken(token);
  if (!user) redirect("/auth/login");

  const params = await searchParams;
  const accountId = params.accountId;

  if (!accountId) {
    return (
      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Brand Voice</h1>
          <p className="mt-1 text-sm text-gray-600">
            Define your brand&apos;s tone and style. This profile is automatically applied to all AI
            content generation requests for the selected account.
          </p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          No account selected. Append{" "}
          <code className="font-mono bg-amber-100 px-1 rounded">?accountId=&lt;uuid&gt;</code> to
          the URL to manage a specific account&apos;s brand voice.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Brand Voice</h1>
        <p className="mt-1 text-sm text-gray-600">
          Define your brand&apos;s tone and style. This profile is automatically applied to all AI
          content generation requests for account{" "}
          <code className="font-mono text-xs bg-gray-100 px-1 rounded">{accountId}</code>.
        </p>
      </div>
      <BrandVoiceForm accountId={accountId} />
    </div>
  );
}
