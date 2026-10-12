import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  webpack(config) { config.resolve.extensionAlias = { ...config.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] }; return config; },
  // Bounded build parallelism for reproducible local/CI resource use.
  experimental: { cpus: 2 },
};
export default nextConfig;
