import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The game client is a static page; nothing here needs a Node runtime at
  // request time, so the whole site can be exported and put behind a CDN
  // while the world server runs on its own host.
  reactStrictMode: true,
};

export default nextConfig;
