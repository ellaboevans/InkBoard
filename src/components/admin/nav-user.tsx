"use client";

import { ChevronsUpDownIcon, Loader2Icon, LogOutIcon, SettingsIcon, UserRoundIcon } from "lucide-react";
import { useTransition } from "react";
import { signOutAction } from "@/app/admin/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { SidebarLink } from "./sidebar-link";
import type { AuthorPicture as Picture } from "@/lib/author-picture";
import { AuthorPicture } from "@/components/author/author-picture";
import { notify } from "@/lib/notify";
import { InstallMenuItem } from "@/components/install/install-nudge";

type User = { penName: string; email: string; picture: Picture };

function Identity({ user }: { user: User }) {
  return (
    <>
      <AuthorPicture picture={user.picture} size={32} className="size-8" />
      <span className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-medium">{user.penName}</span>
        <span className="truncate text-xs text-muted-foreground">{user.email}</span>
      </span>
    </>
  );
}

export function NavUser({ user }: { user: User }) {
  const { isMobile } = useSidebar();
  const [signingOut, startTransition] = useTransition();

  const signOut = () =>
    startTransition(async () => {
      try {
        await signOutAction();
      } catch {
        notify.error("Couldn't sign you out", "Please check your connection and try again.");
        return;
      }
      // Full page load, not router.push: discards every client-side route
      // kept alive in <Activity> (and its poem text) from this tab.
      window.location.replace("/sign-in?signed-out=1");
    });

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <span className="sr-only">Account menu:</span>
              <Identity user={user} />
              <ChevronsUpDownIcon className="ml-auto size-4" aria-hidden />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5">
                <Identity user={user} />
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <SidebarLink href="/admin/profile">
                  <UserRoundIcon />
                  Profile
                </SidebarLink>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <SidebarLink href="/admin/settings">
                  <SettingsIcon />
                  Settings
                </SidebarLink>
              </DropdownMenuItem>
              {/* Only where installing is possible (and not in the installed app). */}
              <InstallMenuItem />
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={signingOut}
              onSelect={(e) => {
                e.preventDefault(); // keep the menu open while signing out
                signOut();
              }}
            >
              {signingOut ? <Loader2Icon className="animate-spin" /> : <LogOutIcon />}
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
