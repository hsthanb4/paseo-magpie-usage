import {
  hashAccountKey,
  toneFromUsedPct,
  unavailable,
  type UsageAccount,
  type UsageBalance,
  type UsageDetail,
  type UsageReport,
  type UsageScope,
  type UsageWindow,
} from "@getpaseo/plugin/server/usage";
import type { UsageInput } from "../shared/input.js";
import { fetchMagpieEntries, fetchModelOwners } from "./quotas.js";
import { pickEntry, resolveProvider } from "../shared/match.js";
import type { MagpieEntry, MagpieWindow } from "../shared/quotas.js";

const MAGPIE_BASE = (process.env.MAGPIE_BASE_URL || "http://127.0.0.1:3425").replace(/\/+$/u, "");

type Entry = MagpieEntry;

function userOf(entry: Entry): string {
  return entry.user ?? "";
}

function inputOf(entry: Entry): UsageInput {
  return { provider: entry.provider, user: userOf(entry) };
}

function toAccount(entry: Entry): UsageAccount {
  const providerName = entry.name || entry.provider;
  const user = userOf(entry);
  return {
    key: hashAccountKey(`magpie:${entry.provider}:${user}`).slice(0, 64),
    label: user ? `${providerName} · ${user}` : providerName,
    harness: "Magpie",
    input: inputOf(entry),
  };
}

/**
 * Global scope lists every Magpie account. Session scope lists the accounts of the Magpie
 * provider the session routes through, recognised from a `magpie/<provider>/<model>` model id
 * (Pi, OpenCode) or a `<provider>/<model>` id sent to a harness whose base URL is Magpie.
 */
export async function discover(scope: UsageScope): Promise<UsageAccount[]> {
  let entries: Entry[];
  try {
    entries = await fetchMagpieEntries();
  } catch {
    return [];
  }
  if (scope.kind === "global") return entries.map(toAccount);

  const known = new Set(entries.map((e) => e.provider));
  const owners = await fetchModelOwners();
  const provider = resolveProvider({ provider: scope.provider, model: scope.model }, known, owners);
  if (provider) {
    // One account is serving the session; listing every account of the provider would mix them up.
    const serving = pickEntry(provider, entries);
    return serving ? [toAccount(serving)] : [];
  }
  // Not attributable to a single provider: show nothing rather than the wrong account.
  return [];
}

export async function fetchUsage(input: UsageInput): Promise<UsageReport> {
  let entries: Entry[];
  try {
    entries = await fetchMagpieEntries();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", error: `Cannot reach Magpie at ${MAGPIE_BASE}: ${message}` };
  }
  const entry = entries.find((e) => e.provider === input.provider && userOf(e) === input.user);
  if (!entry) return { status: "error", error: "This account is no longer in Magpie" };
  return toReport(entry);
}

function toReport(entry: Entry): UsageReport {
  if (entry.error) return { status: "error", error: entry.error };

  // `text` rows are informational links (proxy, admin page), not quotas.
  const quotaWindows = (entry.windows ?? []).filter((w) => !w.text);
  const windows = quotaWindows.map((w, i) => toWindow(w, i === 0));
  const balances: UsageBalance[] = quotaWindows.flatMap((w) => toBalance(w));
  const accountBalance = parseMoney(entry.balance);
  if (accountBalance !== null) {
    balances.push({
      id: "balance",
      label: "Balance",
      remaining: accountBalance,
      unit: "usd",
      tone: accountBalance <= 0 ? "danger" : "ok",
    });
  }

  if (windows.length === 0 && balances.length === 0) {
    return unavailable({ kind: "no_quota", detail: "Magpie reports no quota for this account" });
  }

  const details: UsageDetail[] = [];
  for (const w of quotaWindows) {
    if (w.display && !w.limit && w.display !== `${w.used}`) {
      details.push({ id: `${slug(w.name)}:display`, label: w.name, value: w.display });
    }
  }
  if (entry.readAt) details.push({ id: "read_at", label: "Read by Magpie", value: entry.readAt });

  return {
    status: "available",
    ...(entry.plan ? { planLabel: entry.plan } : {}),
    windows,
    balances,
    details,
  };
}

function toWindow(w: MagpieWindow, summary: boolean): UsageWindow {
  const usedPct = clampPct(w.used ?? (w.remaining != null ? 100 - w.remaining : null));
  const remainingPct = clampPct(w.remaining ?? (usedPct != null ? 100 - usedPct : null));
  const window: UsageWindow = {
    id: slug(w.name),
    label: w.name,
    shortLabel: shortLabel(w.name),
    usedPct,
    remainingPct,
    resetsAt: w.resetsAt ?? null,
    runsOutAt: w.runsOutAt ?? null,
    tone: toneFromUsedPct(usedPct),
  };
  if (summary) window.summary = true;
  return window;
}

function toBalance(w: MagpieWindow): UsageBalance[] {
  if (typeof w.limit !== "number" || w.limit <= 0) return [];
  const used = typeof w.amount === "number" ? w.amount : parseUsedFromDisplay(w.display);
  const unit = w.unit === "usd" || w.unit === "requests" || w.unit === "tokens" ? w.unit : "credits";
  return [
    {
      id: `${slug(w.name)}:balance`,
      label: w.name,
      used,
      remaining: used != null ? Math.max(0, w.limit - used) : null,
      limit: w.limit,
      unit,
      resetsAt: w.resetsAt ?? null,
      tone: toneFromUsedPct(used != null ? (used / w.limit) * 100 : null),
    },
  ];
}

/** "447.68 / 1000" → 447.68 */
function parseUsedFromDisplay(display: string | null | undefined): number | null {
  const m = display?.match(/^\s*([\d.]+)\s*\/\s*[\d.]+/u);
  return m ? Number(m[1]) : null;
}

/** "$9.91" → 9.91 */
function parseMoney(value: string | null | undefined): number | null {
  const m = value?.match(/^\s*\$\s*([\d,]+(?:\.\d+)?)\s*$/u);
  return m ? Number(m[1].replace(/,/gu, "")) : null;
}

function clampPct(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(100, Math.max(0, Math.round(v * 10) / 10));
}

/** "Gemini · 7 days" → "Gemini 7d", "5 hours" → "5h", "Credits" → "cr" */
function shortLabel(name: string): string {
  const parts = name.split("·").map((p) => p.trim());
  const tail = parts[parts.length - 1];
  const m = tail.match(/^(\d+)\s*(day|hour|minute|week|month)s?$/iu);
  const short = m
    ? `${m[1]}${{ day: "d", hour: "h", minute: "m", week: "w", month: "mo" }[m[2].toLowerCase() as "day"]}`
    : /^credits$/iu.test(tail)
      ? "cr"
      : tail.slice(0, 8);
  return parts.length > 1 ? `${parts[0].split(/\s/u)[0]} ${short}` : short;
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "_")
      .replace(/^_|_$/gu, "")
      .slice(0, 64) || hashAccountKey(name).slice(0, 12)
  );
}
