const TOKEN_KEY = 'clipforge_token';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

export async function api(path, { method = 'GET', body = null, raw = null } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (raw) payload = raw;
  else if (body !== null) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(path, { method, headers, body: payload });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err = new Error(json?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json;
}

export async function uploadVideo(projectId, file, language = 'en') {
  const form = new FormData();
  form.append('file', file);
  const token = getToken();
  const res = await fetch(`/api/projects/${projectId}/videos?language=${encodeURIComponent(language)}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || 'Upload failed');
  return json.video;
}
