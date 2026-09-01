/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The static runner files live in public/ and are served at the site root
  // (/runners/..., /demo.html, /harness.html). Nothing here may rewrite those
  // paths — the runner contract requires absolute subresource URLs.
  poweredByHeader: false,
};

module.exports = nextConfig;
