/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.",
    "10.",
    "169.",
    "172.",
  ],
  experimental: {},
};

module.exports = nextConfig;
