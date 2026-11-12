"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { notify, withErrorToast } from "@/lib/notify";
import { BIO_MAX, PEN_NAME_MAX, PEN_NAME_MIN } from "@/lib/profile-limits";
import { saveProfileAction, type ProfileState } from "./actions";

export function ProfileForm({
  penName: savedPenName,
  bio: savedBio,
  slug,
}: {
  penName: string;
  bio: string | null;
  slug: string;
}) {
  const [state, action, pending] = useActionState(
    withErrorToast(async (prev: ProfileState, formData: FormData) => {
      const next = await saveProfileAction(prev, formData);
      if (next.savedAt) notify.success("Profile saved");
      else if (next.error) notify.error("Couldn't save your profile", next.error);
      return next;
    }),
    {},
  );

  // Controlled inputs: React resets uncontrolled fields after an action,
  // which would wipe what the editor typed when validation fails.
  const [penName, setPenName] = useState(savedPenName);
  const [bio, setBio] = useState(savedBio ?? "");
  const [saved, setSaved] = useState({ penName: savedPenName, bio: savedBio ?? "" });
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.profile) {
      const next = { penName: state.profile.penName, bio: state.profile.bio ?? "" };
      setSaved(next);
      setPenName(next.penName);
      setBio(next.bio);
    }
  }

  const dirty = penName !== saved.penName || bio !== saved.bio;
  const penNameError = state.field === "penName" ? state.error : undefined;
  const bioError = state.field === "bio" ? state.error : undefined;

  return (
    <form action={action} className="grid gap-6 rounded-xl border bg-card p-6">
      <div className="grid gap-1.5">
        <Label htmlFor="penName">Pen name</Label>
        <Input
          id="penName"
          name="penName"
          value={penName}
          onChange={(e) => setPenName(e.target.value)}
          minLength={PEN_NAME_MIN}
          maxLength={PEN_NAME_MAX}
          required
          aria-invalid={penNameError ? true : undefined}
          aria-describedby={penNameError ? "penName-help penName-error" : "penName-help"}
        />
        <p id="penName-help" className="text-xs text-muted-foreground">
          Labels your section on the board. Your poem links stay the same (
          <span className="font-mono">/p/{slug}/…</span>), so shared links keep working.
        </p>
        {penNameError && (
          <p id="penName-error" role="alert" className="text-sm text-destructive">
            {penNameError}
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="bio">
            Bio <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <span className="text-xs text-muted-foreground tabular-nums" aria-hidden>
            {bio.length}/{BIO_MAX}
          </span>
        </div>
        <Textarea
          id="bio"
          name="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={BIO_MAX}
          rows={4}
          placeholder="A line or two about you and your writing."
          aria-invalid={bioError ? true : undefined}
          aria-describedby={bioError ? "bio-error" : undefined}
        />
        {bioError && (
          <p id="bio-error" role="alert" className="text-sm text-destructive">
            {bioError}
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !dirty}>
          {pending && <Loader2Icon className="animate-spin" />}
          Save profile
        </Button>
      </div>
    </form>
  );
}
