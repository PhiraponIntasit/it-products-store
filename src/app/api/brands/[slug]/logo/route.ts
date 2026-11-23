import { db } from '@/server/db';
import { servePublicImage } from '@/server/public-image';

/** A brand's logo (public: the storefront brand strip). */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const b = await db.brand.findUnique({ where: { slug: (await ctx.params).slug }, select: { logo: true } });
  return servePublicImage(b?.logo);
}
