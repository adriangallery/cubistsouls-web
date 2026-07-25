/** @type {import('next').NextConfig} */
const nextConfig = {
  // The whole new site stays out of search indexes until the final domain flip
  // to cubistsouls.com. X-Robots-Tag noindex is applied globally below.
  async headers() {
    return [
      {
        // Global security + noindex on every path (pages, assets, API).
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        // Static image/font assets served from /public — long immutable cache,
        // mirrors pikkazo-burn/vercel.json. API image routes set their own
        // Cache-Control inside the route handler, so this only hits /public.
        source: "/:path*.(jpg|jpeg|png|svg|gif|webp|ico|woff|woff2)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, s-maxage=604800, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
