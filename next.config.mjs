/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Allow larger request bodies for base64 image uploads to route handlers.
    serverActions: { bodySizeLimit: "8mb" },
    // Ship the self-hosted catalogue images with the recognition routes so the
    // visual verification pass can read them from the filesystem on Vercel.
    outputFileTracingIncludes: {
      "/api/shelf-scan": ["./public/mugs/**"],
      "/api/identify": ["./public/mugs/**"],
    },
  },
};

export default nextConfig;
