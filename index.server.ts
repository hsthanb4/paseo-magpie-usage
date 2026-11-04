import type { PluginServerContext } from "@getpaseo/plugin/server";
import { inputSchema } from "./shared/input.js";
import { discover, fetchUsage } from "./server/usage.js";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource({
    id: "magpie",
    label: "Magpie",
    icon: "icon.svg",
    input: inputSchema,
    discover,
    fetch: (input) => fetchUsage(inputSchema.parse(input)),
  });
  return () => {};
}
