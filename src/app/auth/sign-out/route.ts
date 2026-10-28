import { NextResponse } from "next/server";

import { getServerConfig } from "@/lib/config/server";
import { isTrustedOrigin, jsonError } from "@/lib/http";
import { createUserClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) return jsonError(403, "bad_origin", "Request origin not allowed.");
  const supabase = await createUserClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", getServerConfig().APP_URL), { status: 303 });
}
