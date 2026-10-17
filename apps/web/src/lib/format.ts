const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact relative time for lists: "Just now", "5m ago", "3h ago", "Yesterday", "Oct 14", "Oct 14, 2025". */
export const formatRelative = (date: Date, now: Date = new Date(), locale = "en-US"): string => {
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < MINUTE) return "Just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 2 * DAY) return "Yesterday";
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
};

export const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
  `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralForm}`;

/** Up to two initials for the avatar, e.g. "Chris Diomampo" -> "CD". */
export const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
