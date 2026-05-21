/**
 * @file not-found.tsx
 * @description Next.js 404 page rendered when the requested route does not exist.
 * @component NotFound
 * @layer infrastructure
 */
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h2 className="text-2xl font-bold mb-4">Not Found</h2>
      <p className="text-gray-600 mb-4">Could not find the requested resource</p>
      <Link href="/" className="px-4 py-2 bg-blue-500 text-white rounded-sm hover:bg-blue-600">
        Return Home
      </Link>
    </div>
  );
}
