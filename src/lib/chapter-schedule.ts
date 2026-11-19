/**
 * Scheduled chapters (docs/PLAN.md, Phase 28): the rules shared by the
 * writer's schedule dialog (browser) and novels.ts (server). Pure, no imports.
 *
 * Times are stored in UTC. The writer picks a day and a time in their own
 * time zone, which only the browser knows: the dialog turns them into an
 * instant (localDateTime), and labels are formatted in the browser too
 * (scheduleLabel without a time zone), never on the server, so server HTML
 * never holds a time zone guess.
 */

/** The time picker's step, in minutes. */
export const SCHEDULE_STEP_MINUTES = 15;
/** A schedule must be at least this far ahead (checked again on the server, by the database clock). */
export const SCHEDULE_MIN_LEAD_MINUTES = 5;
/** And at most this far ahead. */
export const SCHEDULE_MAX_DAYS = 365;

export const SCHEDULE_TOO_SOON = `Pick a time at least ${SCHEDULE_MIN_LEAD_MINUTES} minutes from now.`;
export const SCHEDULE_TOO_LATE = "Pick a time within a year from now.";
export const SCHEDULE_INVALID = "Pick a day and a time.";

/** "00:00", "00:15", … "23:45". */
export function scheduleTimes(step = SCHEDULE_STEP_MINUTES): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += step) out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return out;
}

/** The instant of a local day ("2026-11-21") and time ("18:00") in this environment's time zone, or null. */
export function localDateTime(day: string, time: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const at = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]), 0, 0);
  // Reject days that don't exist (2026-02-30) and wall times skipped by a clock change.
  if (at.getFullYear() !== Number(d[1]) || at.getMonth() !== Number(d[2]) - 1 || at.getDate() !== Number(d[3])) return null;
  if (at.getHours() !== Number(t[1]) || at.getMinutes() !== Number(t[2])) return null;
  return at;
}

/** A local day as "YYYY-MM-DD" (the calendar's selection). */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The next step time at least SCHEDULE_MIN_LEAD_MINUTES + one step ahead: the dialog's default. */
export function defaultScheduleTime(now: Date, step = SCHEDULE_STEP_MINUTES): Date {
  const t = new Date(now.getTime() + (SCHEDULE_MIN_LEAD_MINUTES + step) * 60_000);
  t.setSeconds(0, 0);
  const rem = t.getMinutes() % step;
  if (rem) t.setMinutes(t.getMinutes() + (step - rem));
  return t;
}

/** Why this instant can't be a schedule (as the server says it), or null. */
export function scheduleProblem(at: Date | null, now: Date): string | null {
  if (!at || Number.isNaN(at.getTime())) return SCHEDULE_INVALID;
  if (at.getTime() < now.getTime() + SCHEDULE_MIN_LEAD_MINUTES * 60_000) return SCHEDULE_TOO_SOON;
  if (at.getTime() > now.getTime() + SCHEDULE_MAX_DAYS * 86_400_000) return SCHEDULE_TOO_LATE;
  return null;
}

/**
 * "Fri 21 Nov, 18:00" (24-hour, as the rest of the dashboard), with the year
 * when it isn't this year's. In the browser's time zone unless one is given.
 */
export function scheduleLabel(at: Date, now: Date, timeZone?: string): string {
  const yearOf = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone }).format(d));
  const day = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(yearOf(at) !== yearOf(now) && { year: "numeric" }),
    timeZone,
  }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(at);
  return `${day.replace(/,/g, "")}, ${time}`;
}
