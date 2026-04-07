/**
 * @file not-found.tsx
 * @description Next.js 404 not-found page displaying a centered error panel with a link back
 * to the dashboard home when users navigate to a non-existent route.
 */
"use client";

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-base)]">
      <div className="text-center max-w-md p-8">
        <div className="mb-4">
          <div className="mx-auto w-16 h-16 bg-[var(--accent-subtle)] rounded-full flex items-center justify-center">
            <span className="text-[var(--accent)] text-2xl font-bold">404</span>
          </div>
        </div>
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-4">Page Not Found</h2>
        <p className="text-[var(--text-secondary)] mb-4">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] transition-colors"
        >
          Go Home
        </Link>
      </div>
    </div>
  );
}
