import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Self-contained server for the Docker image (infra/docker/web.Dockerfile). Tracing starts
  // at the monorepo root so workspace packages and their dependencies are included.
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  reactStrictMode: true,
  // Workspace package shipped as TypeScript source (Prisma client); Next must compile it.
  transpilePackages: ["@sessionhub/database"],
  // Saved links opened from the dashboard must not tell other sites which session URL they came
  // from, and the reset page's URL carries a one-time token.
  async headers() {
    const noReferrer = [{ key: "Referrer-Policy", value: "no-referrer" }];
    // HTTPS only from the first visit on, for a year. Browsers ignore it over plain http (RFC 6797
    // section 8.1), so local production runs are unaffected. No includeSubDomains or preload: they
    // would bind every other host on the domain. Not sent by `next dev`.
    const hsts = process.env.NODE_ENV === "production" ? [{ source: "/:path*", headers: [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] }] : [];
    return [
      ...hsts,
      { source: "/app/:path*", headers: noReferrer },
      { source: "/reset-password", headers: [...noReferrer, { key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
