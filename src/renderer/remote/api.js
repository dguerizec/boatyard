const unavailable = 'Boatyard is unavailable. Make sure it is running, then try again.';
const unreadable = 'Boatyard returned an unreadable response. Please try again.';

export async function requestRemoteApi(path, body) {
  let response;
  try {
    response = await fetch(path, { method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : {}, credentials: 'same-origin',
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new Error('Unable to reach Boatyard. Check your connection and try again.');
  }
  if (!response.headers.get('Content-Type')?.toLowerCase().includes('application/json')) throw new Error(unavailable);
  let value;
  try { value = await response.json(); }
  catch { throw new Error(response.status >= 500 ? unavailable : unreadable); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(unreadable);
  return { response, value };
}
