import { WORKSPACE_LIMITS } from "@sessionhub/contracts/api-workspaces";
import { tabGroupColorSchema, type TabGroupColor } from "@sessionhub/contracts/session";
import { useId } from "react";

export const inputClass = "h-9 w-full rounded-lg border border-line bg-canvas px-3 text-[13px]";
export const selectClass = "h-9 rounded-lg border border-line bg-canvas px-2 text-[13px] text-fg";

const COLOR_NAMES: Record<TabGroupColor, string> = {
  grey: "Grey",
  blue: "Blue",
  red: "Red",
  yellow: "Yellow",
  green: "Green",
  pink: "Pink",
  purple: "Purple",
  cyan: "Cyan",
  orange: "Orange",
};

interface WorkspaceFieldsProps {
  name: string;
  color: TabGroupColor | null;
  onName: (name: string) => void;
  onColor: (color: TabGroupColor | null) => void;
  autoFocus?: boolean;
}

/** Name and color of a workspace (the fields the extension edits; others are kept as they are). */
export function WorkspaceFields({ name, color, onName, onColor, autoFocus = false }: WorkspaceFieldsProps) {
  const id = useId();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
      <label htmlFor={`${id}-name`} className="sr-only">
        Workspace name
      </label>
      <input
        id={`${id}-name`}
        autoFocus={autoFocus}
        value={name}
        maxLength={WORKSPACE_LIMITS.nameMax}
        placeholder="Workspace name"
        onChange={(event) => onName(event.target.value)}
        className={inputClass}
      />
      <label htmlFor={`${id}-color`} className="sr-only">
        Color
      </label>
      <select id={`${id}-color`} value={color ?? ""} onChange={(event) => onColor(event.target.value ? tabGroupColorSchema.parse(event.target.value) : null)} className={selectClass}>
        <option value="">No color</option>
        {tabGroupColorSchema.options.map((option) => (
          <option key={option} value={option}>
            {COLOR_NAMES[option]}
          </option>
        ))}
      </select>
    </div>
  );
}
