import { z } from "zod";

const SelectorEntrySchema = z.object({
  type: z.enum(["css", "xpath", "text", "regex"]),
  value: z.string().min(1),
  priority: z.number(),
});

const SelectorEntryListSchema = z.array(SelectorEntrySchema).min(1);

export const SelectorConfigPayloadSchema = z.object({
  version: z.string().min(1),
  target_host: z.string().optional(),
  selectors: z.object({
    chat_container: SelectorEntryListSchema,
    message_blocks: SelectorEntryListSchema,
    user_input_textarea: SelectorEntryListSchema,
    send_button: SelectorEntryListSchema,
    model_picker: SelectorEntryListSchema,
    captcha_indicators: SelectorEntryListSchema,
    push_command_markers: SelectorEntryListSchema,
    qa_status_markers: SelectorEntryListSchema,
  }).passthrough(),
  timeouts_ms: z.record(z.number()).optional(),
  jitter_ms: z.object({ min: z.number(), max: z.number() }).optional(),
}).passthrough();

export type SelectorConfigPayload = z.infer<typeof SelectorConfigPayloadSchema>;