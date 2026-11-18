"use client";

import { BarChart3Icon, BookOpenIcon, FileTextIcon, LibraryIcon, SettingsIcon, UserRoundIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { SidebarLink } from "./sidebar-link";

const ITEMS = [
  { title: "Poems", href: "/admin", icon: FileTextIcon, match: (p: string) => p === "/admin" || p.startsWith("/admin/poems") },
  { title: "Novels", href: "/admin/novels", icon: BookOpenIcon, match: (p: string) => p.startsWith("/admin/novels") },
  { title: "Collections", href: "/admin/collections", icon: LibraryIcon, match: (p: string) => p.startsWith("/admin/collections") },
  { title: "Stats", href: "/admin/stats", icon: BarChart3Icon, match: (p: string) => p.startsWith("/admin/stats") },
  { title: "Profile", href: "/admin/profile", icon: UserRoundIcon, match: (p: string) => p.startsWith("/admin/profile") },
  { title: "Settings", href: "/admin/settings", icon: SettingsIcon, match: (p: string) => p.startsWith("/admin/settings") },
];

/** Main navigation. Reads the URL, so the layout renders it inside Suspense. */
export function NavMain() {
  return <NavMainItems pathname={usePathname()} />;
}

/** Same list without an active item: the Suspense fallback. */
export function NavMainItems({ pathname }: { pathname: string | null }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Manage</SidebarGroupLabel>
      <SidebarMenu>
        {ITEMS.map(({ title, href, icon: Icon, match }) => {
          const active = pathname != null && match(pathname);
          return (
            <SidebarMenuItem key={href}>
              <SidebarMenuButton asChild isActive={active} tooltip={title}>
                <SidebarLink href={href} aria-current={active ? "page" : undefined}>
                  <Icon />
                  <span>{title}</span>
                </SidebarLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
