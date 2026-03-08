/**
 * @file page.tsx
 * @description Server Component page for displaying a single post's details by ID.
 * Fetches post data from the backend API and renders locale, body, and ID.
 */
import { api } from "@/lib/apiClient";

export default async function PostDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = (await api.getPost(id).catch(() => ({ ok: false }) as any)) as any;
  if (!post.ok) return <div>Error cargando post</div>;
  const p = post.value;
  return (
    <div>
      <h1>Post {p.id}</h1>
      <p>
        <strong>Locale:</strong> {p.locale}
      </p>
      <p>
        <strong>Body:</strong> {p.body}
      </p>
    </div>
  );
}
