/**
 * @file error.tsx
 * @description Next.js root error boundary component that displays a user-friendly error message
 * with an error ID (digest) and a retry button to attempt recovery.
 */
"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center max-w-md p-8">
        <div className="mb-6">
          <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
            <span className="text-red-600 text-3xl">⚠️</span>
          </div>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Something went wrong!</h2>
        <p className="text-gray-600 mb-6">{error.message}</p>
        {error.digest && <p className="text-sm text-gray-500 mb-6">Error ID: {error.digest}</p>}
        <button
          onClick={reset}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
