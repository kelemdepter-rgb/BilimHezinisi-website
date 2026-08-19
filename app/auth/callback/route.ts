import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** PKCE code exchange target (email links, future OAuth). */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (code) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(next, request.url));
    }
  }

  /**
   * A recovery link that fails here almost always means it was opened in a
   * different browser from the one that asked for it: the PKCE verifier is a
   * cookie on this site, and without it the code cannot be exchanged. Sending
   * that person to the sign-in page with "try signing in again" is the one
   * piece of advice that cannot help them, so they go back to the form that
   * can — where the message says what to do.
   */
  if (next === "/reset-password") {
    return NextResponse.redirect(new URL("/forgot-password?xata=link_failed", request.url));
  }
  return NextResponse.redirect(new URL("/login?xata=confirm_failed", request.url));
}
