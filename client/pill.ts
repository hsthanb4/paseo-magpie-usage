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
let lastFetchedAt = 0;

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

  // 1. 精确 Provider 匹配
  for (const e of entries) {
    const p = String(e.provider || "").toLowerCase();
    const n = String(e.name || "").toLowerCase();
    if (ap === p || ap === n) return e;
    if (am.includes(p) || (n && am.includes(n))) return e;
  }

  // 2. 路由组与别名映射
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
  if (am.includes("workbuddy") || ap.includes("workbuddy") || am.includes("hy4free")) {
    const wb = entries.find((e) => e.provider === "workbuddy-ai" || e.provider === "workbuddy");
    if (wb) return wb;
  }
  if (am.includes("glm") || am.includes("zcode") || ap.includes("zcode")) {
    const zc = entries.find((e) => e.provider === "zcode");
    if (zc) return zc;
  }
  if (am.includes("qoder") || ap.includes("qoder")) {
    const qd = entries.find((e) => e.provider === "qoder");
    if (qd) return qd;
  }

  // 3. 兜底返回第一个正常账号
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

  // 1. 冷却中提示
  const coolingWin = rawWindows.find((w) => w.display === "冷却中");
  if (coolingWin) {
    return {
      label: `${providerName} ❄️冷却`,
      title: `[${providerName}] 处于熔断冷却状态 - 点击查看详情`,
    };
  }

  // 2. 7天或核心周期窗口
  let targetWin = rawWindows.find((w) => /7\s*day/iu.test(w.name) || /7d/iu.test(w.name));

  // 3. 如果没有 7天，挑任意有 used 明确数字的窗口（如 Free model tokens 25%、Credits 0% 等）
  if (!targetWin && rawWindows.length > 0) {
    const withUsed = rawWindows.filter((w) => typeof w.used === "number");
    if (withUsed.length > 0) {
      targetWin = [...withUsed].sort((a, b) => (b.used ?? 0) - (a.used ?? 0))[0];
    } else {
      targetWin = rawWindows[0];
    }
  }

  if (targetWin && typeof targetWin.used === "number") {
    const pct = Math.min(100, Math.max(0, Math.round(targetWin.used)));
    return {
      label: `${providerName} ${pct}%`,
      title: `[${providerName}] ${targetWin.name}: 已用 ${pct}% - 点击查看详情`,
    };
  }

  if (targetWin?.display) {
    return {
      label: `${providerName} ${targetWin.display}`,
      title: `[${providerName}] ${targetWin.name}: ${targetWin.display} - 点击查看详情`,
    };
  }

  if (entry.balance) {
    return {
      label: `${providerName} ${entry.balance}`,
      title: `[${providerName}] 余额: ${entry.balance} - 点击查看详情`,
    };
  }

  if (entry.error) {
    return {
      label: `${providerName} ⚠️`,
      title: `[${providerName}] ${entry.error} - 点击查看详情`,
    };
  }

  return {
    label: providerName,
    title: `[${providerName}] 点击查看配额`,
  };
}

export function startPillManager(client: PluginClientContext): () => void {
  interface PillRecord {
    reg: PluginButtonRegistration;
    currentLabel: string;
    currentTitle: string;
    workspaceId: string;
  }
  const pills = new Map<string, PillRecord>();
  const agentsMap = new Map<string, AgentSummary>();
  const lifetime = new AbortController();

  const updateAllPills = () => {
    for (const [agentId, record] of pills.entries()) {
      const agent = agentsMap.get(agentId);
      if (!agent) continue;
      const pres = derivePillPresentation(agent, cachedEntries);
      if (record.currentLabel !== pres.label || record.currentTitle !== pres.title) {
        record.currentLabel = pres.label;
        record.currentTitle = pres.title;
        record.reg.update({
          label: pres.label,
          title: pres.title,
        });
      }
    }
  };

  const registerPill = (agent: AgentSummary) => {
    if (lifetime.signal.aborted || !agent.id || !agent.workspaceId) return;

    // 检查是否已经为该 agent 注册且信息未变
    const existing = pills.get(agent.id);
    const pres = derivePillPresentation(agent, cachedEntries);

    if (existing && existing.workspaceId === agent.workspaceId) {
      if (existing.currentLabel !== pres.label || existing.currentTitle !== pres.title) {
        existing.currentLabel = pres.label;
        existing.currentTitle = pres.title;
        existing.reg.update({
          label: pres.label,
          title: pres.title,
        });
      }
      agentsMap.set(agent.id, agent);
      return;
    }

    // 移除旧注册
    existing?.reg.remove();
    agentsMap.set(agent.id, agent);

    // 关键改进：每个 agent 拥有独立的 Pill ID，防止同一个工作区不同会话相互覆盖
    const reg = client.addComposerPill({
      id: `magpie-usage-${agent.id}`,
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

    pills.set(agent.id, {
      reg,
      currentLabel: pres.label,
      currentTitle: pres.title,
      workspaceId: agent.workspaceId,
    });
  };

  const removeAll = () => {
    for (const pill of pills.values()) pill.reg.remove();
    pills.clear();
    agentsMap.clear();
  };

  // 1. WebSocket 事件流订阅（实时接收 Agent 创建/更新/销毁）
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
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
          } else if (update.kind === "remove") {
            pills.get(update.agentId)?.reg.remove();
            pills.delete(update.agentId);
            agentsMap.delete(update.agentId);
          }
        },
      });
      return undefined;
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) {
        console.error("[magpie-usage] Agent subscription error:", error);
      }
    });

  // 2. 双保险轮询：每 3 秒主动扫一次活跃 Agent 列表，确保新建会话 100% 出现胶囊
  const syncAgentsActive = async () => {
    if (lifetime.signal.aborted) return;
    try {
      const res = await client.paseo.agents.list({ signal: lifetime.signal });
      if (res && Array.isArray(res.entries)) {
        for (const item of res.entries) {
          const a = item.agent;
          if (a?.id && a.workspaceId) {
            registerPill({
              id: a.id,
              workspaceId: a.workspaceId,
              provider: a.provider,
              model: a.model,
            });
          }
        }
      }
    } catch {
      // 静默容错
    }
  };

  // 3. 配额定期拉取
  const pollQuotas = async () => {
    if (lifetime.signal.aborted) return;
    try {
      const res = await client.rpc(getQuotasRpc, { force: false });
      if (res.ok && Array.isArray(res.entries)) {
        cachedEntries = res.entries;
        lastFetchedAt = Date.now();
        updateAllPills();
      }
    } catch {
      // 容错
    }
  };

  void pollQuotas();
  void syncAgentsActive();

  // 2.5 秒主动对齐 Agents 活跃度（确保新开会话立即现身）
  const agentSyncTimer = setInterval(() => {
    void syncAgentsActive();
  }, 2_500);

  // 20 秒拉取一次配额变化
  const quotaTimer = setInterval(() => {
    void pollQuotas();
  }, 20_000);

  return () => {
    lifetime.abort();
    clearInterval(agentSyncTimer);
    clearInterval(quotaTimer);
    removeAll();
  };
}

export function getCachedMagpieEntries(): { entries: MagpieEntry[]; updatedAt: number } {
  return { entries: cachedEntries, updatedAt: lastFetchedAt };
}
