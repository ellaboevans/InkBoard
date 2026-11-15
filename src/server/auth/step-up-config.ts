/** How long a step-up confirmation code is valid. Shared by step-up.ts and the email text. */
export const STEP_UP_TTL_SECONDS = 10 * 60;
/** How recently a session must have proved inbox access to replace recovery codes. */
export const STEP_UP_WINDOW_SECONDS = 10 * 60;
