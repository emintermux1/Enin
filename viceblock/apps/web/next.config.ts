import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@viceblock/shared", "@viceblock/game-core"],
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
