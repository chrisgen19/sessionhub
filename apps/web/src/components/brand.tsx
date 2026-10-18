import Link from "next/link";

/** The SessionHub mark and name, linking home (`/` on public pages, `/app` when signed in). */
export function Brand({ href = "/", label = "SessionHub home" }: { href?: string; label?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label={label}>
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-[9px] bg-brand font-extrabold text-on-brand">
        S
      </span>
      <span className="text-[17px] font-bold tracking-tight">SessionHub</span>
    </Link>
  );
}
