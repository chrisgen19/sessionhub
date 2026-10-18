import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { SessionDetail } from "@/components/sessions/session-detail";
import { SessionsRail } from "@/components/sessions/sessions-rail";
import { SessionsSplit } from "@/components/sessions/sessions-split";
import { getPrisma } from "@sessionhub/database/client";
import { readSessionsQuery, sessionsHref } from "@/lib/workspace-filter";
import { listWorkspaceChoices } from "@/server/queries/dashboard";
import { getSessionDetail } from "@/server/sessions/queries";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Session · SessionHub" };

/** A session open beside the list it was opened from (its filters are in the URL). */
export default async function SessionDetailPage(props: PageProps<"/app/sessions/[id]">) {
  const [{ id }, params] = await Promise.all([props.params, props.searchParams]);
  const request = readSessionsQuery(params);
  const { user } = await requireSession(sessionsHref({ ...request, id }));
  // Malformed, missing, deleted and other users' ids all look the same.
  const detail = z.uuid().safeParse(id).success ? await getSessionDetail(getPrisma(), user.id, id) : null;
  if (!detail) notFound();
  const workspaces = await listWorkspaceChoices(getPrisma(), user.id);

  return (
    <SessionsSplit
      rail={<SessionsRail userId={user.id} request={request} selectedId={detail.id} />}
      detail={<SessionDetail detail={detail} workspaces={workspaces} listHref={sessionsHref(request)} />}
    />
  );
}
