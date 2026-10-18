import type { Metadata } from "next";
import { SessionsRail } from "@/components/sessions/sessions-rail";
import { SessionsSplit } from "@/components/sessions/sessions-split";
import { readSessionsQuery, sessionsHref } from "@/lib/workspace-filter";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Saved sessions · SessionHub" };

/** The list with no session open (docs/UI_UX_DESIGN.md 18n). */
export default async function SessionsPage(props: PageProps<"/app/sessions">) {
  const request = readSessionsQuery(await props.searchParams);
  const { user } = await requireSession(sessionsHref(request));
  return <SessionsSplit rail={<SessionsRail userId={user.id} request={request} />} detail={null} />;
}
