const path = require("path");

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
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {},
};

module.exports = nextConfig;
