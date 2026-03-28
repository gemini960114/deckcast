import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  output: 'standalone',
  webpack: (config, { isServer, webpack }) => {
    const emptyModule = path.resolve('./lib/empty-module.js');

    // Both sides: strip "node:" prefix so webpack can resolve built-ins
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
        resource.request = resource.request.replace(/^node:/, '');
      })
    );

    if (!isServer) {
      // Client: map Node.js-only modules to empty object (NOT false — pdfjs needs Object.defineProperty to work)
      // buffer/stream/crypto/path are left to webpack's built-in browser polyfills
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: emptyModule,
        https: emptyModule,
        http: emptyModule,
        net: emptyModule,
        tls: emptyModule,
        child_process: emptyModule,
        os: emptyModule,
        worker_threads: emptyModule,
        zlib: emptyModule,
      };
      config.resolve.alias = { ...config.resolve.alias, canvas: false };
    }
    return config;
  },
};

export default nextConfig;
