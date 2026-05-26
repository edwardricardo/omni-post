/**
 * @file not-found.tsx
 * @description Next.js 404 page rendered when the requested route does not exist.
 * @component NotFound
 * @layer infrastructure
 */
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <h2 className="text-2xl font-bold mb-4">{t("notFound.title")}</h2>
      <p className="text-gray-600 mb-4">{t("notFound.description")}</p>
      <Link href="/" className="px-4 py-2 bg-blue-500 text-white rounded-sm hover:bg-blue-600">
        {t("notFound.returnHome")}
      </Link>
    </div>
  );
}
