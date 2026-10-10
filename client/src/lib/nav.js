/**
 * Link that starts navigation to a shop address in the device's map app.
 * Nothing is loaded from a map service until the person taps it.
 */
export function navUrl(address) {
  const a = String(address ?? '').trim();
  if (!a) return '';
  if (/^https?:\/\//i.test(a)) return a; // a shared map link
  const q = encodeURIComponent(a);
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/iPhone|iPad|iPod|Macintosh/.test(ua)) return `https://maps.apple.com/?daddr=${q}`;
  if (/Android/.test(ua)) return `geo:0,0?q=${q}`; // lets Android offer every installed navigation app
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}
