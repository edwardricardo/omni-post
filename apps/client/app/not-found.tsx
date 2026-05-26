/**
 * @file not-found.tsx
 * @description Global 404 for requests not matched by the next-intl
 *              middleware (no locale context). Renders its own HTML shell
 *              because the passthrough root layout provides none. Localized
 *              404s inside a locale are handled by
 *              `app/[locale]/not-found.tsx`.
 * @component GlobalNotFound
 * @layer infrastructure
 */
import Link from "next/link";

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center">
          <h2 className="text-2xl font-bold mb-4">Not Found</h2>
          <p className="text-gray-600 mb-4">Could not find the requested resource</p>
          <Link href="/" className="px-4 py-2 bg-blue-500 text-white rounded-sm hover:bg-blue-600">
            Return Home
          </Link>
        </div>
      </body>
    </html>
  );
}
