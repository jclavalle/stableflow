import "server-only";

import { z } from "zod";

import { jsonError } from "@/lib/http";

export const requestIdSchema = z.uuid();

// Errors raised by the payment request database functions.
const DB_ERRORS: Record<string, [number, string]> = {
  wallet_not_found: [400, "Choose one of your verified wallets."],
  request_not_found: [404, "Payment request not found."],
  request_not_open: [409, "This request is no longer open."],
};

export function dbErrorResponse(message: string) {
  const known = DB_ERRORS[message];
  if (known) return jsonError(known[0], message, known[1]);
  return jsonError(503, "unavailable", "The service is unavailable. Try again.");
}
