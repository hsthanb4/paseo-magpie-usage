import type { MagpieEntry } from "./quotas.js";

/** Magpie model id (e.g. `auto/claude-sonnet-5-5`) → provider that owns it (`owned_by` of /v1/models). */
export type ModelOwners = Record<string, string>;

export interface SessionModel {
  provider?: string | null;
  model?: string | null;
}

/**
 * Decide which Magpie provider a session is billed against.
 *
 * Never guess from a family name: Claude models are served by `claude` (subscription), `kiro`
 * and `antigravity` alike, so "contains claude" says nothing about whose quota is spent.
 *
 * 1. `magpie/<group>/<model>` or `<group>/<model>` where the group is itself a provider
 *    (`kiro/…`, `claude/…`, `antigravity/…`): the group is the provider.
 * 2. A routing group (`auto/…`, `group/…`): Magpie's `/v1/models` says who owns the model.
 * 3. A harness that talks to the provider directly (provider id equals a Magpie provider).
 */
export function resolveProvider(
  session: SessionModel,
  known: ReadonlySet<string>,
  owners: ModelOwners,
): string | null {
  const parts = String(session.model ?? "")
    .trim()
    .split("/")
    .filter(Boolean);
  if (parts[0] === "magpie") parts.shift();

  if (parts.length >= 2) {
    const group = parts[0].toLowerCase();
    if (known.has(group)) return group;
    const owner = owners[parts.join("/")];
    if (owner && known.has(owner)) return owner;
  }

  const direct = String(session.provider ?? "").toLowerCase();
  if (known.has(direct)) return direct;

  // Bare model id: accept only when every listing of it agrees on one owner.
  if (parts.length === 1) {
    const suffix = `/${parts[0]}`;
    const found = new Set(
      Object.entries(owners)
        .filter(([id]) => id.endsWith(suffix))
        .map(([, owner]) => owner),
    );
    if (found.size === 1) {
      const [only] = [...found];
      if (known.has(only)) return only;
    }
  }
  return null;
}

const servedAt = (e: MagpieEntry) => Date.parse(String(e.lastServedAt ?? "")) || 0;

/** The single account of `provider` that is currently serving: Magpie's `last` flag, then most recently served. */
export function pickEntry(provider: string | null, entries: readonly MagpieEntry[]): MagpieEntry | null {
  if (!provider) return null;
  const mine = entries.filter((e) => e.provider === provider);
  if (mine.length === 0) return null;
  const usable = mine.filter((e) => !e.error && (e.windows?.length ?? 0) > 0);
  const pool = usable.length > 0 ? usable : mine;
  return [...pool].sort((a, b) => Number(!!b.last) - Number(!!a.last) || servedAt(b) - servedAt(a))[0];
}

export function knownProviders(entries: readonly MagpieEntry[]): Set<string> {
  return new Set(entries.map((e) => e.provider));
}
