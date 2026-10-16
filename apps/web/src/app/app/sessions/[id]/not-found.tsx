import { SearchX } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/dashboard/page-parts";

export default function SessionNotFound() {
  return (
    <EmptyState icon={SearchX} title="Session not found">
      It may have been deleted, or the link is wrong.{" "}
      <Link href="/app/sessions" className="font-semibold text-brand hover:underline">
        Back to saved sessions
      </Link>
    </EmptyState>
  );
}
