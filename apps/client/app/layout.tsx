/**
 * @file layout.tsx
 * @description Root layout for the client app — sets HTML shell, loads Inter font, globals.css,
 *              and wraps children in the Providers tree.
 * @component RootLayout
 * @layer infrastructure
 */
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OmniPost - Universal Client Dashboard",
  description: "Manage your social media content across all platforms",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
