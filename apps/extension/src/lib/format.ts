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
