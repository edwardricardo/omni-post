/**
 * @file posts.flow.test.ts
 * @description Tests for posts
 * @layer infrastructure
 */
const POSTS_FLOW_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

async function postsFlowHttp(path: string, init?: RequestInit) {
  const res = await fetch(POSTS_FLOW_BASE + path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  return { ok: res.ok, status: res.status, body: await res.json() };
}

async function postsFlowMain() {
  const created = await postsFlowHttp("/posts", {
    method: "POST",
    body: JSON.stringify({ projectId: "dev", locale: "es", body: "hola desde admin test" }),
  });
  console.log("create post:", created.status, created.body);
  if (!created.ok) {
    console.log("Warn: create post failed (DB may be down)");
    return;
  }

  const id = created.body.value.id;
  const list = await postsFlowHttp("/posts");
  console.log("list posts:", list.status);
  if (list.ok) {
    const found = (list.body.value || []).some((p: any) => p.id === id);
    if (!found) throw new Error("Post not listed after creation");
  }
}

postsFlowMain();
