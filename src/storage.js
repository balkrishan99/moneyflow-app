// Talks to /api/kv (a Vercel serverless function backed by Vercel KV / Redis)
// instead of the Claude-artifact-only `window.storage` API. Same shape of
// functions the app already expects: loadUser/saveUser/loadGroup/saveGroup.

async function kvGet(key) {
  try {
    const res = await fetch(`/api/kv?key=${encodeURIComponent(key)}`);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const data = await res.json();
    return data.value ?? null;
  } catch {
    return null;
  }
}

async function kvSet(key, value) {
  try {
    await fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
  } catch {
    // best-effort — the UI already treats saves as fire-and-forget
  }
}

export async function loadUser(name) {
  return kvGet(`mf:user:${name}`);
}
export async function saveUser(name, data) {
  return kvSet(`mf:user:${name}`, data);
}
export async function loadGroup(id) {
  return kvGet(`mf:group:${id}`);
}
export async function saveGroup(id, data) {
  return kvSet(`mf:group:${id}`, data);
}
