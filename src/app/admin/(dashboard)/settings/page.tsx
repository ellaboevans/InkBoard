import type { Metadata } from "next";
import { Suspense } from "react";
import { requireOnboardedEditor } from "@/server/auth/dal";
import { getPasswordSettings } from "@/server/password-settings";
import { PasswordSettingsForm } from "./password-settings-form";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="mx-auto grid max-w-2xl gap-8">
      <div>
        <h1 className="font-serif text-3xl">Settings</h1>
        <p className="mt-1 text-muted-foreground">How readers get into your private poems.</p>
      </div>
      <Suspense fallback={<div className="h-72 animate-pulse rounded-xl bg-muted" />}>
        <Settings />
      </Suspense>
    </div>
  );
}

async function Settings() {
  const editor = await requireOnboardedEditor();
  const settings = await getPasswordSettings(editor.id);
  return <PasswordSettingsForm key={settings.mode} {...settings} />;
}
