import type { PluginClientContext } from "@getpaseo/plugin/client";
import { startPillManager } from "./client/pill.js";

export default function contribute(client: PluginClientContext) {
  // 启动输入框底部状态栏胶囊（Composer Pill）管理器
  const stopPillManager = startPillManager(client);

  return () => {
    stopPillManager();
  };
}
