import { requestRemoteApi } from '../../src/renderer/remote/api.js';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
let reply;
window.fetch = async (path, options) => {
  assert(path === '/api/windows' && options.credentials === 'same-origin', 'Requests preserve their endpoint and credentials');
  if (reply instanceof Error) throw reply;
  return reply;
};
async function error(response, expected) {
  reply = response;
  try { await requestRemoteApi('/api/windows'); throw new Error('Expected a friendly error'); }
  catch (failure) { assert(failure.message === expected, failure.message); }
}
const unavailable = 'Boatyard is unavailable. Make sure it is running, then try again.';
for (const status of [200, 502, 503, 530]) {
  await error(new Response('<!DOCTYPE html><title>Origin unavailable</title>', { status, headers: { 'Content-Type': 'text/html' } }), unavailable);
}
await error(new Response('<!DOCTYPE html>', { status: 502, headers: { 'Content-Type': 'application/json' } }), unavailable);
await error(new Response('{invalid', { headers: { 'Content-Type': 'application/json' } }), 'Boatyard returned an unreadable response. Please try again.');
await error(new TypeError('Failed to fetch'), 'Unable to reach Boatyard. Check your connection and try again.');
reply = new Response(JSON.stringify({ error: 'Incorrect password.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
let result = await requestRemoteApi('/api/windows');
assert(result.response.status === 401 && result.value.error === 'Incorrect password.', 'Genuine authentication errors retain their status and message');
reply = new Response(JSON.stringify({ windows: [] }), { headers: { 'Content-Type': 'application/json' } });
result = await requestRemoteApi('/api/windows');
assert(result.response.ok && Array.isArray(result.value.windows), 'Valid API responses remain usable');
window.browserTestResult = 'passed';
