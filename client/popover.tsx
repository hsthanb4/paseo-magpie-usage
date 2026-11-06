import React, { useState, useEffect, useMemo, useCallback } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useRpc, useAgent } from "@getpaseo/plugin/client";
import { getQuotasRpc, type MagpieEntry, type MagpieWindow } from "../shared/quotas.js";
import { knownProviders, pickEntry, resolveProvider, type ModelOwners } from "../shared/match.js";
import { getCachedMagpieEntries } from "./pill.js";

function maskEmail(email: string | null | undefined, enabled: boolean): string {
  if (!email) return "";
  if (!enabled) return email;
  const atIdx = email.indexOf("@");
  if (atIdx <= 1) return email;
  const name = email.slice(0, atIdx);
  const domain = email.slice(atIdx);
  if (name.length <= 2) return `${name[0]}***${domain}`;
  return `${name[0]}***${name[name.length - 1]}${domain}`;
}

function formatRelative(targetIso: string | null | undefined): string {
  if (!targetIso) return "";
  try {
    const target = new Date(targetIso).getTime();
    const now = Date.now();
    const diffMs = target - now;
    if (diffMs <= 0) return "已重置";
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins} 分钟后`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 48) return `${diffHours} 小时后`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} 天后`;
  } catch {
    return "";
  }
}

