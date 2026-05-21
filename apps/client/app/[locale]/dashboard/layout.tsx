"use client";

/**
 * @file layout.tsx
 * @description Dashboard layout wrapping authenticated pages with navigation, announcement banner,
 *              user menu, and project context provider.
 * @component DashboardLayout
 * @layer infrastructure
 */
import { useAuth } from "@/lib/auth/authContext";
import { ProjectProvider } from "@/providers/ProjectProvider";
import { AnnouncementBanner } from "@/components/announcements/AnnouncementBanner";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { Button } from "@packages/ui";
import { Avatar, AvatarFallback, AvatarInitial } from "@packages/ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@packages/ui";
import {
  LogOut,
  User,
  Settings,
  Home,
  FileText,
  BarChart3,
  Menu,
  Inbox,
  Calendar,
  Sparkles,
  CheckCircle,
  Image,
  Share2,
  ListTodo,
  ClipboardList,
  Megaphone,
  Puzzle,
  Shield,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  Recycle,
  Wand2,
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { usePathname } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ComponentType } from "react";

type IconType = ComponentType<{ className?: string }>;

interface NavItem {
  key: string;
  href?: string;
  icon: IconType;
  children?: ReadonlyArray<{ key: string; href: string; icon: IconType }>;
}

const navigation: ReadonlyArray<NavItem> = [
  { key: "dashboard", href: "/dashboard", icon: Home },
  { key: "posts", href: "/dashboard/posts", icon: FileText },
  { key: "inbox", href: "/dashboard/inbox", icon: Inbox },
  { key: "scheduling", href: "/dashboard/scheduling", icon: Calendar },
  { key: "analytics", href: "/dashboard/analytics", icon: BarChart3 },
  { key: "campaigns", href: "/dashboard/campaigns", icon: Megaphone },
  {
    key: "ai",
    icon: Sparkles,
    children: [
      { key: "aiGenerate", href: "/dashboard/ai/generate", icon: Sparkles },
      { key: "aiTrends", href: "/dashboard/ai/trends", icon: TrendingUp },
      { key: "aiRepurpose", href: "/dashboard/ai/repurpose", icon: Recycle },
      { key: "aiOptimizer", href: "/dashboard/ai/optimizer", icon: Wand2 },
      { key: "aiTemplates", href: "/dashboard/ai/templates", icon: FileText },
      { key: "aiAnalytics", href: "/dashboard/ai/analytics", icon: BarChart3 },
    ],
  },
  { key: "approvals", href: "/dashboard/approvals", icon: CheckCircle },
  { key: "assets", href: "/dashboard/assets", icon: Image },
  { key: "tasks", href: "/dashboard/tasks", icon: ClipboardList },
  { key: "queue", href: "/dashboard/queue", icon: ListTodo },
  { key: "channels", href: "/dashboard/channels", icon: Share2 },
  { key: "integrations", href: "/dashboard/integrations", icon: Puzzle },
  { key: "settings", href: "/dashboard/settings/brand-voice", icon: Settings },
  { key: "privacy", href: "/dashboard/settings/privacy", icon: Shield },
  { key: "aiSettings", href: "/dashboard/settings/ai", icon: BrainCircuit },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const t = useTranslations("nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aiExpanded, setAiExpanded] = useState(
    () => pathname?.startsWith("/dashboard/ai/") ?? false
  );

  useEffect(() => {
    if (pathname?.startsWith("/dashboard/ai/")) {
      setAiExpanded(true);
    }
  }, [pathname]);

  const handleLogout = async () => {
    await logout();
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Top Navigation */}
      <header className="border-b bg-card">
        <div className="flex h-16 items-center px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <Menu className="h-6 w-6" />
          </Button>

          <div className="flex-1">
            <h1 className="text-xl font-semibold text-foreground ml-2 lg:ml-0">OmniPost</h1>
          </div>

          {/* Notification Bell */}
          <div className="mr-2">
            <NotificationBell />
          </div>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarInitial>{user?.name?.charAt(0)?.toUpperCase() || "U"}</AvatarInitial>
                  <AvatarFallback>
                    <User className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <div className="flex items-center justify-start gap-2 p-2">
                <div className="flex flex-col space-y-1 leading-none">
                  {user?.name && <p className="font-medium">{user.name}</p>}
                  {user?.email && (
                    <p className="w-[200px] truncate text-sm text-muted-foreground">{user.email}</p>
                  )}
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/dashboard/settings">
                  <Settings className="mr-2 h-4 w-4" />
                  <span>{tCommon("settings")}</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOut className="mr-2 h-4 w-4" />
                <span>{tCommon("logout")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          lg:translate-x-0 transition-transform duration-200 ease-in-out
          fixed lg:static inset-y-0 left-0 z-50 w-64 bg-card border-r
          flex flex-col pt-16 lg:pt-0
        `}
        >
          <nav className="flex-1 space-y-1 p-4">
            {navigation.map((item) => {
              if (item.children) {
                const groupActive = pathname?.startsWith("/dashboard/ai/") ?? false;
                return (
                  <div key={item.key}>
                    <button
                      type="button"
                      aria-expanded={aiExpanded}
                      aria-controls={`nav-group-${item.key}`}
                      onClick={() => setAiExpanded((v) => !v)}
                      className={`
                        flex w-full items-center px-2 py-2 text-sm font-medium rounded-md transition-colors
                        ${
                          groupActive
                            ? "text-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        }
                      `}
                    >
                      <item.icon className="mr-3 h-5 w-5" />
                      <span className="flex-1 text-left">{t(item.key)}</span>
                      {aiExpanded ? (
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                    {aiExpanded ? (
                      <ul id={`nav-group-${item.key}`} className="mt-1 ml-6 space-y-1">
                        {item.children.map((child) => {
                          const isActive = pathname === child.href;
                          return (
                            <li key={child.key}>
                              <Link
                                href={child.href}
                                className={`
                                  flex items-center px-2 py-1.5 text-sm rounded-md transition-colors
                                  ${
                                    isActive
                                      ? "bg-primary text-primary-foreground"
                                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                  }
                                `}
                                onClick={() => setSidebarOpen(false)}
                              >
                                <child.icon className="mr-2 h-4 w-4" />
                                {t(child.key)}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                );
              }

              const href = item.href ?? "#";
              const isActive = pathname === href;
              return (
                <Link
                  key={item.key}
                  href={href}
                  className={`
                    flex items-center px-2 py-2 text-sm font-medium rounded-md transition-colors
                    ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }
                  `}
                  onClick={() => setSidebarOpen(false)}
                >
                  <item.icon className="mr-3 h-5 w-5" />
                  {t(item.key)}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 lg:ml-0">
          <div className="p-6">
            <AnnouncementBanner />
            <ProjectProvider>{children}</ProjectProvider>
          </div>
        </main>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label={tCommon("closeSidebar")}
          className="fixed inset-0 z-40 bg-black bg-opacity-25 lg:hidden cursor-default"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
