import { connection, NextResponse, type NextRequest } from "next/server";

import { getServerConfig } from "@/lib/config/server";
import { createUserClient } from "@/lib/supabase/server";

// Email-confirmation landing. Redirects only to fixed in-app paths.
export async function GET(request: NextRequest) {
  // Always per-request; never prerendered.
  await connection();
  const appUrl = getServerConfig().APP_URL;
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createUserClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/account", appUrl));
  }
  return NextResponse.redirect(new URL("/sign-in", appUrl));
}