function isQuotaWindow(w: MagpieWindow): boolean {
  if (w.text) return false;
  if (typeof w.display === "string" && /^https?:\/\//iu.test(w.display.trim())) return false;
  const name = String(w.name || "").trim();
  if (["代理出口", "管理页", "代理", "管理", "出口"].includes(name)) return false;
  return true;
}

export function MagpiePopover(props: PluginButtonContentProps) {
  const { theme, close } = props;
  const agentId = props.context === "agent" ? props.agentId : "";
  const getQuotas = useRpc(getQuotasRpc);

  // 关键优化 1：初始状态直接使用内存快照 (0ms 秒开，无白屏/加载跳动)
  const [entries, setEntries] = useState<MagpieEntry[]>(() => getCachedMagpieEntries().entries);
  const [loading, setLoading] = useState<boolean>(() => getCachedMagpieEntries().entries.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>(() => {
    const t = getCachedMagpieEntries().updatedAt;
    return t > 0 ? new Date(t).toISOString() : "";
  });
  const [modelOwners, setModelOwners] = useState<ModelOwners>(() => getCachedMagpieEntries().modelOwners);
  const [maskEnabled, setMaskEnabled] = useState(true);
  const [viewMode, setViewMode] = useState<"used" | "remaining">("used");

  const agentInfo = useAgent(agentId, (a) =>
    a
      ? {
          provider: a.provider,
          model: a.model,
        }
      : null,
  );

  const loadData = useCallback(
    async (force = false) => {
      // 如果已有缓存且非强制刷新，不展示阻塞 loading
      if (force || entries.length === 0) {
        setLoading(true);
      }
      setError(null);
      try {
        const res = await getQuotas({ force });
        if (res.ok) {
          setEntries(res.entries);
          setModelOwners(res.modelOwners);
          setUpdatedAt(res.updatedAt);
        } else {
          setError(res.error || "获取配额失败");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [getQuotas, entries.length],
  );

  useEffect(() => {
    // 如果缓存已超过 10 秒，打开弹层时静默对齐一次
    const age = Date.now() - getCachedMagpieEntries().updatedAt;
    if (age > 10_000 || entries.length === 0) {
      void loadData(false);
    }
  }, [loadData, entries.length]);

  // Exactly one account is "the current session": the provider the model resolves to, and within
  // it the account Magpie is serving from. Family-name guessing marked Kiro and Claude together.
  const servingEntry = useMemo(() => {
    const provider = resolveProvider(
      { provider: agentInfo?.provider, model: agentInfo?.model },
      knownProviders(entries),
      modelOwners,
    );
    return pickEntry(provider, entries);
  }, [agentInfo, entries, modelOwners]);
  const isAgentProviderMatch = useCallback((entry: MagpieEntry) => entry === servingEntry, [servingEntry]);

  const sortedEntries = useMemo(() => {
    const list = [...entries];
    list.sort((a, b) => {
      const aMatch = isAgentProviderMatch(a);
      const bMatch = isAgentProviderMatch(b);
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });
    return list;
  }, [entries, isAgentProviderMatch]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          width: 380,
          maxHeight: 520,
          padding: 14,
          gap: 10,
          backgroundColor: theme.colors.surface0,
          borderRadius: 12,
        },
        header: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: 8,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
        },
        title: {
          fontSize: 15,
          fontWeight: "600",
          color: theme.colors.foreground,
        },
        subtitle: {
          fontSize: 11,
          color: theme.colors.foregroundMuted,
        },
        headerActions: {
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        },
        actionButton: {
          paddingVertical: 3,
          paddingHorizontal: 7,
          borderRadius: 6,
          backgroundColor: theme.colors.surface1,
        },
        actionButtonText: {
          fontSize: 11,
          color: theme.colors.foreground,
        },
        scrollContent: {
          gap: 10,
          paddingVertical: 4,
        },
        card: {
          padding: 10,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
          gap: 8,
        },
        cardHighlight: {
          borderColor: theme.colors.accent,
          backgroundColor: theme.colors.surface2,
        },
        cardHeader: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        },
        providerBadge: {
          paddingVertical: 2,
          paddingHorizontal: 6,
          borderRadius: 4,
          backgroundColor: theme.colors.accent,
        },
        providerBadgeText: {
          fontSize: 11,
          fontWeight: "600",
          color: theme.colors.accentForeground,
        },
        sessionBadge: {
          paddingVertical: 2,
          paddingHorizontal: 6,
          borderRadius: 4,
          backgroundColor: theme.colors.statusSuccess,
        },
        sessionBadgeText: {
          fontSize: 10,
          fontWeight: "600",
          color: theme.colors.surface0,
        },
        userInfo: {
          flex: 1,
          marginLeft: 8,
        },
        userText: {
          fontSize: 12,
          fontWeight: "500",
          color: theme.colors.foreground,
        },
        planText: {
          fontSize: 10,
          color: theme.colors.foregroundMuted,
        },
        windowsList: {
          gap: 6,
          marginTop: 2,
        },
        windowRow: {
          gap: 2,
        },
        windowLabels: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        windowName: {
          fontSize: 11,
          color: theme.colors.foregroundMuted,
        },
        windowVal: {
          fontSize: 11,
          fontWeight: "600",
          color: theme.colors.foreground,
        },
        windowReset: {
          fontSize: 10,
          color: theme.colors.foregroundMuted,
        },
        progressBarTrack: {
          height: 5,
          borderRadius: 3,
          backgroundColor: theme.colors.surface0,
          overflow: "hidden",
        },
        progressBarFill: {
          height: "100%",
          borderRadius: 3,
        },
        errorBanner: {
          padding: 6,
          borderRadius: 6,
          backgroundColor: theme.colors.surface2,
          borderWidth: 1,
          borderColor: theme.colors.statusDanger,
        },
        errorText: {
          fontSize: 11,
          color: theme.colors.statusDanger,
        },
        footer: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 8,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
        },
        footerText: {
          fontSize: 10,
          color: theme.colors.foregroundMuted,
        },
        closeButton: {
          paddingVertical: 4,
          paddingHorizontal: 12,
          borderRadius: 6,
          backgroundColor: theme.colors.surface1,
        },
        closeButtonText: {
          fontSize: 12,
          color: theme.colors.foreground,
        },
      }),
    [theme],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Magpie 配额状态</Text>
          <Text style={styles.subtitle}>
            {loading ? "正在同步..." : updatedAt ? `更新于 ${new Date(updatedAt).toLocaleTimeString()}` : "本地网关"}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setViewMode((m) => (m === "used" ? "remaining" : "used"))}
            style={styles.actionButton}
          >
            <Text style={styles.actionButtonText}>{viewMode === "used" ? "已用视角" : "剩余视角"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setMaskEnabled((v) => !v)}
            style={styles.actionButton}
          >
            <Text style={styles.actionButtonText}>{maskEnabled ? "脱敏: 开" : "脱敏: 关"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadData(true)}
            style={styles.actionButton}
          >
            <Text style={styles.actionButtonText}>刷新</Text>
          </Pressable>
        </View>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={styles.scrollContent}>
        {sortedEntries.length === 0 && !loading ? (
          <Text style={{ textAlign: "center", color: theme.colors.foregroundMuted, padding: 20 }}>
            暂无 Magpie 账号配额数据
          </Text>
        ) : null}

        {sortedEntries.map((entry, idx) => {
          const isMatch = isAgentProviderMatch(entry);
          const rawWindows = (entry.windows ?? []).filter(isQuotaWindow);
          const providerLabel = entry.name || entry.provider;
          const displayUser = maskEmail(entry.user, maskEnabled);

          return (
            <View key={`${entry.provider}:${entry.user || idx}`} style={[styles.card, isMatch && styles.cardHighlight]}>
              <View style={styles.cardHeader}>
                <View style={styles.providerBadge}>
                  <Text style={styles.providerBadgeText}>{providerLabel}</Text>
                </View>
                <View style={styles.userInfo}>
                  <Text style={styles.userText} numberOfLines={1}>
                    {displayUser || "默认账号"}
                  </Text>
                  {entry.plan ? <Text style={styles.planText}>{entry.plan}</Text> : null}
                </View>
                {isMatch ? (
                  <View style={styles.sessionBadge}>
                    <Text style={styles.sessionBadgeText}>当前会话</Text>
                  </View>
                ) : null}
              </View>

              {entry.error ? (
                <Text style={{ fontSize: 11, color: theme.colors.statusDanger }}>{entry.error}</Text>
              ) : null}

              <View style={styles.windowsList}>
                {rawWindows.map((w, wIdx) => {
                  const usedPct =
                    typeof w.used === "number"
                      ? Math.min(100, Math.max(0, Math.round(w.used * 10) / 10))
                      : typeof w.remaining === "number"
                        ? 100 - w.remaining
                        : null;

                  const remainPct =
                    typeof w.remaining === "number"
                      ? Math.min(100, Math.max(0, Math.round(w.remaining * 10) / 10))
                      : usedPct != null
                        ? 100 - usedPct
                        : null;

                  const isCooling = w.display === "冷却中";
                  const displayPct = viewMode === "used" ? usedPct : remainPct;
                  const relativeReset = formatRelative(w.resetsAt || w.runsOutAt);

                  let barColor = theme.colors.accent;
                  if (usedPct != null) {
                    if (usedPct >= 85) barColor = theme.colors.statusDanger;
                    else if (usedPct >= 65) barColor = theme.colors.statusWarning;
                    else barColor = theme.colors.statusSuccess;
                  }
                  if (isCooling) barColor = theme.colors.statusDanger;

                  return (
                    <View key={w.name || wIdx} style={styles.windowRow}>
                      <View style={styles.windowLabels}>
                        <Text style={styles.windowName}>{w.name}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          {relativeReset ? <Text style={styles.windowReset}>{relativeReset}</Text> : null}
                          <Text style={styles.windowVal}>
                            {isCooling
                              ? "冷却中"
                              : displayPct != null
                                ? `${displayPct}%`
                                : w.display || "--"}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.progressBarTrack}>
                        <View
                          style={[
                            styles.progressBarFill,
                            {
                              width: `${Math.min(100, Math.max(0, displayPct ?? 0))}%`,
                              backgroundColor: barColor,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.footerText}>网关: 127.0.0.1:3425</Text>
        <Pressable accessibilityRole="button" onPress={close} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>完成</Text>
        </Pressable>
      </View>
    </View>
  );
}
