"use client";

import { FlagIcon } from "lucide-react";
import { usePathname } from "next/navigation";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { SidebarLink } from "./sidebar-link";

/**
 * "Owner" in the sidebar (docs/PLAN.md, Phase 32 round 3). The layout renders
 * it only for the owner (getOwnerSession, behind Suspense): a hint, not the
 * check. The page and its actions call requireOwner() themselves.
 */
export function NavOwner() {
  const active = usePathname().startsWith("/admin/owner");
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Owner</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild isActive={active} tooltip="Reports">
            <SidebarLink href="/admin/owner" aria-current={active ? "page" : undefined}>
              <FlagIcon />
              <span>Reports</span>
            </SidebarLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
