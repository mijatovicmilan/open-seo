// The scheduled jobs over HTTP (fork feature, see FORK-CHANGES.md). Local
// Docker runs `vite preview`, which never fires Cloudflare's cron triggers;
// a small sidecar container calls this endpoint every five minutes instead,
// and it runs the same `scheduled` work as Cloudflare: outreach sending, rank
// checks, and once a day the Search Console sync.
//
// The endpoint answers 404 unless OPENSEO_CRON_SECRET is set (at least 24
// characters), and runs only for `Authorization: Bearer <that secret>`,
// compared in constant time.

export const INTERNAL_CRON_PATH = "/api/internal/cron";

const MIN_SECRET_LENGTH = 24;

async function digest(value: string) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

/** Compares SHA-256 digests byte by byte without stopping early. */
async function sameSecret(given: string, expected: string) {
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

function secretFrom(env: unknown) {
  const value: unknown =
    typeof env === "object" && env !== null
      ? Reflect.get(env, "OPENSEO_CRON_SECRET")
      : undefined;
  return typeof value === "string" && value.trim().length >= MIN_SECRET_LENGTH
    ? value.trim()
    : null;
}

export async function handleInternalCron(
  request: Request,
  env: unknown,
  crons: readonly string[],
  run: (cron: string) => Promise<unknown>,
): Promise<Response> {
  const secret = secretFrom(env);
  if (!secret) return new Response("Not found", { status: 404 });
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const header = request.headers.get("authorization") ?? "";
  if (!(await sameSecret(header, `Bearer ${secret}`))) {
    return new Response("Unauthorized", { status: 401 });
  }
  const cron = new URL(request.url).searchParams.get("cron") ?? crons[0] ?? "";
  if (!crons.includes(cron)) {
    return new Response("Unknown cron", { status: 400 });
  }
  const startedAt = new Date().toISOString();
  try {
    await run(cron);
    return Response.json({ ok: true, cron, startedAt });
  } catch (error) {
    console.error("[internal-cron] run failed", error);
    return Response.json({ ok: false, cron, startedAt }, { status: 500 });
  }
}
