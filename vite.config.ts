import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { siteBase } from './scripts/site-base.mjs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['APP_', 'NEXT_PUBLIC_']);
  return {
    base: siteBase(env.APP_BASE_PATH),
    plugins: [react()],
    resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
    css: { postcss: { plugins: [tailwindcss()] } },
    define: {
      'process.env.NEXT_PUBLIC_ROUTING_URL': JSON.stringify(
        env.NEXT_PUBLIC_ROUTING_URL || '',
      ),
      'process.env.NEXT_PUBLIC_PLACES_URL': JSON.stringify(
        env.NEXT_PUBLIC_PLACES_URL || '',
      ),
    },
    server: { port: 3000, strictPort: true },
  };
});
