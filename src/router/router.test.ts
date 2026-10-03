import { describe, expect, test } from "bun:test";
import type { Middleware } from "@rhythmjs/rhythm/types";
import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmRouter } from "@rhythmjs/router";
import type { RhythmHttpContext } from "@rhythmjs/router/adapters/context";
import { createTestClient, runHttpMiddleware } from "./router";

const echoRouter = () =>
  new RhythmRouter()
    .get("/hello", (ctx) => {
      ctx.json({ message: "hi" });
    })
    .post("/echo", async (ctx) => {
      ctx.json({ received: await ctx.request.json(), type: ctx.request.headers.get("content-type") });
    })
    .delete("/items/:id", (ctx) => {
      ctx.response.status = 204;
    });

describe("createTestClient", () => {
  test("drives a full Rhythm app over fetch semantics", async () => {
    const client = createTestClient(new Rhythm<RhythmHttpContext>().use(echoRouter().middleware()));

    const res = await client.get("/hello");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "hi" });
  });

  test("accepts a bare router", async () => {
    const client = createTestClient(echoRouter());

    expect((await client.get("/hello")).status).toBe(200);
    expect((await client.delete("/items/7")).status).toBe(204);
  });

  test("json option serializes the body and sets content-type", async () => {
    const client = createTestClient(echoRouter());

    const res = await client.post("/echo", { json: { a: 1 } });
    expect(await res.json()).toEqual({ received: { a: 1 }, type: "application/json" });
  });

  test("explicit headers win over the implied json content-type", async () => {
    const client = createTestClient(echoRouter());

    const res = await client.post("/echo", {
      json: { a: 1 },
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    expect(((await res.json()) as { type: string }).type).toBe("application/json; charset=utf-8");
  });

  test("fetch passes a prebuilt Request through untouched", async () => {
    const client = createTestClient(echoRouter());

    const res = await client.fetch(new Request("http://localhost/hello"));
    expect(res.status).toBe(200);
  });

  test("context option injects mock startup values, and typechecks with startup-context apps", async () => {
    type Db = { find: (id: string) => string };
    const app = new Rhythm<RhythmHttpContext, { db: Db }>().use(async (ctx, next) => {
      ctx.json({ user: ctx.db.find("7") });
      await next();
    });
    app.context.db = { find: () => "real" };

    const client = createTestClient(app, { context: { db: { find: (id) => `mock-${id}` } } });

    expect(await (await client.get("/")).json()).toEqual({ user: "mock-7" });
  });

  test("context option reaches a bare router's wrapper app", async () => {
    const router = new RhythmRouter<RhythmHttpContext & { label: string }, RhythmHttpContext>().get("/who", (ctx) => {
      ctx.json({ label: ctx.label });
    });
    const client = createTestClient<{ label: string }>(router as never, { context: { label: "mocked" } });

    expect(await (await client.get("/who")).json()).toEqual({ label: "mocked" });
  });
});

describe("runHttpMiddleware", () => {
  const guard: Middleware<RhythmHttpContext> = async (ctx, next) => {
    if (ctx.request.headers.get("x-key") !== "secret") {
      ctx.error(401);
      return;
    }
    await next();
  };

  test("reports a blocked chain with the materialized response", async () => {
    const { nextCalled, response } = await runHttpMiddleware(guard, "/private");

    expect(nextCalled).toBe(false);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
  });

  test("reports a passed chain and exposes the mutable context", async () => {
    const { ctx, nextCalled, response } = await runHttpMiddleware(
      guard,
      new Request("http://localhost/private", { headers: { "x-key": "secret" } }),
    );

    expect(nextCalled).toBe(true);
    expect(response.status).toBe(200);
    expect(ctx.response.body).toBeNull();
  });

  test("extras are merged into the context for derive-style middleware", async () => {
    const usesService: Middleware<RhythmHttpContext & { userService: { name: () => string } }> = async (ctx, next) => {
      ctx.json({ user: ctx.userService.name() });
      await next();
    };

    const { response } = await runHttpMiddleware(usesService, "/me", { userService: { name: () => "ada" } });

    expect(await response.json()).toEqual({ user: "ada" });
  });
});
