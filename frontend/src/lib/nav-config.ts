// Navigation configuration — kept in its own file so app-shell.tsx only
// exports React components, satisfying Vite's Fast Refresh requirement.
import {
  BarChart3, Bot, CalendarDays, Crown, GalleryHorizontal, Images,
  Link2, Megaphone, Package, Palette, ShieldCheck, Sparkles,
  type LucideIcon,
} from "lucide-react";

export const NAV: {
  section: string;
  items: { to: string; label: string; icon: LucideIcon; capability?: string; hintKey?: string }[];
}[] = [
  {
    section: "Create",
    items: [
      { to: "/app", label: "Create Ad", icon: Sparkles, hintKey: "nav:create-ad" },
      { to: "/app/campaigns", label: "Campaigns", icon: Megaphone, capability: "view_campaigns", hintKey: "nav:campaigns" },
    ],
  },
  {
    section: "Library",
    items: [
      { to: "/app/my-ads", label: "My Ads", icon: Images, capability: "view_my_ads", hintKey: "nav:my-ads" },
      { to: "/app/products", label: "Products", icon: Package, hintKey: "nav:products" },
      { to: "/app/themes-gallery", label: "Themes", icon: GalleryHorizontal, hintKey: "nav:themes-gallery" },
      { to: "/app/calendar", label: "Calendar", icon: CalendarDays, capability: "view_my_ads", hintKey: "nav:calendar" },
      { to: "/app/agent-niva", label: "Agent Niva", icon: Bot, hintKey: "nav:agent-niva" },
    ],
  },
  {
    section: "Setup",
    items: [
      { to: "/app/brand-kit", label: "Brand Kit", icon: Palette, capability: "view_brand_kit", hintKey: "nav:brand-kit" },
      { to: "/app/connections", label: "Connections", icon: Link2, capability: "admin-only", hintKey: "nav:connections" },
      { to: "/app/moderation", label: "Moderation", icon: ShieldCheck, capability: "admin-only", hintKey: "nav:moderation" },
    ],
  },
  {
    section: "Insights",
    items: [
      { to: "/app/analytics", label: "Analytics", icon: BarChart3, capability: "view_analytics", hintKey: "nav:analytics" },
      { to: "/app/admin", label: "Admin", icon: Crown, capability: "admin-only", hintKey: "nav:admin" },
    ],
  },
];
