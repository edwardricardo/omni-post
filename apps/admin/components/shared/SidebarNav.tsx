/**
 * @file SidebarNav.tsx
 * @description Collapsible sidebar navigation for the admin dashboard with i18n labels,
 *   theme toggle, language switcher, and help/admin-users links.
 *   Uses CSS custom-property design tokens for full theme support.
 * @layer presentation
 */
"use client";

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Gauge,
  TrendingUp,
  ShieldCheck,
  ClipboardCheck,
  ScrollText,
  Webhook,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Sun,
  HelpCircle,
  UserCog,
  Wrench,
  LogOut,
  ArrowRightLeft,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "@/providers/ThemeProvider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SidebarNavProps {
  userName?: string;
  userRole?: string;
}

interface NavItem {
  translationKey: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
}

interface NavGroup {
  translationKey: string;
  items: NavItem[];
}

// ---------------------------------------------------------------------------
// Navigation definition
// ---------------------------------------------------------------------------

const NAV_GROUPS: NavGroup[] = [
  {
    translationKey: "platform",
    items: [
      { translationKey: "accounts", href: "/accounts", icon: Users },
      { translationKey: "subscriptions", href: "/subscriptions", icon: CreditCard },
      { translationKey: "pricing", href: "/pricing", icon: Gauge },
      {
        translationKey: "gatewaySwitches",
        href: "/billing/gateway-switches",
        icon: ArrowRightLeft,
      },
      { translationKey: "analytics", href: "/analytics", icon: TrendingUp },
    ],
  },
  {
    translationKey: "operations",
    items: [
      { translationKey: "security", href: "/security", icon: ShieldCheck },
      { translationKey: "compliance", href: "/compliance", icon: ClipboardCheck },
      { translationKey: "logs", href: "/logs", icon: ScrollText },
      { translationKey: "webhooks", href: "/webhooks", icon: Webhook },
      { translationKey: "maintenance", href: "/maintenance", icon: Wrench },
      { translationKey: "users", href: "/users", icon: UserCog },
    ],
  },
  {
    translationKey: "configuration",
    items: [{ translationKey: "settings", href: "/settings", icon: Settings2 }],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function setLocaleCookie(locale: string): void {
  document.cookie = `NEXT_LOCALE=${locale};path=/;max-age=${365 * 24 * 60 * 60}`;
  window.location.reload();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface NavLinkProps {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  label: string;
}

function NavLink({ item, pathname, collapsed, label }: NavLinkProps) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={[
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        "focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-1",
        active
          ? "bg-[var(--sidebar-item-active)] text-[var(--sidebar-item-active-text)]"
          : "text-[var(--text-secondary)] hover:bg-[var(--sidebar-item-hover)] hover:text-[var(--text-primary)]",
      ].join(" ")}
    >
      <Icon
        className={[
          "h-4 w-4 shrink-0",
          active ? "text-[var(--sidebar-item-active-text)]" : "text-[var(--text-tertiary)]",
        ].join(" ")}
        aria-hidden="true"
      />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && item.badge !== undefined && item.badge > 0 && (
        <span className="ml-auto flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[var(--error)] px-1 text-[10px] font-bold text-white">
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
  title: string;
  itemLabels: Record<string, string>;
}

function CollapsibleGroup({
  group,
  pathname,
  collapsed,
  title,
  itemLabels,
}: CollapsibleGroupProps) {
  const hasActive = group.items.some((item) => isActive(pathname, item.href));
  const [open, setOpen] = useState(hasActive);
  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  if (collapsed) {
    return (
      <div className="space-y-1">
        {group.items.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            pathname={pathname}
            collapsed={collapsed}
            label={itemLabels[item.translationKey] ?? item.translationKey}
          />
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
          "text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]",
          "hover:text-[var(--text-secondary)] focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]",
          "rounded-md transition-colors",
        ].join(" ")}
      >
        <span>{title}</span>
        {open ? (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="mt-1 space-y-1">
          {group.items.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              pathname={pathname}
              collapsed={collapsed}
              label={itemLabels[item.translationKey] ?? item.translationKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * @component SidebarNav
 * @description Collapsible sidebar navigation for the admin dashboard with i18n labels,
 *   theme toggle, language switcher, grouped nav links, and user info footer.
 * @param props.userName - Display name shown in the sidebar footer
 * @param props.userRole - Role label shown below the user name
 */
export function SidebarNav({ userName, userRole }: SidebarNavProps) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  const toggleCollapsed = useCallback(() => setCollapsed((prev) => !prev), []);
  const sidebarWidth = collapsed ? "w-16" : "w-64";

  // Build translation map for items
  const itemLabels: Record<string, string> = {
    platform: t("platform"),
    operations: t("operations"),
    dashboard: t("dashboard"),
    accounts: t("accounts"),
    subscriptions: t("subscriptions"),
    pricing: t("pricing"),
    analytics: t("analytics"),
    security: t("security"),
    compliance: t("compliance"),
    logs: t("logs"),
    webhooks: t("webhooks"),
    maintenance: t("maintenance"),
    users: t("users"),
  };

  return (
    <aside
      aria-label="Main navigation"
      className={[
        sidebarWidth,
        "shrink-0 bg-[var(--sidebar-bg)] border-r border-[var(--sidebar-border)]",
        "flex flex-col min-h-screen",
        "transition-[width] duration-200 ease-in-out",
      ].join(" ")}
    >
      {/* Brand + collapse toggle */}
      <div
        className={[
          "flex items-center border-b border-[var(--sidebar-border)] py-4",
          collapsed ? "justify-center px-2" : "justify-between px-4",
        ].join(" ")}
      >
        {!collapsed && (
          <span className="text-base font-bold text-[var(--text-primary)] truncate">OmniPost</span>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? t("expandSidebar") : t("collapseSidebar")}
          className={[
            "rounded-md p-1.5 text-[var(--text-tertiary)]",
            "hover:bg-[var(--sidebar-item-hover)] hover:text-[var(--text-primary)]",
            "focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]",
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

      {/* Dashboard link */}
      <div className="px-3 pt-4 pb-2">
        <NavLink
          item={{ translationKey: "dashboard", href: "/", icon: LayoutDashboard }}
          pathname={pathname}
          collapsed={collapsed}
          label={t("dashboard")}
        />
      </div>

      {/* Scrollable nav groups */}
      <nav aria-label="Sidebar navigation" className="flex-1 overflow-y-auto px-3 pb-4 space-y-4">
        {NAV_GROUPS.map((group) => (
          <CollapsibleGroup
            key={group.translationKey}
            group={group}
            pathname={pathname}
            collapsed={collapsed}
            title={itemLabels[group.translationKey] ?? group.translationKey}
            itemLabels={itemLabels}
          />
        ))}
      </nav>

      {/* Bottom actions */}
      <div className="border-t border-[var(--sidebar-border)] px-3 py-3 space-y-1">
        {/* Help & Docs */}
        {!collapsed && (
          <Link
            href="/help"
            className={[
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              "text-[var(--text-secondary)] hover:bg-[var(--sidebar-item-hover)] hover:text-[var(--text-primary)]",
            ].join(" ")}
          >
            <HelpCircle className="h-4 w-4 text-[var(--text-tertiary)]" aria-hidden="true" />
            <span>{t("helpDocs")}</span>
          </Link>
        )}

        {/* Language switcher */}
        {!collapsed && (
          <div className="flex items-center gap-1 px-3 py-2">
            <button
              type="button"
              onClick={() => setLocaleCookie("en")}
              className={[
                "px-2 py-1 text-xs rounded-md transition-colors",
                locale === "en"
                  ? "bg-[var(--accent-subtle)] text-[var(--accent)] font-semibold"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
              ].join(" ")}
              aria-label={t("switchToEnglish")}
            >
              EN
            </button>
            <span className="text-[var(--text-tertiary)]">|</span>
            <button
              type="button"
              onClick={() => setLocaleCookie("es")}
              className={[
                "px-2 py-1 text-xs rounded-md transition-colors",
                locale === "es"
                  ? "bg-[var(--accent-subtle)] text-[var(--accent)] font-semibold"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
              ].join(" ")}
              aria-label={t("switchToSpanish")}
            >
              ES
            </button>
          </div>
        )}

        {/* User info */}
        {userName && (
          <div
            className={[
              "flex items-center gap-3 rounded-md px-3 py-2",
              collapsed ? "justify-center" : "",
            ].join(" ")}
          >
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-subtle)] text-xs font-bold text-[var(--accent)]"
              aria-hidden="true"
            >
              {userName.charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                  {userName}
                </span>
                {userRole && (
                  <span className="truncate text-xs text-[var(--text-tertiary)]">{userRole}</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Theme toggle */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? t("switchToLight") : t("switchToDark")}
          className={[
            "flex items-center gap-3 rounded-md px-3 py-2 w-full text-sm font-medium transition-colors",
            "text-[var(--text-secondary)] hover:bg-[var(--sidebar-item-hover)] hover:text-[var(--text-primary)]",
          ].join(" ")}
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4 text-[var(--text-tertiary)]" aria-hidden="true" />
          ) : (
            <Moon className="h-4 w-4 text-[var(--text-tertiary)]" aria-hidden="true" />
          )}
          {!collapsed && <span>{theme === "dark" ? t("lightMode") : t("darkMode")}</span>}
        </button>

        {/* Logout */}
        <form action="/api/clear-session" method="GET">
          <button
            type="submit"
            aria-label={tc("logout")}
            className={[
              "flex items-center gap-3 rounded-md px-3 py-2 w-full text-sm font-medium transition-colors",
              "text-[var(--error)] hover:bg-[var(--error-subtle)] hover:text-[var(--error)]",
              "focus:outline-hidden focus:ring-2 focus:ring-[var(--error)]",
            ].join(" ")}
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!collapsed && <span>{tc("logout")}</span>}
          </button>
        </form>
      </div>
    </aside>
  );
}
