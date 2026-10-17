import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8 flex items-center gap-2.5" aria-label="SessionHub home">
        <span aria-hidden="true" className="grid size-8 place-items-center rounded-[9px] bg-brand font-extrabold text-on-brand">
          S
        </span>
        <span className="text-[17px] font-bold tracking-tight">SessionHub</span>
      </Link>
      <main className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">{children}</main>
      <p className="mt-6 max-w-sm text-center text-xs leading-relaxed text-fg-muted">
        An account is optional. The extension works fully without one; an account lets you sync saved sessions between your browsers.
      </p>
    </div>
  );
}
