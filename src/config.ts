import { readFileSync } from 'fs';
import { z } from 'zod';

export const AuthConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('none'),
  }),
  z.object({
    type: z.literal('basic'),
    username: z.string(),
    password: z.string(),
  }),
  z.object({
    type: z.literal('bearer'),
    token: z.string(),
  }),
]);

export type AuthConfig = z.infer<typeof AuthConfigSchema>;

export const EnvironmentSchema = z.object({
  name: z.string(),
  baseUrl: z.string().url(),
  auth: AuthConfigSchema.default({ type: 'none' }),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

export const ConfigSchema = z.object({
  environments: z.array(EnvironmentSchema).min(1),
  defaultEnvironment: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfigFromEnvVars(): Config | null {
  const baseUrl = process.env.AKHQ_BASE_URL;
  if (!baseUrl) return null;

  const authType = (process.env.AKHQ_AUTH_TYPE ?? 'none') as 'none' | 'basic' | 'bearer';
  let auth: AuthConfig;

  if (authType === 'basic') {
    const username = process.env.AKHQ_AUTH_USERNAME ?? '';
    const password = process.env.AKHQ_AUTH_PASSWORD ?? '';
    auth = { type: 'basic', username, password };
  } else if (authType === 'bearer') {
    const token = process.env.AKHQ_AUTH_TOKEN ?? '';
    auth = { type: 'bearer', token };
  } else {
    auth = { type: 'none' };
  }

  return {
    environments: [
      {
        name: process.env.AKHQ_ENV_NAME ?? 'default',
        baseUrl,
        auth,
      },
    ],
    defaultEnvironment: process.env.AKHQ_ENV_NAME ?? 'default',
  };
}

function loadConfigFromFile(path: string): Config {
  const raw = readFileSync(path, 'utf-8');
  const json = JSON.parse(raw);
  return ConfigSchema.parse(json);
}

export function loadConfig(): Config {
  const configFilePath = process.env.AKHQ_CONFIG_FILE;
  if (configFilePath) {
    return loadConfigFromFile(configFilePath);
  }

  const envConfig = loadConfigFromEnvVars();
  if (envConfig) {
    return envConfig;
  }

  // Default fallback for local development
  return {
    environments: [
      {
        name: 'local',
        baseUrl: 'http://localhost:8080',
        auth: { type: 'none' },
      },
    ],
    defaultEnvironment: 'local',
  };
}
