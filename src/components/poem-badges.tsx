import { GlobeIcon, LockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: "draft" | "published" }) {
  return status === "published" ? (
    <Badge>Published</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Draft
    </Badge>
  );
}

export function VisibilityBadge({ visibility }: { visibility: "public" | "private" }) {
  return visibility === "private" ? (
    <Badge variant="secondary">
      <LockIcon aria-hidden />
      Private
    </Badge>
  ) : (
    <Badge variant="ghost" className="text-muted-foreground">
      <GlobeIcon aria-hidden />
      Public
    </Badge>
  );
}
