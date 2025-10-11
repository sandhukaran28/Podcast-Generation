import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',   // <-- generates .next/standalone
  reactStrictMode: true,
  /* config options here */
};

export default nextConfig;
