import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { aotMarker, cartridgeMarker } from './src/web-export.mjs';

export default defineConfig(() => {
  const standalone = process.env.GAMEWAFFLE_STANDALONE === '1';
  return {
    plugins: [svelte(), ...(standalone ? [
      {
        name: 'gamewaffle-cartridge-slot',
        transformIndexHtml: () => [['gamewaffle-cartridge', cartridgeMarker], ['gamewaffle-aot', aotMarker]]
          .map(([id, children]) => ({tag:'script', attrs:{id,type:'application/octet-stream'}, children, injectTo:'body-prepend'})),
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
