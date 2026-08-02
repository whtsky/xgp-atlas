import type { APIRoute } from 'astro';

import { defaultSiteUrl } from '../config/site';

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL(defaultSiteUrl);
  const body = [
    `User-agent: *`,
    `Allow: /`,
    `Sitemap: ${new URL('sitemap-index.xml', base).toString()}`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
