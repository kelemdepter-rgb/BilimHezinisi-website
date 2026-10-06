import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Route handlers do not inherit the root layout's ceiling, so each one names
 * its own: 30 s, against Vercel's default 300 (PROMPT-40). Every Supabase call
 * in here gives up within 10 s on its own (lib/supabase/timeouts.ts).
 */
export const maxDuration = 30;

/** Email OTP verification target (confirmation / recovery links). */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  /**
   * Where to land afterwards. A recovery link exists to change a password, so
   * it goes to the form that does that — this is the route Supabase uses when
   * the email template is switched to {{ .TokenHash }} instead of the default
   * {{ .ConfirmationURL }}, and both spellings have to end up in the same
   * place. Only same-site paths are honoured, so the link cannot be turned
   * into an open redirect.
   */
  const rawNext = searchParams.get("next");
  const requested = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : null;
  const destination = requested ?? (type === "recovery" ? "/reset-password" : "/");

  if (tokenHash && type) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      if (!error) return NextResponse.redirect(new URL(destination, request.url));
    }
  }
  return NextResponse.redirect(new URL("/login?xata=confirm_failed", request.url));
}
