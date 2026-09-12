export const CADENCES = ["hourly", "daily", "weekly"] as const;
export type Cadence = (typeof CADENCES)[number];

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export interface ScheduleShape {
  cadence: Cadence;
  run_hour_utc: number;
  run_weekday: number;
}

/** Next run instant in UTC, strictly after `from`. */
export function nextRunAt(schedule: ScheduleShape, from: Date = new Date()): Date {
  const next = new Date(from.getTime());
  next.setUTCSeconds(0, 0);

  if (schedule.cadence === "hourly") {
    next.setUTCMinutes(0);
    next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }

  next.setUTCMinutes(0);
  next.setUTCHours(schedule.run_hour_utc);
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1);

  if (schedule.cadence === "weekly") {
    while (next.getUTCDay() !== schedule.run_weekday) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
  }
  return next;
}

export function describeSchedule(schedule: ScheduleShape): string {
  const hour = `${String(schedule.run_hour_utc).padStart(2, "0")}:00 UTC`;
  if (schedule.cadence === "hourly") return "Every hour, on the hour";
  if (schedule.cadence === "daily") return `Every day at ${hour}`;
  return `Every ${WEEKDAYS[schedule.run_weekday] ?? "Monday"} at ${hour}`;
}
