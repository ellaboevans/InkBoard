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
  if (pathname.startsWith("/admin/profile")) return [{ label: "Profile" }];
  if (pathname.startsWith("/admin/settings")) return [{ label: "Settings" }];
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
