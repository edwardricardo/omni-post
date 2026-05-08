/**
 * @file TeamMemberRow.tsx
 * @component TeamMemberRow
 * @description Single row in the team members table with role and actions.
 * @layer infrastructure
 */

"use client";

import { useCallback, useState } from "react";
import { Button } from "@packages/ui";
import { Trash2 } from "lucide-react";
import { RoleBadge } from "./RoleBadge";
import type { TeamMemberDto } from "@/hooks/api/useTeam";

interface TeamMemberRowProps {
  member: TeamMemberDto;
  currentUserRole: "OWNER" | "MANAGER" | "MEMBER" | "VIEWER";
  currentUserId: string;
  onUpdateRole: (memberId: string, newRole: string) => void;
  onRemove: (memberId: string) => void;
}

const ASSIGNABLE_ROLES = ["MANAGER", "MEMBER", "VIEWER"] as const;

export function TeamMemberRow({
  member,
  currentUserRole,
  currentUserId,
  onUpdateRole,
  onRemove,
}: TeamMemberRowProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const isSelf = member.id === currentUserId;
  const canChangeRole = currentUserRole === "OWNER" && !isSelf && member.role !== "OWNER";
  const canRemove = currentUserRole === "OWNER" && !isSelf;

  const handleRoleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onUpdateRole(member.id, e.target.value);
    },
    [member.id, onUpdateRole]
  );

  const handleRemove = useCallback(() => {
    onRemove(member.id);
    setShowConfirm(false);
  }, [member.id, onRemove]);

  const initials = member.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex items-center justify-between py-3 px-4 border-b last:border-b-0 hover:bg-accent/50 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-medium shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {member.name}
            {isSelf && <span className="text-muted-foreground ml-1">(you)</span>}
          </p>
          <p className="text-xs text-muted-foreground truncate">{member.email}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {canChangeRole ? (
          <select
            value={member.role}
            onChange={handleRoleChange}
            className="rounded-md border px-2 py-1 text-xs bg-background"
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ) : (
          <RoleBadge role={member.role} />
        )}

        <span className="text-xs text-muted-foreground hidden sm:block">
          {new Date(member.joinedAt).toLocaleDateString()}
        </span>

        {canRemove && !showConfirm && (
          <Button variant="ghost" size="sm" onClick={() => setShowConfirm(true)} title="Remove">
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        )}

        {showConfirm && (
          <div className="flex gap-1">
            <Button size="sm" variant="destructive" onClick={handleRemove}>
              Remove
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowConfirm(false)}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
