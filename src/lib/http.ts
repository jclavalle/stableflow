import "server-only";

import { NextResponse } from "next/server";

import { getServerConfig } from "@/lib/config/server";

export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * CSRF guard for cookie-authenticated mutations: the browser-set Origin header
 * must exactly match the configured app origin.
 */
export function isTrustedOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  return origin === new URL(getServerConfig().APP_URL).origin;
}
