"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useTransition } from "react";
import { notify, UNEXPECTED_ERROR } from "@/lib/notify";
import { PUBLIC_DEVICE_PASSKEY } from "@/lib/passkey-messages";
import { isAlreadyRegistered, isCancelled } from "@/lib/webauthn-client";
import { finishPasskeyRegistrationAction, startPasskeyRegistrationAction } from "./passkey-actions";

/**
 * "Add a passkey": options from the server, the browser's create() prompt,
 * then verification and storage on the server. Shared by the profile's
 * Passkeys section and the dashboard's offer after a recovery-code sign-in.
 * A closed prompt is not an error; nothing happens.
 */
export function useAddPasskey({ onStepUp, onAdded }: { onStepUp: () => void; onAdded?: (name: string) => void }) {
  const [pending, startTransition] = useTransition();
  const add = () =>
    startTransition(async () => {
      try {
        const start = await startPasskeyRegistrationAction();
        if (!start.ok) {
          if (start.reason === "step_up") onStepUp();
          else notify.error("Couldn't add a passkey", start.reason === "public_device" ? PUBLIC_DEVICE_PASSKEY : start.message);
          return;
        }
        let response;
        try {
          response = await startRegistration({ optionsJSON: start.options });
        } catch (err) {
          if (isCancelled(err)) return;
          if (isAlreadyRegistered(err)) {
            notify.info("Already set up", "This device already has a passkey for your account.");
            return;
          }
          notify.error("Couldn't add a passkey", "This browser or device couldn't make a passkey. Please try again.");
          return;
        }
        const res = await finishPasskeyRegistrationAction(response);
        if (res.ok) {
          notify.success("Passkey added", `“${res.name}” can now sign you in.`);
          onAdded?.(res.name);
        } else if (res.reason === "step_up") onStepUp();
        else notify.error("Couldn't add a passkey", res.reason === "public_device" ? PUBLIC_DEVICE_PASSKEY : res.message);
      } catch {
        notify.error(UNEXPECTED_ERROR.title, UNEXPECTED_ERROR.description);
      }
    });
  return { add, pending };
}
