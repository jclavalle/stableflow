import "server-only";

import { parseServerEnv, type ServerEnv } from "./env";

let cached: ServerEnv | undefined;

// Parsed lazily so a misconfigured deployment fails on first server use,
// and never in the client bundle.
export function getServerConfig(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
