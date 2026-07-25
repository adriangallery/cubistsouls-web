/** @type {import('next').NextConfig} */
const nextConfig = {
  // wagmi v2.19 pulls the Base Account connector, whose @coinbase/cdp-sdk has
  // optional x402 (Solana/EVM payment) sub-imports we never reach. They aren't
  // installed and would fail the build — alias them (and the usual web3 noise)
  // to empty so webpack stops trying to resolve them.
  webpack: (config, { webpack }) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // Ignore every @x402/* optional payment sub-import from @coinbase/cdp-sdk.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }));
    return config;
  },
  // Clean-URL rewrites for the still-legacy HTML pages that the new Next site
  // hasn't ported yet, so the domain flip breaks no URL. Each serves the copy
  // in /public verbatim (they reference /assets/* and /api/* which already exist
  // here; the builder manifest comes from GitHub raw). The-vault + govern keep
  // their own inline <meta robots noindex>; builder is public (linked in Nav).
  async rewrites() {
    return [
      { source: "/builder", destination: "/builder.html" },
      { source: "/builder-test", destination: "/builder-test.html" },
      { source: "/the-vault-9k2xq7", destination: "/the-vault-9k2xq7.html" },
      { source: "/govern-x9v4k2", destination: "/govern-x9v4k2.html" },
    ];
  },
  // The site is PUBLIC (domain flip to cubistsouls.com). The global noindex is
  // gone; only the still-semi-secret legacy pages keep noindex via inline meta
  // (builder-test, the-vault-9k2xq7, govern-x9v4k2).
  async headers() {
    return [
      {
        // Global security headers on every path (pages, assets, API).
        source: "/:path*",
        headers: [
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
