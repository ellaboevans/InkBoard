import { ExternalLinkIcon, FeatherIcon, PlusIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminBreadcrumb } from "@/components/admin/admin-breadcrumb";
import { NavMain, NavMainItems } from "@/components/admin/nav-main";
import { NavUser } from "@/components/admin/nav-user";
import { SidebarLink } from "@/components/admin/sidebar-link";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { avatarIdFor } from "@/lib/avatars";
import { getCurrentEditor } from "@/server/auth/dal";
import { InstallSlot } from "@/components/install/install-nudge";

// The editor dashboard is private: keep it out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Editor dashboard shell (shadcn sidebar-08: inset variant). On desktop the
 * sidebar collapses to icons (⌘B / Ctrl+B); on phones it is a drawer.
 * The shell is static; the session-aware user menu streams in behind Suspense.
 */
export default function DashboardLayout({ children }: LayoutProps<"/admin">) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar variant="inset" collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" asChild tooltip="InkBoard dashboard">
                  <SidebarLink href="/admin">
                    <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                      <FeatherIcon className="size-4" aria-hidden />
                    </span>
                    <span className="grid flex-1 text-left leading-tight">
                      <span className="truncate font-serif text-base">InkBoard</span>
                      <span className="truncate text-xs text-muted-foreground">Editor</span>
                    </span>
                  </SidebarLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip="New poem"
                    className="bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                  >
                    <SidebarLink href="/admin/poems/new">
                      <PlusIcon />
                      <span>New poem</span>
                    </SidebarLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
            <Suspense fallback={<NavMainItems pathname={null} />}>
              <NavMain />
            </Suspense>
            <SidebarGroup className="mt-auto">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild size="sm" tooltip="View the board">
                    <SidebarLink href="/">
                      <ExternalLinkIcon />
                      <span>View the board</span>
                    </SidebarLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <Suspense fallback={<SidebarMenuSkeleton showIcon />}>
              <CurrentUser />
            </Suspense>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 md:px-6">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-vertical:h-4 data-vertical:self-auto" />
            <Suspense fallback={null}>
              <AdminBreadcrumb />
            </Suspense>
          </header>
          <div className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</div>
          {/* The writer's install card (after a first publish, or from the account menu): bottom on phones, bottom-right on wide screens. */}
          <InstallSlot
            kind="editor"
            className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex justify-center empty:hidden sm:right-6 sm:left-auto sm:w-[23.25rem]"
          />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

async function CurrentUser() {
  const editor = await getCurrentEditor();
  // Pages redirect signed-out or not-yet-onboarded editors themselves.
  if (!editor?.penName) return null;
  return <NavUser user={{ penName: editor.penName, email: editor.email, avatarId: avatarIdFor(editor) }} />;
}
