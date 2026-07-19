import { z } from "zod";

export const MetadataSchema = z
  .object({
    model_context: z.string().optional(),
    browser_family: z.enum(["kiwi", "helium", "lemur", "other"]).optional(),
    device_platform: z.literal("android").optional(),
  })
  .partial()
  .optional();

export const CodeArtifactInputSchema = z.object({
  artifact_type: z.literal("code"),
  content: z.string().min(1, "content must not be empty"),
  push_requested: z.boolean().default(false),
  qa_status: z.enum(["PASSED", "FAILED", "FIXING"]).optional(),
});

export const ConversationInputSchema = z.object({
  user_message: z.string().optional(),
  model_response: z.string().optional(),
});

export const CaptureRequestSchema = z
  .object({
    chat_id: z.string().uuid({ message: "chat_id must be a valid UUID" }),
    session_id: z.string().min(1, "session_id is required"),
    metadata: MetadataSchema,
  })
  .and(
    z.union([
      ConversationInputSchema.refine(
        (v) => Boolean(v.user_message || v.model_response),
        {
          message:
            "At least one of user_message or model_response is required for conversation capture",
        }
      ),
      CodeArtifactInputSchema,
    ])
  );

export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;

export function normalizeQaStatus(
  qaStatus: "PASSED" | "FAILED" | "FIXING" | undefined
): "PASSED" | "FAILED" | "FIXING" {
  return qaStatus ?? "FAILED";
}