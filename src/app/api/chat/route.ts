import { customerChat } from '@/server/chat';

// Storefront chat widget polling: the browser's open conversation and messages after ?after=<id>.
export async function GET(req: Request) {
  const after = Number.parseInt(new URL(req.url).searchParams.get('after') ?? '0', 10);
  const data = await customerChat(Number.isFinite(after) && after > 0 ? after : 0);
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
