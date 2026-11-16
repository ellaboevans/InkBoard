"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { AVATARS, avatarUrl, type AvatarId } from "@/lib/avatars";
import { notify, withErrorToast } from "@/lib/notify";
import { BIO_MAX, LINKS_MAX, PEN_NAME_MAX, PEN_NAME_MIN, TAGLINE_MAX } from "@/lib/profile-limits";
import { saveProfileAction, type ProfileState } from "./actions";
import { SpecialLetters } from "@/components/special-letters";

/** Fields the Special letters bar types into (the last one used). */
const PEN_NAME_AND_BIO = ["bio", "penName"];

type Values = {
  penName: string;
  tagline: string;
  bio: string;
  avatar: AvatarId;
  links: string[];
  pinnedPoemId: string;
};

const LINK_LABELS = ["Website", "Link 2", "Link 3", "Link 4"];

const padLinks = (links: string[]) =>
  Array.from({ length: LINKS_MAX }, (_, i) => links[i] ?? "");

export function ProfileForm({
  initial,
  avatarChosen,
  slug,
  publishedPoems,
}: {
  initial: { penName: string; tagline: string | null; bio: string | null; avatar: AvatarId; links: string[]; pinnedPoemId: string | null };
  /**
   * Whether the editor has ever picked an avatar (editors.avatar set). Until
   * they do, the radios show the default derived from their id but post
   * nothing, so saving a bio doesn't count as choosing an avatar (the
   * dashboard checklist's "Pick an avatar", Phase 20).
   */
  avatarChosen: boolean;
  slug: string;
  publishedPoems: { id: string; title: string }[];
}) {
  const toValues = (p: typeof initial): Values => ({
    penName: p.penName,
    tagline: p.tagline ?? "",
    bio: p.bio ?? "",
    avatar: p.avatar,
    links: padLinks(p.links),
    pinnedPoemId: p.pinnedPoemId ?? "",
  });

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
  const [values, setValues] = useState<Values>(() => toValues(initial));
  const [saved, setSaved] = useState<Values>(() => toValues(initial));
  // Any tap on an avatar is a choice, even of the default one.
  const [picked, setPicked] = useState(false);
  const [seenState, setSeenState] = useState(state);
  if (seenState !== state) {
    setSeenState(state);
    if (state.profile) {
      // Show what the server stored (trimmed, normalised links, …).
      const next = toValues({ ...state.profile, avatar: state.profile.avatar ?? values.avatar });
      setSaved(next);
      setValues(next);
    }
  }

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));
  // Picking the default avatar for the first time is a change too.
  const dirty = JSON.stringify(values) !== JSON.stringify(saved) || (picked && !avatarChosen);
  const errorFor = (field: NonNullable<ProfileState["field"]>) => (state.field === field ? state.error : undefined);

  return (
    <form action={action} className="grid gap-8 rounded-xl border bg-card p-6">
      <FieldSet id="avatar" className="scroll-mt-20">
        <FieldLegend>Avatar</FieldLegend>
        <FieldDescription>Pick the face that goes with your pen name.</FieldDescription>
        <div className="grid grid-cols-6 gap-2 sm:grid-cols-9 lg:grid-cols-12">
          {AVATARS.map((a, i) => (
            <label key={a.id} className="relative cursor-pointer">
              <input
                type="radio"
                name={avatarChosen || picked ? "avatar" : undefined}
                value={a.id}
                checked={values.avatar === a.id}
                onChange={() => set("avatar", a.id)}
                // A click, not a change: choosing the face already shown (the default) counts too.
                onClick={() => setPicked(true)}
                className="peer sr-only"
              />
              {/* eslint-disable-next-line @next/next/no-img-element -- tiny static SVG from our own route */}
              <img
                src={avatarUrl(a.id)}
                alt={`Avatar ${i + 1}`}
                width={56}
                height={56}
                loading="lazy"
                className="aspect-square w-full rounded-full bg-secondary ring-offset-2 ring-offset-card transition peer-checked:ring-3 peer-checked:ring-primary peer-focus-visible:ring-3 peer-focus-visible:ring-ring hover:opacity-85"
              />
            </label>
          ))}
        </div>
        {errorFor("avatar") && <FieldError>{errorFor("avatar")}</FieldError>}
      </FieldSet>

      <FieldSet>
        <FieldLegend>About you</FieldLegend>
        <FieldGroup>
          <Field data-invalid={errorFor("penName") ? true : undefined}>
            <FieldLabel htmlFor="penName">Pen name</FieldLabel>
            <Input
              id="penName"
              name="penName"
              value={values.penName}
              onChange={(e) => set("penName", e.target.value)}
              minLength={PEN_NAME_MIN}
              maxLength={PEN_NAME_MAX}
              required
              aria-invalid={errorFor("penName") ? true : undefined}
              aria-describedby="penName-help"
            />
            <FieldDescription id="penName-help">
              Labels your section on the board. Your poem links stay the same (
              <span className="font-mono">/p/{slug}/…</span>), so shared links keep working.
            </FieldDescription>
            {errorFor("penName") && <FieldError>{errorFor("penName")}</FieldError>}
          </Field>

          <Field data-invalid={errorFor("tagline") ? true : undefined}>
            <div className="flex items-baseline justify-between gap-2">
              <FieldLabel htmlFor="tagline">
                Tagline <span className="font-normal text-muted-foreground">(optional)</span>
              </FieldLabel>
              <span className="text-xs text-muted-foreground tabular-nums" aria-hidden>
                {values.tagline.length}/{TAGLINE_MAX}
              </span>
            </div>
            <Input
              id="tagline"
              name="tagline"
              value={values.tagline}
              onChange={(e) => set("tagline", e.target.value)}
              maxLength={TAGLINE_MAX}
              placeholder="e.g. Small poems about weather and kitchens"
              aria-invalid={errorFor("tagline") ? true : undefined}
            />
            {errorFor("tagline") && <FieldError>{errorFor("tagline")}</FieldError>}
          </Field>

          <Field data-invalid={errorFor("bio") ? true : undefined}>
            <div className="flex items-baseline justify-between gap-2">
              <FieldLabel htmlFor="bio">
                Bio <span className="font-normal text-muted-foreground">(optional)</span>
              </FieldLabel>
              <span className="text-xs text-muted-foreground tabular-nums" aria-hidden>
                {values.bio.length}/{BIO_MAX}
              </span>
            </div>
            <Textarea
              id="bio"
              name="bio"
              value={values.bio}
              onChange={(e) => set("bio", e.target.value)}
              maxLength={BIO_MAX}
              rows={4}
              placeholder="A line or two about you and your writing."
              aria-invalid={errorFor("bio") ? true : undefined}
            />
            {errorFor("bio") && <FieldError>{errorFor("bio")}</FieldError>}
          </Field>
          <SpecialLetters fields={PEN_NAME_AND_BIO} />
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Links</FieldLegend>
        <FieldDescription>Your website or social profiles. Secure (https) links only.</FieldDescription>
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          {values.links.map((link, i) => (
            <Field key={i}>
              <FieldLabel htmlFor={`link-${i}`} className="text-xs text-muted-foreground">
                {LINK_LABELS[i]}
              </FieldLabel>
              <Input
                id={`link-${i}`}
                name="links"
                type="text"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                value={link}
                onChange={(e) => set("links", values.links.map((l, j) => (j === i ? e.target.value : l)))}
                placeholder={i === 0 ? "https://example.com" : "https://"}
                aria-invalid={errorFor("links") ? true : undefined}
              />
            </Field>
          ))}
        </FieldGroup>
        {errorFor("links") && <FieldError>{errorFor("links")}</FieldError>}
      </FieldSet>

      <FieldSet>
        <FieldLegend>Pinned poem</FieldLegend>
        <Field data-invalid={errorFor("pinnedPoemId") ? true : undefined}>
          <FieldLabel htmlFor="pinnedPoemId" className="sr-only">
            Pinned poem
          </FieldLabel>
          <NativeSelect
            id="pinnedPoemId"
            name="pinnedPoemId"
            value={values.pinnedPoemId}
            onChange={(e) => set("pinnedPoemId", e.target.value)}
            disabled={publishedPoems.length === 0}
            aria-describedby="pinned-help"
          >
            <NativeSelectOption value="">None</NativeSelectOption>
            {publishedPoems.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription id="pinned-help">
            {publishedPoems.length === 0
              ? "Publish a poem to pin it here."
              : "Shown first on your public page. You can also pin from the poems list."}
          </FieldDescription>
          {errorFor("pinnedPoemId") && <FieldError>{errorFor("pinnedPoemId")}</FieldError>}
        </Field>
      </FieldSet>

      <div className="flex items-center justify-end gap-3 border-t pt-6">
        {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
        <Button type="submit" disabled={pending || !dirty}>
          {pending && <Loader2Icon className="animate-spin" />}
          Save profile
        </Button>
      </div>
    </form>
  );
}
