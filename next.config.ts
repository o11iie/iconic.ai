import type { NextConfig } from 'next';

/**
 * VEO Next.js configuration.
 *
 * Performance note: VEO will eventually ship large GLB/GLTF spatial assets.
 * Those are never bundled — they are fetched at runtime through the provider
 * layer (see src/anatomy/providers) so they cannot inflate the initial boot
 * payload. `serverExternalPackages` keeps heavyweight server SDKs out of the
 * bundler graph.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // three.js is large; transpiling it through the app graph lets Next split it
  // out of the first-load bundle for routes that do not mount a viewport.
  experimental: {
    optimizePackageImports: ['@react-three/drei', 'framer-motion', 'three'],
  },

  serverExternalPackages: ['openai', 'stripe'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
