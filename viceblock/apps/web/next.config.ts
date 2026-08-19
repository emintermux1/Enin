import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@viceblock/shared", "@viceblock/game-core"],
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  eslint: { ignoreDuringBuilds: true },
  // Lets a dev server run beside a production `next start` without the two
  // trashing each other's build artifacts (e.g. NEXT_DIST_DIR=.next-dev).
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
