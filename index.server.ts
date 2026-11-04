import type { PluginServerContext } from "@getpaseo/plugin/server";
import { inputSchema } from "./shared/input.js";
import { discover, fetchUsage } from "./server/usage.js";
import { getQuotasRpc } from "./shared/quotas.js";
import { getMagpieEntries } from "./server/quotas.js";

export default function contribute(server: PluginServerContext) {
  // 1. 保留 Paseo 原生 usage source 接口（供 Settings → Usage 及系统内置视图消费）
  server.registerUsageSource({
    id: "magpie",
    label: "Magpie",
    icon: "icon.svg",
    input: inputSchema,
    discover,
    fetch: (input) => fetchUsage(inputSchema.parse(input)),
  });

  // 2. 注册 RPC 供 client 端胶囊（Composer Pill）与悬浮卡片（Popover）消费
  server.handle(getQuotasRpc, async ({ force }) => {
    return await getMagpieEntries(force);
  });

  return () => {};
}
