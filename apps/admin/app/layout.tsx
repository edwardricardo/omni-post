import React from "react";
import { Toaster } from "@packages/ui";

export const metadata = { title: "Admin", description: "CMS Multicanal" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <header style={{ padding: 12, borderBottom: "1px solid #eee" }}>
          <a href="/">Admin</a> · <a href="/posts">Posts</a> · <a href="/logs">Logs</a> ·{" "}
          <a href="/webhooks">Webhooks</a>
        </header>
        <main style={{ padding: 16 }}>{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
