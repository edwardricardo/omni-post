/**
 * @file layout.tsx
 * @description Passthrough root layout. With next-intl i18n routing the real
 *              HTML shell (`<html>`/`<body>`) lives in
 *              `app/[locale]/layout.tsx`; this root only forwards children.
 *              Next.js still requires a root layout to exist (e.g. for the
 *              global `app/not-found.tsx`), so it is kept as a thin
 *              passthrough.
 * @layer infrastructure
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
