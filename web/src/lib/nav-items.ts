import { LayoutDashboard, BriefcaseBusiness, ListChecks, MessageSquare, UserRound, Compass, Radar, BarChart3, FileText, Settings } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

// Single source of truth for the app's primary destinations — shared by the
// desktop sidebar and the mobile nav so they can never drift.
export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  chip?: string;
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Today", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
  { href: "/applications", label: "Applications", icon: ListChecks },
  { href: "/outreach", label: "Outreach", icon: MessageSquare },
  { href: "/profile", label: "Profile", icon: UserRound },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/pipeline", label: "Legacy Pipeline", icon: ListChecks },
  { href: "/portals", label: "Portals", icon: Radar },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/cv", label: "CV", icon: FileText },
  { href: "/config", label: "Config", icon: Settings },
];

export function isActivePath(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
