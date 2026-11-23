import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";

// Fork addition (FORK-CHANGES.md): encrypt third-party secrets kept in the
// database (PostHog API keys) the way Better Auth encrypts OAuth tokens:
// authenticated symmetric encryption keyed by BETTER_AUTH_SECRET.

export class SecretKeyMissingError extends Error {
  constructor() {
    super("BETTER_AUTH_SECRET is required to store API keys.");
    this.name = "SecretKeyMissingError";
  }
}

async function secret(): Promise<string> {
  const value = (await getOptionalEnvValue("BETTER_AUTH_SECRET"))?.trim();
  if (!value) throw new SecretKeyMissingError();
  return value;
}

export async function encryptSecret(data: string): Promise<string> {
  return symmetricEncrypt({ key: await secret(), data });
}

export async function decryptSecret(data: string): Promise<string> {
  return symmetricDecrypt({ key: await secret(), data });
}
