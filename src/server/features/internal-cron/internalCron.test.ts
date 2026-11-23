import { describe, expect, it, vi } from "vitest";
import { handleInternalCron, INTERNAL_CRON_PATH } from "./internalCron";

const SECRET = "s".repeat(32);
const CRONS = ["*/5 * * * *", "17 3 * * *"] as const;

function call(
  env: Record<string, unknown>,
  init: { method?: string; auth?: string; cron?: string } = {},
) {
  const run = vi.fn(async () => undefined);
  const url = new URL(`http://localhost${INTERNAL_CRON_PATH}`);
  if (init.cron) url.searchParams.set("cron", init.cron);
  const request = new Request(url, {
    method: init.method ?? "POST",
    headers: init.auth ? { authorization: init.auth } : {},
  });
  return { run, response: handleInternalCron(request, env, CRONS, run) };
}

describe("internal cron endpoint", () => {
  it("does not exist without a long enough secret", async () => {
    for (const env of [{}, { OPENSEO_CRON_SECRET: "short" }]) {
      const { run, response } = call(env, { auth: "Bearer short" });
      expect((await response).status).toBe(404);
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("refuses a missing or wrong key and never runs the jobs", async () => {
    const env = { OPENSEO_CRON_SECRET: SECRET };
    for (const auth of [
      undefined,
      "Bearer nope",
      `Bearer ${SECRET}x`,
      SECRET,
    ]) {
      const { run, response } = call(env, { auth });
      expect((await response).status).toBe(401);
      expect(run).not.toHaveBeenCalled();
    }
    const get = call(env, { method: "GET", auth: `Bearer ${SECRET}` });
    expect((await get.response).status).toBe(405);
    expect(get.run).not.toHaveBeenCalled();
  });

  it("runs the named cron with the right key, and only known crons", async () => {
    const env = { OPENSEO_CRON_SECRET: SECRET };
    const ok = call(env, { auth: `Bearer ${SECRET}` });
    expect((await ok.response).status).toBe(200);
    expect(ok.run).toHaveBeenCalledWith("*/5 * * * *");
    const daily = call(env, { auth: `Bearer ${SECRET}`, cron: "17 3 * * *" });
    expect((await daily.response).status).toBe(200);
    expect(daily.run).toHaveBeenCalledWith("17 3 * * *");
    const unknown = call(env, { auth: `Bearer ${SECRET}`, cron: "* * * * *" });
    expect((await unknown.response).status).toBe(400);
    expect(unknown.run).not.toHaveBeenCalled();
  });
});
