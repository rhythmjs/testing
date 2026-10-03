import { describe, expect, test } from "bun:test";
import type { Middleware } from "@rhythmjs/rhythm/types";
import { Rhythm } from "@rhythmjs/rhythm";
import { mockModule, runMiddleware } from "./rhythm";

describe("mockModule", () => {
  test("stands in for a real module with typed exports", async () => {
    const fakeConfigService = { get: (key: string) => (key === "port" ? 8080 : undefined) };
    const seen: unknown[] = [];

    const apiModule = new Rhythm<{ configService: typeof fakeConfigService }>().use(async (ctx, next) => {
      seen.push(ctx.configService.get("port"));
      await next();
    });

    const app = new Rhythm()
      .register(mockModule({ configService: fakeConfigService }), (m) => ({ configService: m.configService }))
      .register(apiModule);

    await app.run({});

    expect(seen).toEqual([8080]);
  });
});

describe("runMiddleware", () => {
  test("reports whether next was reached, over any context shape", async () => {
    const gate: Middleware<{ allowed: boolean; note?: string }> = async (ctx, next) => {
      if (!ctx.allowed) return;
      ctx.note = "passed";
      await next();
    };

    const blocked = await runMiddleware(gate, { allowed: false } as { allowed: boolean; note?: string });
    expect(blocked.nextCalled).toBe(false);

    const passed = await runMiddleware(gate, { allowed: true } as { allowed: boolean; note?: string });
    expect(passed.nextCalled).toBe(true);
    expect(passed.ctx.note).toBe("passed");
  });
});
