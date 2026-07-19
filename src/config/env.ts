import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.string().default("production"),
  PORT: z.string().default("8080"),
  GCP_REGION: z.string(),
  GCP_PROJECT_ID: z.string(),
  FIREBASE_PROJECT_ID: z.string(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${JSON.stringify(parsed.error.format())}`
    );
  }
  return parsed.data;
}
