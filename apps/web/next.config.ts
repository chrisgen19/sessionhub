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
  // Saved links opened from the dashboard must not tell other sites which session URL they came from.
  async headers() {
    return [{ source: "/app/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }];
  },
};

export default nextConfig;
