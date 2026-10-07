import { describe, expect, test } from "bun:test";
import { Rhythm, decorate, include, type Middleware } from "@rhythmjs/rhythm";
import { mockModule, runMiddleware, withMockContext } from "./rhythm";

describe("mockModule", () => {
  test("stands in for a real module with typed exports", async () => {
    const fakeConfigService = { get: (key: string) => (key === "port" ? 8080 : undefined) };
    const seen: unknown[] = [];

    const app = new Rhythm()
      .register(
        // production: include(configModule, (m) => ({ configService: m.configService }))
        include(mockModule({ configService: fakeConfigService }), (m) => ({ configService: m.configService })),
      )
      .use(async (ctx, next) => {
        seen.push(ctx.configService.get("port"));
        await next();
      });

    await app.callback()();

    expect(seen).toEqual([8080]);
  });
});

describe("withMockContext", () => {
  test("mock values replace real startup values", async () => {
    const app = new Rhythm().register(decorate(() => ({ name: "real" })));

    const ctx = (await withMockContext(app, { name: "mock" }).callback()({})) as { name: string };

    expect(ctx.name).toBe("mock");
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
