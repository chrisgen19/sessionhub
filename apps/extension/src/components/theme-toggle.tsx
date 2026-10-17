import { Monitor, Moon, Sun } from "lucide-react";
import { useId, useSyncExternalStore } from "react";
import { readThemePreference, setThemePreference, subscribeToThemePreference } from "@sessionhub/core/theme";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

/**
 * Light / Dark / System (docs/UI_UX_DESIGN.md 4.1). theme-init.js themes the page before React
 * loads; this shows and changes the choice. The popup and the manager share it (one origin).
 */
export function ThemeToggle() {
  const name = useId();
  const preference = useSyncExternalStore(subscribeToThemePreference, readThemePreference);

  return (
    <fieldset className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map(({ value, label, Icon }) => (
        <label
          key={value}
          title={label}
          className="grid size-7 cursor-pointer place-items-center rounded-md text-fg-muted hover:text-fg has-checked:bg-brand-soft has-checked:text-brand has-focus-visible:outline-2 has-focus-visible:outline-focus"
        >
          <input type="radio" name={name} value={value} checked={preference === value} onChange={() => setThemePreference(value)} className="sr-only" />
          <Icon aria-hidden="true" className="size-4" />
          <span className="sr-only">{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
