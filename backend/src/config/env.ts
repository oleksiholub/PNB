import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.string().default("8080"),
  GCP_REGION: z.string().min(1, "GCP_REGION is required"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  SERVICE_AUDIENCE: z.string().optional(),
  TRUSTED_SERVICE_ACCOUNTS: z.string().optional(),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_APP_INSTALLATION_ID: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${parsed.error.message}`
    );
  }
  return parsed.data;
}