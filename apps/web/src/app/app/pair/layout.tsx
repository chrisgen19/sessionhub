import type { ReactNode } from "react";
import { PageBody } from "@/components/dashboard/page-parts";

/** The pair page has several outcomes; they share the dashboard's page padding. */
export default function PairLayout({ children }: { children: ReactNode }) {
  return <PageBody>{children}</PageBody>;
}
