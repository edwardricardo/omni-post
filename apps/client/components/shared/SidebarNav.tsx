/**
 * SidebarNav Component
 *
 * Client-side navigation sidebar for the admin dashboard.
 * Uses usePathname() for active link highlighting and supports
 * collapsible section groups with lucide-react icons.
 *
 * Stays always-expanded on desktop; collapses to icon-only on mobile
 * via a toggle button.
 */
"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Library,
  FileText,
  FilePlus,
  Sparkles,
  BrainCircuit,
  Gauge,
  CalendarDays,
  ListOrdered,
  BarChart3,
  Lightbulb,
  Users,
  Link2,
  CreditCard,
  ShieldCheck,
  ClipboardCheck,
  TrendingUp,
  ScrollText,
  Webhook,
  Inbox,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

// ---------------------------------------------------------------------------
// Navigation definition
// ---------------------------------------------------------------------------

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Social",
    items: [
      { label: "Inbox", href: "/inbox", icon: Inbox },
      { label: "Approvals", href: "/approvals", icon: CheckSquare },
    ],
  },
  {
    title: "Content",
    items: [
      { label: "Library", href: "/content/library", icon: Library },
      { label: "Templates", href: "/content/templates", icon: FileText },
      { label: "New Post", href: "/posts/new", icon: FilePlus },
    ],
  },
  {
    title: "AI",
    items: [
      { label: "Generate", href: "/ai/generate", icon: Sparkles },
      { label: "Analytics", href: "/ai/analytics", icon: BrainCircuit },
      { label: "Optimizer", href: "/ai/optimizer", icon: Gauge },
    ],
  },
  {
    title: "Scheduling",
    items: [
      { label: "Calendar", href: "/scheduling", icon: CalendarDays },
      { label: "Queue", href: "/queue", icon: ListOrdered },
    ],
  },
  {
    title: "Analytics",
    items: [
      { label: "Overview", href: "/analytics", icon: BarChart3 },
      { label: "Insights", href: "/analytics/insights", icon: Lightbulb },
    ],
  },
  {
    title: "Admin",
    items: [
      { label: "Accounts", href: "/accounts", icon: Users },
      { label: "Channels", href: "/channels", icon: Link2 },
      { label: "Subscriptions", href: "/subscriptions", icon: CreditCard },
      { label: "Security", href: "/security", icon: ShieldCheck },
      { label: "Compliance", href: "/compliance", icon: ClipboardCheck },
      { label: "Executive", href: "/executive", icon: TrendingUp },
      { label: "Logs", href: "/logs", icon: ScrollText },
      { label: "Webhooks", href: "/webhooks", icon: Webhook },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // Exact match preferred; also highlight parent when on a sub-path
  return pathname === href || pathname.startsWith(href + "/");
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface NavLinkProps {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}

function NavLink({ item, pathname, collapsed }: NavLinkProps) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={[
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        "focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1",
        active ? "bg-indigo-600 text-white" : "text-gray-700 hover:bg-gray-100 hover:text-gray-900",
      ].join(" ")}
    >
      <Icon
        className={["h-4 w-4 shrink-0", active ? "text-white" : "text-gray-500"].join(" ")}
        aria-hidden="true"
      />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
      {!collapsed && item.badge !== undefined && item.badge > 0 && (
        <span className="ml-auto flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      )}
    </Link>
  );
}

interface CollapsibleGroupProps {
  group: NavGroup;
  pathname: string;
  collapsed: boolean;
}

function CollapsibleGroup({ group, pathname, collapsed }: CollapsibleGroupProps) {
  // Groups default to open if any child is active
  const hasActive = group.items.some((item) => isActive(pathname, item.href));
  const [open, setOpen] = useState(hasActive);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  // When the sidebar itself is collapsed to icon-only, skip group headers
  // and render all items flat so icons stay visible
  if (collapsed) {
    return (
      <div className="space-y-1">
        {group.items.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={[
          "flex w-full items-center justify-between px-3 py-1.5",
          "text-xs font-semibold uppercase tracking-wider text-gray-400",
          "hover:text-gray-600 focus:outline-hidden focus:ring-2 focus:ring-indigo-500",
          "rounded-md transition-colors",
        ].join(" ")}
      >
        <span>{group.title}</span>
        {open ? (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="mt-1 space-y-1">
          {group.items.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

async function fetchInboxUnread(): Promise<number> {
  try {
    const res = await fetch("/api/backend/inbox/unread-count", { cache: "no-store" });
    if (!res.ok) return 0;
    const data = (await res.json()) as { ok: boolean; value?: { count: number } };
    return data.ok && data.value ? data.value.count : 0;
  } catch {
    return 0;
  }
}

export function SidebarNav() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const { data: inboxUnread = 0 } = useQuery({
    queryKey: ["inbox", "unread-count"],
    queryFn: fetchInboxUnread,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const toggleCollapsed = useCallback(() => setCollapsed((prev) => !prev), []);

  const sidebarWidth = collapsed ? "w-16" : "w-64";

  return (
    <aside
      aria-label="Main navigation"
      className={[
        sidebarWidth,
        "shrink-0 bg-white border-r border-gray-200",
        "flex flex-col min-h-screen",
        "transition-[width] duration-200 ease-in-out",
      ].join(" ")}
    >
      {/* Brand + collapse toggle */}
      <div
        className={[
          "flex items-center border-b border-gray-200 py-4",
          collapsed ? "justify-center px-2" : "justify-between px-4",
        ].join(" ")}
      >
        {!collapsed && <span className="text-base font-bold text-gray-900 truncate">OmniPost</span>}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={[
            "rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700",
            "focus:outline-hidden focus:ring-2 focus:ring-indigo-500",
            "transition-colors",
          ].join(" ")}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-5 w-5" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Dashboard link (standalone, above groups) */}
      <div className="px-3 pt-4 pb-2">
        <NavLink
          item={{ label: "Dashboard", href: "/", icon: LayoutDashboard }}
          pathname={pathname}
          collapsed={collapsed}
        />
      </div>

      {/* Scrollable nav groups */}
      <nav aria-label="Sidebar navigation" className="flex-1 overflow-y-auto px-3 pb-4 space-y-4">
        {NAV_GROUPS.map((group) => {
          // Inject dynamic badges into the Social group
          const enrichedGroup: NavGroup =
            group.title === "Social"
              ? {
                  ...group,
                  items: group.items.map((item) =>
                    item.href === "/inbox" ? { ...item, badge: inboxUnread } : item
                  ),
                }
              : group;

          return (
            <CollapsibleGroup
              key={group.title}
              group={enrichedGroup}
              pathname={pathname}
              collapsed={collapsed}
            />
          );
        })}
      </nav>
    </aside>
  );
}
