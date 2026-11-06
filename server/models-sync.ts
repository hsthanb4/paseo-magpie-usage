import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { ModelOwners } from "../shared/match.js";

/**
 * Paseo caches each harness's model catalog. Magpie rewrites Pi's models.json whenever its
 * models change, and Paseo does not notice, so the picker keeps showing a stale list.
 * Refresh the Pi catalog whenever the gateway's model set or models.json changes.
 */
const MODELS_FILE = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "models.json");
const MIN_GAP_MS = 30_000;

let lastSignature: string | null = null;
let lastAttemptAt = 0;
let running = false;

async function signature(owners: ModelOwners): Promise<string> {
  const ids = Object.keys(owners).sort().join("\n");
  let mtime = 0;
  try {
    mtime = (await stat(MODELS_FILE)).mtimeMs;
  } catch {
    // no models.json yet
  }
  return createHash("sha1").update(`${mtime}\n${ids}`).digest("hex");
}

export async function syncPaseoModelCatalog(paseo: PluginHandlerContext["paseo"], owners: ModelOwners): Promise<void> {
  if (running || Object.keys(owners).length === 0) return;
  if (Date.now() - lastAttemptAt < MIN_GAP_MS) return;
  const sig = await signature(owners);
  if (sig === lastSignature) return;
  running = true;
  lastAttemptAt = Date.now();
  try {
    await paseo.providers.refresh({ providers: ["pi"] });
    lastSignature = sig;
    console.log(`[magpie-usage] refreshed Paseo's Pi model catalog (${Object.keys(owners).length} Magpie models)`);
  } catch (err) {
    console.error("[magpie-usage] Pi model catalog refresh failed:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}
