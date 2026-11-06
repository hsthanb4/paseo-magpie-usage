import { z } from "zod";
import { MagpieEntrySchema, type MagpieEntry } from "../shared/quotas.js";
import type { ModelOwners } from "../shared/match.js";

const MAGPIE_BASE = (process.env.MAGPIE_BASE_URL || "http://127.0.0.1:3425").replace(/\/+$/u, "");
const CACHE_TTL_MS = 10_000;

const ResponseSchema = z.object({ data: z.array(z.unknown()) });
const ModelsSchema = z.object({
  data: z.array(z.object({ id: z.string(), owned_by: z.string().nullish() }).passthrough()),
});
const MODELS_TTL_MS = 5 * 60_000;
let modelsCache: { at: number; owners: ModelOwners } | null = null;

/** model id → owning provider, from Magpie's /v1/models. Failures keep the last good map. */
export async function fetchModelOwners(): Promise<ModelOwners> {
  if (modelsCache && Date.now() - modelsCache.at < MODELS_TTL_MS) return modelsCache.owners;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${MAGPIE_BASE}/v1/models`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Magpie models API returned ${res.status}`);
    const { data } = ModelsSchema.parse(await res.json());
    const owners: ModelOwners = {};
    for (const m of data) if (m.owned_by) owners[m.id] = m.owned_by;
    modelsCache = { at: Date.now(), owners };
    return owners;
  } catch {
    return modelsCache?.owners ?? {};
  } finally {
    clearTimeout(timeout);
  }
}

let cache: { at: number; entries: MagpieEntry[] } | null = null;
let inflight: Promise<MagpieEntry[]> | null = null;

export async function fetchMagpieEntries(force = false): Promise<MagpieEntry[]> {
  const now = Date.now();
  if (!force && cache && now - cache.at < CACHE_TTL_MS) {
    return cache.entries;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(`${MAGPIE_BASE}/v1/magpie/quotas`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Magpie quota API returned ${res.status}`);
      const { data } = ResponseSchema.parse(await res.json());
      const entries = data.flatMap((row) => {
        const parsed = MagpieEntrySchema.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      });
      cache = { at: Date.now(), entries };
      return entries;
    } finally {
      clearTimeout(timeout);
      inflight = null;
    }
  })();

  return inflight;
}

export async function getMagpieEntries(force = false): Promise<{
  ok: boolean;
  error?: string;
  entries: MagpieEntry[];
  modelOwners: ModelOwners;
  updatedAt: string;
}> {
  try {
    const [entries, modelOwners] = await Promise.all([fetchMagpieEntries(force), fetchModelOwners()]);
    return {
      ok: true,
      entries,
      modelOwners,
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Cannot reach Magpie (${MAGPIE_BASE}): ${message}`,
      entries: cache?.entries ?? [],
      modelOwners: modelsCache?.owners ?? {},
      updatedAt: cache ? new Date(cache.at).toISOString() : new Date().toISOString(),
    };
  }
}
