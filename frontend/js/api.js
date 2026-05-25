/**
 * Thin wrapper for backend API calls.
 */
export async function fetchPlaylist(genre) {
  const r = await fetch(`/api/playlist?genre=${encodeURIComponent(genre)}`);
  if (!r.ok) throw new Error(`Playlist fetch failed: ${r.status}`);
  return r.json();
}

export async function uploadSession(payload) {
  const r = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
  return r.json();
}
