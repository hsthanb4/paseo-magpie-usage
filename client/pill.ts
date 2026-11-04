import type {
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { MagpiePopover } from "./popover.js";
import { getQuotasRpc, type MagpieEntry, type MagpieWindow } from "../shared/quotas.js";

interface AgentSummary {
  id: string;
  workspaceId: string;
  provider: string;
  model: string | null;
}

let cachedEntries: MagpieEntry[] = [];

function isQuotaWindow(w: MagpieWindow): boolean {
  if (w.text) return false;
  if (typeof w.display === "string" && /^https?:\/\//iu.test(w.display.trim())) return false;
  const name = String(w.name || "").trim();
  if (["代理出口", "管理页", "代理", "管理", "出口"].includes(name)) return false;
  return true;
}

function matchEntryForAgent(agent: AgentSummary, entries: MagpieEntry[]): MagpieEntry | null {
  if (entries.length === 0) return null;
  const ap = String(agent.provider || "").toLowerCase();
  const am = String(agent.model || "").toLowerCase();

  // 1. 精确 Provider / Model 匹配
  for (const e of entries) {
    const p = String(e.provider || "").toLowerCase();
    const n = String(e.name || "").toLowerCase();
    if (ap === p || ap === n) return e;
    if (am.includes(p) || (n && am.includes(n))) return e;
  }

  // 2. 常见命名别名匹配
  if (am.includes("gemini") || ap.includes("gemini") || am.includes("antigravity")) {
    const ag = entries.find((e) => e.provider === "antigravity" || e.provider === "ai-studio");
    if (ag) return ag;
  }
  if (am.includes("gpt") || am.includes("codex") || ap.includes("codex")) {
    const cx = entries.find((e) => e.provider === "codex");
    if (cx) return cx;
  }
  if (am.includes("claude") || am.includes("kiro") || ap.includes("kiro")) {
    const kr = entries.find((e) => e.provider === "kiro" || e.provider === "claude");
    if (kr) return kr;
  }
  if (am.includes("workbuddy") || ap.includes("workbuddy")) {
    const wb = entries.find((e) => e.provider === "workbuddy-ai" || e.provider === "workbuddy");
    if (wb) return wb;
  }
  if (am.includes("glm") || am.includes("zcode") || ap.includes("zcode")) {
    const zc = entries.find((e) => e.provider === "zcode");
    if (zc) return zc;
  }

  // 3. 兜底返回用量最高的或者第一个有效账号
  return entries.find((e) => (e.windows?.length ?? 0) > 0) ?? entries[0] ?? null;
}

function derivePillPresentation(agent: AgentSummary, entries: MagpieEntry[]) {
  const entry = matchEntryForAgent(agent, entries);
  if (!entry) {
    return {
      label: "Magpie",
      title: "Magpie 额度监控 - 点击查看",
    };
  }

  const providerName = entry.name || entry.provider;
  const rawWindows = (entry.windows ?? []).filter(isQuotaWindow);

  // 检查是否有冷却中
  const coolingWin = rawWindows.find((w) => w.display === "冷却中");
  if (coolingWin) {
    return {
      label: `${providerName} ❄️冷却`,
      title: `[${providerName}] 处于熔断冷却状态 - 点击查看详情`,
    };
  }

  // 找到最高用量或核心周期的 window
  let targetWin = rawWindows.find((w) => /7\s*day/iu.test(w.name) || /7d/iu.test(w.name));
  if (!targetWin && rawWindows.length > 0) {
    targetWin = [...rawWindows].sort((a, b) => (b.used ?? 0) - (a.used ?? 0))[0];
  }

  if (targetWin && typeof targetWin.used === "number") {
    const pct = Math.min(100, Math.max(0, Math.round(targetWin.used)));
    return {
      label: `${providerName} ${pct}%`,
      title: `[${providerName}] ${targetWin.name}: 已用 ${pct}% - 点击查看详情`,
    };
  }

  if (entry.balance) {
    return {
      label: `${providerName} ${entry.balance}`,
      title: `[${providerName}] 余额: ${entry.balance} - 点击查看详情`,
    };
  }

  return {
    label: providerName,
    title: `[${providerName}] 点击查看配额`,
  };
}

export function startPillManager(client: PluginClientContext): () => void {
  const pills = new Map<string, PluginButtonRegistration>();
  const agentsMap = new Map<string, AgentSummary>();
  const lifetime = new AbortController();

  const updateAllPills = () => {
    for (const [agentId, registration] of pills.entries()) {
      const agent = agentsMap.get(agentId);
      if (!agent) continue;
      const pres = derivePillPresentation(agent, cachedEntries);
      registration.update({
        label: pres.label,
        title: pres.title,
      });
    }
  };

  const registerPill = (agent: AgentSummary) => {
    if (lifetime.signal.aborted || !agent.workspaceId) return;
    agentsMap.set(agent.id, agent);

    pills.get(agent.id)?.remove();
    const pres = derivePillPresentation(agent, cachedEntries);

    const reg = client.addComposerPill({
      id: "magpie-usage",
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      button: {
        title: pres.title,
        icon: "Gauge",
        label: pres.label,
        behavior: {
          kind: "popover",
          Content: MagpiePopover,
        },
      },
    });
    pills.set(agent.id, reg);
  };

  const removeAll = () => {
    for (const pill of pills.values()) pill.remove();
    pills.clear();
    agentsMap.clear();
  };

  // 1. 订阅 Agent 列表与变动
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          removeAll();
          for (const { agent } of entries) {
            if (agent.workspaceId) {
              registerPill({
                id: agent.id,
                workspaceId: agent.workspaceId,
                provider: agent.provider,
                model: agent.model,
              });
            }
          }
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") {
            const a = update.agent;
            if (a.workspaceId) {
              registerPill({
                id: a.id,
                workspaceId: a.workspaceId,
                provider: a.provider,
                model: a.model,
              });
            }
          } else {
            pills.get(update.agentId)?.remove();
            pills.delete(update.agentId);
            agentsMap.delete(update.agentId);
          }
        },
      });
      return undefined;
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) {
        console.error("[magpie-usage] Agent observation failed:", error);
      }
    });

  // 2. 定时轮询 RPC 获取最新配额并更新所有胶囊
  const poll = async () => {
    if (lifetime.signal.aborted) return;
    try {
      const res = await client.rpc(getQuotasRpc, { force: false });
      if (res.ok && Array.isArray(res.entries)) {
        cachedEntries = res.entries;
        updateAllPills();
      }
    } catch {
      // 忽略后台静默轮询异常
    }
  };

  void poll();
  const timer = setInterval(() => {
    void poll();
  }, 15_000);

  return () => {
    lifetime.abort();
    clearInterval(timer);
    removeAll();
  };
}
