"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * A `next/link` for anything inside the dashboard sidebar. On phones the
 * sidebar is a drawer (Sheet) that would otherwise stay open over the page
 * it just navigated to, so a click closes it. Clicks that open a new tab
 * leave it alone. Works with `asChild` (SidebarMenuButton, DropdownMenuItem):
 * their props, including their own onClick, are passed through.
 */
export function SidebarLink({ onClick, ...props }: ComponentProps<typeof Link>) {
  const { isMobile, setOpenMobile } = useSidebar();

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || !isMobile) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    setOpenMobile(false);
  };

  return <Link {...props} onClick={handleClick} />;
}
