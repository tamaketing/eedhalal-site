import test from 'node:test';
import { checkPublicSite } from '../scripts/check-public-site.mjs';

test('public pages have valid local references and SEO metadata', async () => {
  await checkPublicSite();
});
