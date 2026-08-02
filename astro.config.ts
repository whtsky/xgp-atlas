import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

import { defaultSiteUrl } from './src/config/site';

export default defineConfig({
  integrations: [
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
    sitemap({
      filter: (page) => new URL(page).pathname.split('/').filter(Boolean).length === 2,
    }),
  ],
  output: 'static',
  site: defaultSiteUrl,
  trailingSlash: 'always',
  vite: {
    plugins: [tailwindcss()],
  },
});
