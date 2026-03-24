import type { NextConfig } from 'next';

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
// Ensure the URL always has a protocol (guards against env var set without https://)
const API_URL = rawApiUrl.startsWith('http') ? rawApiUrl : `https://${rawApiUrl}`;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {},
  // Transpile Hedera packages so webpack (not Node ESM) handles their directory imports.
  // @hashgraph/hedera-wallet-connect uses `import from './lib'` (no .js extension)
  // which fails in Node.js ESM but is resolved fine by webpack.
  transpilePackages: [
    '@hashgraph/hedera-wallet-connect',
    '@hashgraph/sdk',
    '@hashgraph/proto',
  ],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Browser build: provide empty fallbacks for Node.js built-ins used by Hedera SDK
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        dns: false,
        crypto: false,
        stream: false,
        path: false,
        os: false,
      };
    }
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_URL}/api/:path*`,
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'ipfs.io' },
      { protocol: 'https', hostname: 'hashscan.io' },
    ],
  },
};

export default nextConfig;
