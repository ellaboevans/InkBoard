"use client";

import { CalendarClockIcon, CalendarIcon, Loader2Icon } from "lucide-react";
import { useId, useState } from "react";
import { FormSelect } from "@/components/form-controls";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  dayKey,
  defaultScheduleTime,
  localDateTime,
  SCHEDULE_MAX_DAYS,
  scheduleLabel,
  scheduleProblem,
  scheduleTimes,
} from "@/lib/chapter-schedule";

const TOUCH = "max-sm:h-11";
const TIMES = scheduleTimes().map((t) => ({ value: t, label: t }));

/**
 * "Schedule…" / "Reschedule…" (Phase 28): a day from the calendar (in a
 * Popover) and a time in 15-minute steps (the shadcn Select), both in the
 * writer's own time zone, which only the browser knows; the dialog turns them
 * into an instant (ISO, UTC) for the server. It submits the chapter editor's
 * own form (`formId`): a schedule saves the title and text with it, as
 * "Publish chapter" does. The server checks the time again by its own clock.
 *
 * Content mounts only while open, so nothing here renders on the server.
 */
export function ScheduleDialog({
  formId,
  scheduledAt,
  pending,
  open,
  onOpenChange,
}: {
  formId: string;
  scheduledAt: string | null;
  pending: boolean;
  /** Controlled by the editor, which closes it once a schedule is saved. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={pending} className={`${TOUCH} max-sm:flex-1`}>
          <CalendarClockIcon />
          {scheduledAt ? "Reschedule…" : "Schedule…"}
        </Button>
      </DialogTrigger>
      {open && (
        <DialogContent className="sm:max-w-md">
          <ScheduleForm formId={formId} scheduledAt={scheduledAt} pending={pending} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function ScheduleForm({ formId, scheduledAt, pending }: { formId: string; scheduledAt: string | null; pending: boolean }) {
  const ids = useId();
  // The dialog opens on a user's click, in the browser: reading the clock and the zone here is fine.
  const [now] = useState(() => new Date());
  const initial = scheduledAt ? new Date(scheduledAt) : defaultScheduleTime(now);
  const [day, setDay] = useState<Date>(() => new Date(initial.getFullYear(), initial.getMonth(), initial.getDate()));
  const [time, setTime] = useState(() => `${String(initial.getHours()).padStart(2, "0")}:${String(initial.getMinutes() - (initial.getMinutes() % 15)).padStart(2, "0")}`);
  const [dayOpen, setDayOpen] = useState(false);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const at = localDateTime(dayKey(day), time);
  const problem = scheduleProblem(at, new Date());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const last = new Date(today.getTime() + SCHEDULE_MAX_DAYS * 86_400_000);
  const dayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(day);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{scheduledAt ? "Reschedule this chapter" : "Schedule this chapter"}</DialogTitle>
        <DialogDescription>
          It goes live by itself at this time. Until then readers see nothing of it, as with a draft. Times are in your time
          zone ({zone}).
        </DialogDescription>
      </DialogHeader>
      {/* The dialog's own form (never submitted): the controls live inside a form, as FormSelect expects. */}
      <form className="grid items-start gap-4 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
        <div className="grid gap-2">
          <Label htmlFor={`${ids}-day`}>Day</Label>
          <Popover open={dayOpen} onOpenChange={setDayOpen}>
            <PopoverTrigger asChild>
              <Button id={`${ids}-day`} type="button" variant="outline" className={`justify-start font-normal ${TOUCH}`}>
                <CalendarIcon />
                {dayLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={day}
                defaultMonth={day}
                startMonth={today}
                endMonth={last}
                disabled={[{ before: today }, { after: last }]}
                weekStartsOn={1}
                required
                onSelect={(d) => {
                  if (d) setDay(d);
                  setDayOpen(false);
                }}
                className="[--cell-size:--spacing(10)] sm:[--cell-size:--spacing(9)]"
              />
            </PopoverContent>
          </Popover>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${ids}-time`}>Time</Label>
          <FormSelect
            id={`${ids}-time`}
            value={time}
            onValueChange={setTime}
            options={TIMES}
            contentClassName="max-h-72"
            aria-describedby={`${ids}-when`}
            aria-invalid={problem ? true : undefined}
          />
        </div>
        <p id={`${ids}-when`} className={`text-sm sm:col-span-2 ${problem ? "text-destructive" : "text-muted-foreground"}`} role={problem ? "alert" : undefined}>
          {problem ?? (at ? `Goes live ${scheduleLabel(at, now)}.` : "")}
        </p>
      </form>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" className={TOUCH}>
            Cancel
          </Button>
        </DialogClose>
        {/* Submits the editor's form (title, text and this time together). */}
        <input type="hidden" name="releaseAt" form={formId} value={at && !problem ? at.toISOString() : ""} />
        <Button
          type="submit"
          form={formId}
          name="status"
          value="schedule"
          aria-disabled={Boolean(problem) || pending || undefined}
          onClick={(e) => {
            if (problem || pending) e.preventDefault();
          }}
          className={TOUCH}
        >
          {pending && <Loader2Icon className="animate-spin" />}
          {scheduledAt ? "Reschedule" : "Schedule"}
        </Button>
      </DialogFooter>
    </>
  );
}
