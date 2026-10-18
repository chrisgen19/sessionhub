import { Cloud, EyeOff, Laptop, MonitorSmartphone } from "lucide-react";

const POINTS = [
  { icon: Cloud, title: "Sync between your computers", body: "Sessions saved in one browser appear in the others you connect." },
  { icon: Laptop, title: "Optional", body: "The extension saves, searches and reopens sessions without an account." },
  { icon: EyeOff, title: "You choose what uploads", body: "Turning sync on lists the sessions first. Recovery checkpoints never upload." },
  { icon: MonitorSmartphone, title: "Disconnect any time", body: "Remove a browser from Devices; it keeps its own sessions." },
] as const;

/** Beside the sign-in and sign-up forms: what an account does, and doesn't, before anyone makes one. */
export function AccountPanel() {
  return (
    <div className="max-w-md">
      <h2 className="text-lg font-bold tracking-tight">What an account is for</h2>
      <ul className="mt-5 space-y-4">
        {POINTS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-3">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
              <Icon aria-hidden="true" className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">{title}</span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-fg-muted">{body}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
