/**
 * @file page.tsx
 * @component RootPage
 * @description Root page that redirects to the login page.
 */

import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/login");
}
