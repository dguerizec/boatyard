import { test } from 'node:test';
import { runBrowserTest } from './helpers/browser';

test('remote API reports friendly proxy and network errors while preserving authentication responses', t => {
  runBrowserTest(t, 'test/fixtures/remote-api.browser.js');
});
