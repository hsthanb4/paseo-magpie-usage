import { z } from "zod";

/** Locates one Magpie account. Opaque to the daemon. */
export const inputSchema = z
  .object({
    provider: z.string().min(1),
    user: z.string(),
  })
  .strict();
export type UsageInput = z.infer<typeof inputSchema>;
