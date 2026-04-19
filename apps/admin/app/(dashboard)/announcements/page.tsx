/**
 * @file page.tsx
 * @description System announcements management page. CRUD for admin-to-client
 *   broadcast messages (info, warning, maintenance, critical).
 * @layer infrastructure
 */
"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Megaphone, Plus, Trash2, Pencil } from "lucide-react";
import {
  toast,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@packages/ui";

import { PageHeader } from "@/components/ui/PageHeader";
import { ActionButton } from "@/components/ui/ActionButton";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { getErrorMessage } from "@/lib/parseApiError";

const INPUT_CLASS =
  "w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]";

interface Announcement {
  id: string;
  title: string;
  message: string;
  type: string;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  createdAt: string;
}

const TYPE_VARIANTS: Record<string, "info" | "warning" | "error" | "neutral"> = {
  INFO: "info",
  WARNING: "warning",
  MAINTENANCE: "warning",
  CRITICAL: "error",
};

function useAnnouncements() {
  return useQuery({
    queryKey: ["announcements"],
    queryFn: async () => {
      const res = await fetch("/api/backend/api/admin/announcements", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load");
      const json = await res.json();
      return json.data as Announcement[];
    },
  });
}

/**
 * @component AnnouncementsPage
 * @description Admin page for creating and managing system-wide announcements.
 */
export default function AnnouncementsPage() {
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const { data: announcements, isLoading } = useAnnouncements();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [form, setForm] = useState({
    title: "",
    message: "",
    type: "INFO",
    startsAt: new Date().toISOString().slice(0, 16),
    endsAt: "",
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        title: form.title,
        message: form.message,
        type: form.type,
        startsAt: new Date(form.startsAt).toISOString(),
        ...(form.endsAt && { endsAt: new Date(form.endsAt).toISOString() }),
      };
      const url = editId
        ? `/api/backend/api/admin/announcements/${editId}`
        : "/api/backend/api/admin/announcements";
      const res = await fetch(url, {
        method: editId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to save");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
      toast({ title: tc("success") });
      setDialogOpen(false);
      setEditId(null);
    },
    onError: (err) => {
      toast({ title: tc("error"), description: getErrorMessage(err), variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/backend/api/admin/announcements/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
      toast({ title: "Deleted" });
      setDeleteTarget(null);
    },
  });

  const openCreate = useCallback(() => {
    setEditId(null);
    setForm({
      title: "",
      message: "",
      type: "INFO",
      startsAt: new Date().toISOString().slice(0, 16),
      endsAt: "",
    });
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((a: Announcement) => {
    setEditId(a.id);
    setForm({
      title: a.title,
      message: a.message,
      type: a.type,
      startsAt: a.startsAt.slice(0, 16),
      endsAt: a.endsAt ? a.endsAt.slice(0, 16) : "",
    });
    setDialogOpen(true);
  }, []);

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Announcements" />
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" label={tc("loading")} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Announcements"
        description="Broadcast messages to all clients"
        actions={
          <ActionButton variant="primary" size="sm" onClick={openCreate}>
            <Plus className="h-3 w-3 mr-1" /> New
          </ActionButton>
        }
      />

      <div className="space-y-2">
        {(announcements ?? []).map((a) => (
          <div
            key={a.id}
            className="flex items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
          >
            <Megaphone className="h-4 w-4 text-[var(--text-tertiary)] shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[var(--text-primary)]">{a.title}</span>
                <Badge variant={TYPE_VARIANTS[a.type] ?? "neutral"}>{a.type}</Badge>
              </div>
              <p className="text-xs text-[var(--text-tertiary)] mt-0.5 truncate">{a.message}</p>
            </div>
            <div className="flex gap-1 shrink-0">
              <ActionButton variant="secondary" size="sm" onClick={() => openEdit(a)}>
                <Pencil className="h-3 w-3" />
              </ActionButton>
              <ActionButton variant="danger" size="sm" onClick={() => setDeleteTarget(a)}>
                <Trash2 className="h-3 w-3" />
              </ActionButton>
            </div>
          </div>
        ))}
        {(announcements ?? []).length === 0 && (
          <p className="text-sm text-[var(--text-tertiary)] text-center py-8">
            No announcements yet
          </p>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit Announcement" : "New Announcement"}</DialogTitle>
            <DialogDescription>Visible to all clients when active.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                Title
              </label>
              <input
                className={INPUT_CLASS}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                Message
              </label>
              <textarea
                className={`${INPUT_CLASS} min-h-[80px]`}
                value={form.message}
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Type
                </label>
                <select
                  className={INPUT_CLASS}
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                >
                  <option value="INFO">Info</option>
                  <option value="WARNING">Warning</option>
                  <option value="MAINTENANCE">Maintenance</option>
                  <option value="CRITICAL">Critical</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Starts At
                </label>
                <input
                  type="datetime-local"
                  className={INPUT_CLASS}
                  value={form.startsAt}
                  onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Ends At
                </label>
                <input
                  type="datetime-local"
                  className={INPUT_CLASS}
                  value={form.endsAt}
                  onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <ActionButton variant="secondary" size="sm" onClick={() => setDialogOpen(false)}>
              {tc("cancel")}
            </ActionButton>
            <ActionButton
              variant="primary"
              size="sm"
              loading={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              disabled={!form.title || !form.message}
            >
              {editId ? "Update" : "Create"}
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete Announcement"
        description={`Are you sure you want to delete "${deleteTarget?.title}"?`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
