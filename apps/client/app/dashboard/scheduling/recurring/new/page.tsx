/**
 * @file page.tsx
 * @component NewRecurringPostPage
 * @description Create new recurring post page.
 * @layer presentation
 */
"use client";

import Link from "next/link";
import { RecurringPostForm } from "@/components/scheduling/RecurringPostForm";

export default function NewRecurringPostPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <Link href="/scheduling/recurring" className="text-sm text-gray-500 hover:text-gray-700">
          ← Publicaciones recurrentes
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-gray-900">Nueva publicación recurrente</h1>
      </div>

      <div className="max-w-2xl">
        <RecurringPostForm />
      </div>
    </div>
  );
}
