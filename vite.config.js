import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(() => {
  const standalone = process.env.GAMEWAFFLE_STANDALONE;
  return {
    plugins: [svelte(), ...(standalone ? [viteSingleFile()] : [])],
    define: { __DEMO_CART__: JSON.stringify(standalone ?? '') },
    base: './',
    build: {
      outDir: standalone ? 'web-built/standalone' : 'web-built/site',
      emptyOutDir: true,
      assetsInlineLimit: standalone ? Number.POSITIVE_INFINITY : 4096,
      rolldownOptions: {
        input: standalone ? resolve('player.html') : { editor: resolve('index.html'), player: resolve('player.html') },
      },
    },
  };
});
