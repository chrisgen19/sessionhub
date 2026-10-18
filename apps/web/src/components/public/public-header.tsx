import Link from "next/link";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * The signed-out pages' header: brand and theme, plus "Sign in" on the landing page (its hero
 * offers getting the extension and creating an account).
 */
export function PublicHeader({ signIn = false }: { signIn?: boolean }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <Brand />
      <nav aria-label="Account" className="flex items-center gap-2">
        <ThemeToggle />
        {signIn && (
          <Link href="/login" className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-semibold whitespace-nowrap hover:bg-surface-muted">
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}
