const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Compact list date: "Today, 9:42 AM", "Yesterday", "Oct 14" or "Oct 14, 2025". */
export const formatListDate = (iso: string, now: Date = new Date(), locale?: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (sameDay(date, now)) {
    return `Today, ${date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
};

/** Full timestamp for detail views, e.g. "Oct 16, 2026, 9:42 AM". */
export const formatFullDate = (iso: string, locale?: string): string =>
  new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

export const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
  `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;

/** Short source label for list rows: "This browser" or "Imported from Windows Desktop". */
export const sessionSourceLabel = (session: { sourceDeviceId: string | null; sourceDeviceName: string }): string =>
  session.sourceDeviceId !== null
    ? session.sourceDeviceName
    : session.sourceDeviceName
      ? `Imported from ${session.sourceDeviceName}`
      : "Imported";

/** Provenance sentence fragment for detail views: "From This browser" or "Imported from Windows Desktop". */
export const sessionOrigin = (session: { sourceDeviceId: string | null; sourceDeviceName: string }): string =>
  session.sourceDeviceId !== null ? `From ${session.sourceDeviceName}` : sessionSourceLabel(session);

export type DateBucket = "Today" | "Yesterday" | "Previous 7 days" | "Older";

/** Timeline grouping for recovery checkpoints (docs/UI_UX_DESIGN.md section 7). */
export const dateBucket = (iso: string, now: Date = new Date()): DateBucket => {
  const date = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (date.getTime() >= startOfToday) return "Today";
  if (date.getTime() >= startOfToday - day) return "Yesterday";
  if (date.getTime() >= startOfToday - 7 * day) return "Previous 7 days";
  return "Older";
};

export const formatTime = (iso: string, locale?: string): string =>
  new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
