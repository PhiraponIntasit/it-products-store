import { NextResponse, type NextRequest } from 'next/server';

/** Passes the requested page (path + query) to server code as `x-erp-path`, so a signed-out visitor
 *  can be sent back to it after login (e.g. a link to /purchase?page=2).
 *  No auth decisions here — pages and the app layout still check the session themselves. */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-erp-path', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

// The app's pages only (see MOD_PATH) — not static files, API routes or the login pages.
export const config = {
  matcher: ['/dashboard', '/inventory', '/products/:path*', '/orders/:path*', '/coupons', '/warranty', '/claims/:path*', '/chat/:path*', '/customers/:path*', '/sales', '/purchase/:path*', '/approvals', '/users', '/audit'],
};
