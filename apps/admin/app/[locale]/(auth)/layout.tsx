/**
 * @file layout.tsx
 * @description Minimal layout wrapper for the authentication route group. Renders children directly
 * without any dashboard chrome or session checks.
 * @component AuthLayout
 * @layer infrastructure
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
