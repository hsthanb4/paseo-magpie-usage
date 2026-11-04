import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const MagpieWindowSchema = z
  .object({
    name: z.string(),
    used: z.number().nullish(),
    remaining: z.number().nullish(),
    resetsAt: z.string().nullish(),
    runsOutAt: z.string().nullish(),
    display: z.string().nullish(),
    amount: z.number().nullish(),
    limit: z.number().nullish(),
    unit: z.string().nullish(),
    pool: z.string().nullish(),
    text: z.boolean().nullish(),
  })
  .passthrough();

export const MagpieEntrySchema = z
  .object({
    provider: z.string(),
    name: z.string().nullish(),
    kind: z.string().nullish(),
    plan: z.string().nullish(),
    user: z.string().nullish(),
    windows: z.array(MagpieWindowSchema).nullish(),
    error: z.string().nullish(),
    balance: z.string().nullish(),
    readAt: z.string().nullish(),
  })
  .passthrough();

export type MagpieEntry = z.infer<typeof MagpieEntrySchema>;
export type MagpieWindow = z.infer<typeof MagpieWindowSchema>;

export const getQuotasRpc = defineRpc({
  name: "magpie.get_quotas",
  input: z.object({
    force: z.boolean().optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
    entries: z.array(MagpieEntrySchema),
    updatedAt: z.string(),
  }),
});
