import { test } from 'node:test';
import { runBrowserTest } from './helpers/browser';

test('remote video diagnostics identify the selected route and interval delays', t => {
  runBrowserTest(t, 'test/fixtures/remote-diagnostics.browser.js');
});
