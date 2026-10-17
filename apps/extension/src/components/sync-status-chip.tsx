import { AlertTriangle, CheckCircle2, Clock, CloudOff, HardDrive, WifiOff, type LucideIcon } from "lucide-react";
import { useSyncOverview } from "../hooks/use-sync";
import { formatFullDate } from "../lib/format";
import { overviewText, SESSION_SYNC_TEXT, type SessionSyncLabel, type SyncOverview } from "../lib/sync-status";

type Tone = "muted" | "ok" | "warn";

const TONE_CLASS: Record<Tone, string> = {
  muted: "bg-surface-muted text-fg-muted",
  ok: "bg-brand-soft text-brand",
  warn: "bg-warning-soft text-warning",
};

function Chip({ icon: Icon, tone, title, children }: { icon: LucideIcon; tone: Tone; title: string; children: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${TONE_CLASS[tone]}`} title={title}>
      <Icon aria-hidden="true" className="size-3.5" />
      {children}
    </span>
  );
}

type OverviewKey = Exclude<SyncOverview["kind"], "on"> | Extract<SyncOverview, { kind: "on" }>["state"];

const OVERVIEW_LOOK: Record<OverviewKey, { icon: LucideIcon; tone: Tone }> = {
  "local-only": { icon: HardDrive, tone: "muted" },
  "sync-off": { icon: CloudOff, tone: "muted" },
  synced: { icon: CheckCircle2, tone: "ok" },
  pending: { icon: Clock, tone: "muted" },
  review: { icon: AlertTriangle, tone: "warn" },
  failed: { icon: AlertTriangle, tone: "warn" },
  offline: { icon: WifiOff, tone: "warn" },
};

/** Tooltip detail; "Synced" always says when, so an old sync never looks current. */
const overviewTitle = (overview: SyncOverview): string => {
  if (overview.kind === "local-only") return "Sessions are saved in this browser only. Connect an account in Account to sync.";
  if (overview.kind === "sync-off") return "Connected, but sync is off. Nothing is uploaded or downloaded.";
  const last = overview.lastSyncAt ? `Last synced ${formatFullDate(overview.lastSyncAt)}.` : "Not synced yet.";
  if (overview.state === "failed" || overview.state === "offline") return `${overview.lastError ?? "Sync failed."} ${last}`;
  if (overview.state === "review") return `${overview.review} change${overview.review === 1 ? "" : "s"} need review. ${last}`;
  if (overview.state === "pending") return `${overview.waiting} change${overview.waiting === 1 ? "" : "s"} waiting to sync. ${last}`;
  return last;
};

/** Overall sync state (docs/UI_UX_DESIGN.md section 13) for a known overview. */
export function OverviewChip({ overview }: { overview: SyncOverview }) {
  const look = OVERVIEW_LOOK[overview.kind === "on" ? overview.state : overview.kind];
  return (
    <Chip icon={look.icon} tone={look.tone} title={overviewTitle(overview)}>
      {overviewText(overview)}
    </Chip>
  );
}

/** Overall sync state, live from IndexedDB. Renders nothing until known: never a guessed state. */
export function SyncStatusChip() {
  const overview = useSyncOverview();
  return overview ? <OverviewChip overview={overview} /> : null;
}

/** Where sessions live, under the chip in the manager sidebar. */
export function SyncNote() {
  const overview = useSyncOverview();
  const text =
    overview?.kind === "on"
      ? "Saved sessions sync with your account. Recovery checkpoints stay in this browser."
      : "Saved in this browser only. Export important sessions to keep an independent backup.";
  return <p className="hidden text-[11px] leading-relaxed text-fg-muted lg:block">{text}</p>;
}

const LABEL_LOOK: Record<SessionSyncLabel, { icon: LucideIcon; tone: Tone }> = {
  local: { icon: HardDrive, tone: "muted" },
  pending: { icon: Clock, tone: "muted" },
  synced: { icon: CheckCircle2, tone: "ok" },
  conflict: { icon: AlertTriangle, tone: "warn" },
  error: { icon: AlertTriangle, tone: "warn" },
  paused: { icon: CloudOff, tone: "muted" },
};

const LABEL_TITLE: Record<SessionSyncLabel, string> = {
  local: "Saved in this browser only.",
  pending: "Saved here; waiting to upload to your account.",
  synced: "Saved in your account; the server has the latest version.",
  conflict: "Changed elsewhere too. Both versions are kept until you review them.",
  error: "This change can't be uploaded as it is. It's kept here.",
  paused: "In your account, but sync is off in this browser.",
};

/** One session's sync state. */
export function SessionSyncBadge({ label }: { label: SessionSyncLabel }) {
  const look = LABEL_LOOK[label];
  return (
    <Chip icon={look.icon} tone={look.tone} title={LABEL_TITLE[label]}>
      {SESSION_SYNC_TEXT[label]}
    </Chip>
  );
}
