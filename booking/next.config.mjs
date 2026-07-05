/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
  // typedRoutes is intentionally disabled — it's overly strict with
  // `?filter=...` query strings and dynamic [id] routes, which we use
  // heavily in /admin. Re-enable later if Next's typing loosens.
};

export default nextConfig;
