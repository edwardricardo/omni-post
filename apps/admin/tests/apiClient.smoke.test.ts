/**
 * @file apiClient.smoke.test.ts
 * @description Tests for api client smoke
 * @layer infrastructure
 */
const API_CLIENT_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

async function apiClientHttp(path: string, init?: RequestInit) {
  const res = await fetch(API_CLIENT_BASE + path, init);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function apiClientMain() {
  const h = await apiClientHttp("/health");
  console.log("health:", h.status, h.body);
  if (h.status !== 200) throw new Error("API /health not OK");

  const list = await apiClientHttp("/posts");
  console.log("posts:", list.status);
  if (list.status !== 200) console.log("Warn: /posts requires DB seeded");
}

apiClientMain();
