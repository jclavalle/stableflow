import { z } from "zod";

const DEFAULT_RPC_URL = "https://sepolia.base.org";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isHttpsOrLocal(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
}

const httpsUrl = z
  .string()
  .refine(isHttpsOrLocal, "must be an https URL (http allowed only for localhost)");

const serverEnvSchema = z.object({
  APP_URL: httpsUrl,
  BASE_SEPOLIA_RPC_URL: httpsUrl.default(DEFAULT_RPC_URL),
  NEXT_PUBLIC_SUPABASE_URL: httpsUrl,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Bypasses RLS. Server-only; every query using it must be scoped to the
  // authenticated user or a validated capability.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // The MVP never moves real fiat. Refuse to start unless simulation is explicit.
  FIAT_PAYOUT_MODE: z.literal("simulation"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function isLocalUrl(value: string): boolean {
  return LOCAL_HOSTS.has(new URL(value).hostname);
}

// Names that must never be inlined into the browser bundle.
const SECRET_NAME_PATTERN = /SERVICE_ROLE|SECRET|PRIVATE|PASSWORD|RPC_URL/i;

export function parseServerEnv(env: Record<string, string | undefined>): ServerEnv {
  const leaked = Object.keys(env).filter(
    (name) => name.startsWith("NEXT_PUBLIC_") && SECRET_NAME_PATTERN.test(name),
  );
  if (leaked.length > 0) {
    throw new Error(
      `Refusing to start: secret-looking variables are exposed to the browser: ${leaked.join(", ")}`,
    );
  }

  const result = serverEnvSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid server configuration: ${issues}`);
  }
  // Local RPCs (test fixtures) are only allowed for a local app.
  if (!isLocalUrl(result.data.APP_URL) && isLocalUrl(result.data.BASE_SEPOLIA_RPC_URL)) {
    throw new Error("Invalid server configuration: BASE_SEPOLIA_RPC_URL must not be local for a deployed app");
  }
  return result.data;
}
