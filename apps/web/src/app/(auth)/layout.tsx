import type { ReactNode } from "react";
import { AccountPanel } from "@/components/auth/account-panel";
import { PublicHeader } from "@/components/public/public-header";

/**
 * Sign in, sign up and password pages (docs/UI_UX_DESIGN.md 18o): the form on the left and, beside
 * it, what an account is for. Narrower than 1024px the note follows the form.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col lg:grid lg:grid-cols-2">
      <div className="flex flex-col px-4 pt-6 sm:px-8">
        <PublicHeader />
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10 lg:py-16">{children}</main>
      </div>
      <aside aria-label="About accounts" className="border-t border-line bg-surface px-4 py-10 sm:px-8 lg:flex lg:items-center lg:justify-center lg:border-t-0 lg:border-l">
        <AccountPanel />
      </aside>
    </div>
  );
}
