/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Allow larger request bodies for base64 image uploads to route handlers.
    serverActions: { bodySizeLimit: "8mb" },
  },
};

export default nextConfig;
