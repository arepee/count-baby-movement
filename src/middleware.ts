import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const PUBLIC_PATHS = new Set(["/login", "/api/login", "/api/cron"]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const authed = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET);

  if (PUBLIC_PATHS.has(pathname)) {
    if (pathname === "/login" && authed) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }
  if (authed) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  // Static/PWA assets are never gated; /login, /api/login and /api/cron are handled above.
  matcher: ["/((?!_next/|icons/|sw\\.js|manifest\\.webmanifest|favicon\\.ico|apple-touch-icon\\.png).*)"],
};
