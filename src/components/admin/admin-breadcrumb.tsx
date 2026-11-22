"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

function crumbsFor(pathname: string): { label: string; href?: string }[] {
  if (pathname.startsWith("/admin/poems/new")) return [{ label: "Poems", href: "/admin" }, { label: "New poem" }];
  if (pathname.startsWith("/admin/poems/")) return [{ label: "Poems", href: "/admin" }, { label: "Edit poem" }];
  if (/^\/admin\/novels\/[^/]+\/chapters\//.test(pathname)) {
    const novel = pathname.split("/").slice(0, 4).join("/");
    return [{ label: "Novels", href: "/admin/novels" }, { label: "Novel", href: novel }, { label: "Edit chapter" }];
  }
  if (pathname.startsWith("/admin/novels/")) return [{ label: "Novels", href: "/admin/novels" }, { label: "Edit novel" }];
  if (pathname.startsWith("/admin/novels")) return [{ label: "Novels" }];
  if (pathname.startsWith("/admin/collections/")) return [{ label: "Collections", href: "/admin/collections" }, { label: "Edit collection" }];
  if (pathname.startsWith("/admin/collections")) return [{ label: "Collections" }];
  if (pathname.startsWith("/admin/profile")) return [{ label: "Profile" }];
  if (pathname.startsWith("/admin/settings")) return [{ label: "Settings" }];
  if (pathname.startsWith("/admin/stats")) return [{ label: "Stats" }];
  if (pathname.startsWith("/admin/owner")) return [{ label: "Owner" }, { label: "Reports" }];
  return [{ label: "Poems" }];
}

/** Reads the URL, so the layout renders it inside Suspense. */
export function AdminBreadcrumb() {
  const crumbs = crumbsFor(usePathname());
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((c, i) => (
          <Fragment key={c.label}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {c.href ? (
                <BreadcrumbLink asChild>
                  <Link href={c.href}>{c.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{c.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
