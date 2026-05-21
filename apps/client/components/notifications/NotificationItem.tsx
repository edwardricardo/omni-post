/**
 * @file NotificationItem.tsx
 * @description Single notification row rendered inside the notification bell dropdown.
 *              Shows: colored type dot, title, truncated body, time-ago, and navigates
 *              to the relevant resource on click.
 * @layer infrastructure
 */

"use client";

import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { NotificationItem as NotificationItemType } from "@/lib/stores/notificationStore";

// ---------------------------------------------------------------------------
// Notification type → colour
// ---------------------------------------------------------------------------
const TYPE_COLOURS: Record<string, string> = {
  APPROVAL_REQUESTED: "bg-amber-400",
  POST_APPROVED: "bg-green-400",
  POST_REJECTED: "bg-red-400",
  COMMENT_ADDED: "bg-blue-400",
  COMMENT_REPLY: "bg-blue-400",
  MENTION: "bg-purple-400",
};

// ---------------------------------------------------------------------------
// Notification type → navigation target
// ---------------------------------------------------------------------------
function getTarget(notification: NotificationItemType): string {
  const postId = notification.metadata?.postId as string | undefined;
  switch (notification.type) {
    case "APPROVAL_REQUESTED":
      return "/dashboard/approvals";
    case "POST_APPROVED":
    case "POST_REJECTED":
    case "COMMENT_ADDED":
    case "COMMENT_REPLY":
    case "MENTION":
      return postId ? `/dashboard/posts/${postId}` : "/dashboard/posts";
    default:
      return "/dashboard";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface NotificationItemProps {
  notification: NotificationItemType;
  onRead: (id: string) => void;
}

/**
 * @component NotificationItem
 * @description Single notification row in the bell dropdown. Displays a colored type
 *              dot, title, truncated body, relative timestamp, and navigates to the
 *              relevant resource on click while marking as read.
 * @param props.notification - The notification data to render
 * @param props.onRead - Callback invoked with notification ID when clicked
 */
export function NotificationItem({ notification, onRead }: NotificationItemProps) {
  const router = useRouter();
  const t = useTranslations("notifications");
  const colour = TYPE_COLOURS[notification.type] ?? "bg-gray-400";
  const truncatedBody =
    notification.body.length > 60 ? `${notification.body.slice(0, 60)}…` : notification.body;

  const handleClick = () => {
    onRead(notification.id);
    router.push(getTarget(notification));
  };

  const timeAgo = formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true });

  return (
    <button
      onClick={handleClick}
      className={[
        "w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-50 transition-colors",
        !notification.read && "bg-blue-50/40",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={`${notification.title} — ${timeAgo}`}
    >
      {/* Type dot */}
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${colour}`} aria-hidden="true" />

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm leading-snug ${!notification.read ? "font-semibold" : "font-medium"} text-gray-900 truncate`}
        >
          {notification.title}
        </p>
        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{truncatedBody}</p>
        <p className="text-xs text-gray-400 mt-1">{timeAgo}</p>
      </div>

      {/* Unread dot */}
      {!notification.read && (
        <span
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500"
          aria-label={t("unread")}
        />
      )}
    </button>
  );
}
