import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { buttonClass } from "./modal";

export interface SplitButtonOption<V extends string> {
  value: V;
  label: string;
}

interface SplitButtonProps<V extends string> {
  /** The main button's text; it acts on the chosen option. */
  label: ReactNode;
  onClick: () => void;
  /** Disables the main button only, so the choice can still change. */
  disabled?: boolean;
  menuDisabled?: boolean;
  options: SplitButtonOption<V>[];
  value: V;
  /** Choosing an option changes what the main button does; it doesn't act by itself. */
  onSelect: (value: V) => void;
  /** Accessible name of the menu and its toggle, e.g. "Choose where to open". */
  menuLabel: string;
}

/**
 * Primary button plus a menu of choices for it (radio items). The menu is `position: fixed`, placed
 * from the toggle and flipped above it near the bottom, so a scroll area can't clip it and it can't
 * make the page (or the popup) taller.
 */
export function SplitButton<V extends string>({ label, onClick, disabled, menuDisabled, options, value, onSelect, menuLabel }: SplitButtonProps<V>) {
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const open = position !== null;

  const show = () => {
    const rect = toggle.current?.getBoundingClientRect();
    if (!rect) return;
    const menuHeight = options.length * 40 + 16;
    const fitsBelow = window.innerHeight - rect.bottom >= menuHeight;
    setPosition({
      position: "fixed",
      right: window.innerWidth - rect.right,
      ...(fitsBelow ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }),
    });
  };
  const close = (refocus: boolean) => {
    setPosition(null);
    if (refocus) toggle.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const dismiss = (event: Event) => {
      if (event.type === "pointerdown" && (menu.current?.contains(event.target as Node) || toggle.current?.contains(event.target as Node))) return;
      setPosition(null);
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => items[(next + items.length) % items.length]?.focus();
    if (event.key === "Escape") close(true);
    else if (event.key === "Tab") close(false);
    else if (event.key === "ArrowDown") focusAt(index + 1);
    else if (event.key === "ArrowUp") focusAt(index - 1);
    else if (event.key === "Home") focusAt(0);
    else if (event.key === "End") focusAt(-1);
    else return;
    if (event.key !== "Tab") event.preventDefault();
  };

  return (
    <div className="inline-flex min-w-0">
      <button type="button" className={`${buttonClass.primary} min-w-0 rounded-r-none`} disabled={disabled} onClick={onClick}>
        {label}
      </button>
      <button
        ref={toggle}
        type="button"
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={menuDisabled}
        onClick={() => (open ? close(false) : show())}
        className={`${buttonClass.primary} rounded-l-none border-l border-on-brand/30 px-2`}
      >
        <ChevronDown aria-hidden="true" className="size-4" />
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          role="menu"
          aria-label={menuLabel}
          style={position}
          onKeyDown={onMenuKeyDown}
          className="z-50 min-w-52 rounded-lg border border-line bg-surface p-1 text-fg shadow-lg"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === value}
              tabIndex={-1}
              onClick={() => {
                onSelect(option.value);
                close(true);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-surface-muted focus:bg-surface-muted"
            >
              <Check aria-hidden="true" className={`size-4 shrink-0 ${option.value === value ? "text-brand" : "invisible"}`} />
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
