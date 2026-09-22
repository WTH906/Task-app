const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Hosts allowed to hit the dev server's internal endpoints (/_next/*,
  // /__nextjs*). Anything not listed gets a 403 — including
  // /__nextjs_original-stack-frames, which is how the error overlay turns a
  // stack trace into readable source. So a wrong entry here doesn't break the
  // app; it breaks your ability to SEE what broke.
  //
  // Entries are matched by `isCsrfOriginAllowed` in Next's source: exact
  // string, or dot-separated wildcards. Prefix strings do NOT work — the
  // previous list here ("192.168.", "10.", "169.", "172.") matched nothing at
  // all, because a trailing dot produces an empty segment that the matcher
  // rejects outright. Only "localhost" and "127.0.0.1" were ever live.
  //
  // Each octet needs its own "*". If you reach the dev server on a host that
  // isn't covered below, add it verbatim.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "[::1]",
    "192.168.*.*",   // home / office LAN
    "10.*.*.*",      // private range
    // Docker and WSL hand out addresses across the whole 172.16–172.31 range
    // and the exact subnet changes between machines, so this is the one entry
    // deliberately wider than strictly needed — listing sixteen /16s to be
    // precise would just mean hitting this again on the next machine. It only
    // ever applies to `next dev` on your own box.
    "172.*.*.*",
    "169.254.*.*",   // link-local — WSL, Hyper-V vEthernet, no-DHCP adapters
  ],
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {},

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },

  eslint: {
    // Lint is its own CI step (`npm run lint:ci`), which is the only
    // invocation that reads eslint-suppressions.json. Next's built-in
    // build-time lint doesn't, so leaving it on would fail the build on
    // every already-known issue in the baseline.
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
