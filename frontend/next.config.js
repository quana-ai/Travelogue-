/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  async rewrites() {
    const backendBase =
      process.env.NEXT_PUBLIC_API_BASE?.replace('/api', '') ||
      'http://localhost:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${backendBase}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;

