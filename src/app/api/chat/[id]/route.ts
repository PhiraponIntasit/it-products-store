import { can, getUser } from '@/server/auth';
import { chatForStaff } from '@/server/chat';

// Back-office conversation polling (chat menu only): status and messages after ?after=<id>; marks the conversation read.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getUser();
  if (!me || !can(me, 'chat')) return new Response('Not found', { status: 404 });
  const after = Number.parseInt(new URL(req.url).searchParams.get('after') ?? '0', 10);
  const t = await chatForStaff((await ctx.params).id, Number.isFinite(after) && after > 0 ? after : 0);
  if (!t) return new Response('Not found', { status: 404 });
  return Response.json(t, { headers: { 'Cache-Control': 'no-store' } });
}
