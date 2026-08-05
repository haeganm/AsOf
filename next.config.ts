import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is native; keep it out of the bundler.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
