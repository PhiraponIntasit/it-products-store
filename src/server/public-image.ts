import 'server-only';
import { readUpload, sniffImage } from './uploads';

/** Serve an uploaded storefront image (banner poster, brand logo). Public; the URL carries a version (?v=…) that
 *  changes with each upload, so it may be cached. Only real image bytes are served. */
export async function servePublicImage(file: string | null | undefined) {
  const buf = file ? await readUpload(file).catch(() => null) : null;
  const mime = buf && sniffImage(buf);
  if (!buf || !mime) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(buf), {
    headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' },
  });
}
