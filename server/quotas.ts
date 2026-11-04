import { z } from "zod";
import { MagpieEntrySchema, type MagpieEntry } from "../shared/quotas.js";

const MAGPIE_BASE = (process.env.MAGPIE_BASE_URL || "http://127.0.0.1:3425").replace(/\/+$/u, "");
const CACHE_TTL_MS = 10_000;

const ResponseSchema = z.object({ data: z.array(z.unknown()) });

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
  updatedAt: string;
}> {
  try {
    const entries = await fetchMagpieEntries(force);
    return {
      ok: true,
      entries,
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `Cannot reach Magpie (${MAGPIE_BASE}): ${message}`,
      entries: cache?.entries ?? [],
      updatedAt: cache ? new Date(cache.at).toISOString() : new Date().toISOString(),
    };
  }
}
