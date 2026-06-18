import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

function resolveFromFrontend(filePath: string): string {
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const publicHost = env.DEV_PUBLIC_HOST || 'chatbot.fanme.internal';
  const certPath = resolveFromFrontend(env.DEV_TLS_CERT_FILE || `certs/${publicHost}.crt.pem`);
  const keyPath = resolveFromFrontend(env.DEV_TLS_KEY_FILE || `certs/${publicHost}.key.pem`);
  const hasInternalCert = fs.existsSync(certPath) && fs.existsSync(keyPath);

  return {
    plugins: [
      react(),
      ...(!hasInternalCert ? [basicSsl()] : []),
    ],
    server: {
      host: env.DEV_SERVER_HOST || '0.0.0.0',
      port: Number(env.DEV_SERVER_PORT || 5173),
      allowedHosts: [publicHost, 'localhost'],
      ...(hasInternalCert
        ? {
            https: {
              cert: fs.readFileSync(certPath),
              key: fs.readFileSync(keyPath),
            },
          }
        : {}),
      proxy: {
        '/api': {
          target: env.DEV_BACKEND_URL || 'http://localhost:8080',
          changeOrigin: true,
          configure: (proxy) => {
            // Disable buffering for SSE streaming
            proxy.on('proxyReq', (proxyReq, req) => {
              if (req.url?.includes('/stream')) {
                proxyReq.setHeader('X-Accel-Buffering', 'no');
              }
            });
            proxy.on('proxyRes', (proxyRes, req) => {
              if (req.url?.includes('/stream')) {
                proxyRes.headers['cache-control'] = 'no-cache';
                proxyRes.headers['x-accel-buffering'] = 'no';
              }
            });
          },
        },
      },
    },
  }
});
