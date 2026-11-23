import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { cartridgeMarker } from './src/web-export.mjs';

export default defineConfig(() => {
  const standalone = process.env.GAMEWAFFLE_STANDALONE === '1';
  return {
    plugins: [svelte(), ...(standalone ? [
      {
        name: 'gamewaffle-cartridge-slot',
        transformIndexHtml: () => [{
          tag: 'script', attrs: { id: 'gamewaffle-cartridge', type: 'application/octet-stream' },
          children: cartridgeMarker, injectTo: 'body-prepend',
        }],
      },
      viteSingleFile(),
    ] : [])],
    base: './',
    build: {
      outDir: standalone ? 'web-built/standalone' : 'web-built/site',
      emptyOutDir: true,
      assetsInlineLimit: standalone ? Number.POSITIVE_INFINITY : 4096,
      rolldownOptions: {
        input: standalone ? resolve('player.html') : { editor: resolve('index.html'), projects: resolve('projects.html'), player: resolve('player.html') },
      },
    },
  };
});
