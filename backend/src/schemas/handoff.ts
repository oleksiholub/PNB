import { z } from "zod";

export const HandoffRequestSchema = z.object({
  source_chat_id: z.string().uuid({ message: "source_chat_id must be a valid UUID" }),
  target_chat_id: z.string().uuid({ message: "target_chat_id must be a valid UUID" }),
  target_session_id: z.string().min(1, "target_session_id is required"),
});

export type HandoffRequest = z.infer<typeof HandoffRequestSchema>;