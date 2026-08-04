import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Skip static assets; run on all pages and API routes.
    "/((?!_next/static|_next/image|favicon.ico|fonts/|brand.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|ttf|otf|woff2?)$).*)",
  ],
};
