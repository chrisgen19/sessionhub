import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Workspace package shipped as TypeScript source (Prisma client); Next must compile it.
  transpilePackages: ["@sessionhub/database"],
};

export default nextConfig;
