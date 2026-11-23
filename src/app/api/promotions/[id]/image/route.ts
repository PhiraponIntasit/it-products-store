import { db } from '@/server/db';
import { servePublicImage } from '@/server/public-image';

/** A banner's poster (public: the home page shows it to everyone). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const p = await db.promotion.findUnique({ where: { id: (await ctx.params).id }, select: { image: true } });
  return servePublicImage(p?.image);
}
