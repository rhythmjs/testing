# @rhythmjs/testing

Testing utilities for [Rhythm](https://github.com/rhythmjs/rhythm), the Bun-native backend framework. Everything runs in
memory with `bun:test`: no sockets, no ports, no child processes.

| Entry point                | Tests                                             | Main helpers                                                         |
| -------------------------- | ------------------------------------------------- | -------------------------------------------------------------------- |
| `@rhythmjs/testing/rhythm` | Rhythm apps, modules and plain middleware         | `mockModule`, `withMockContext`, `runMiddleware`                     |
| `@rhythmjs/testing/router` | HTTP apps and routers through real `Request`s     | `createTestClient`, `runHttpMiddleware`                              |
| `@rhythmjs/testing/cli`    | CLI commands, with captured output and exit codes | `createCliRunner`                                                    |
| `@rhythmjs/testing/ws`     | WebSocket routes and their hooks                  | `upgradeWs`, `mockWs`, `fireOpen`, `fireMessage`, `fireClose`, `fireDrain` |

There is no root export; import from the subpath you need.

## Installation

```sh
bun add -d @rhythmjs/testing
```

Requires Bun `>=1.2.0`. The packages you test are peer dependencies:

| Peer               | Range      | Needed for                                    |
| ------------------ | ---------- | --------------------------------------------- |
| `@rhythmjs/rhythm` | `>=0.0.18` | always (required)                             |
| `@rhythmjs/router` | `>=0.0.18` | `/router` (optional)                          |
| `@rhythmjs/cli`    | `>=0.0.18` | `/cli` (optional)                             |
| `@rhythmjs/ws`     | `>=0.0.6`  | `/ws` (optional)                              |

```sh
bun add @rhythmjs/rhythm @rhythmjs/router @rhythmjs/cli @rhythmjs/ws
```

Install only the optional peers whose entry point you use. Note that `/ws` also imports `@rhythmjs/router/fetch`, so it
needs `@rhythmjs/router` as well.

## Testing a Rhythm app (`/rhythm`)

Kernel-level helpers with no HTTP or CLI involved. Say a module provides a config service, and the app derives a
greeter from it:

```ts
// src/config.ts
import { Rhythm, decorate } from "@rhythmjs/rhythm";

export const configModule = new Rhythm({ type: "module", name: "config" }).register(
  decorate(() => ({ configService: { get: (key: string) => process.env[key] } })),
);
```

```ts
// src/app.ts
import { Rhythm, decorate, include } from "@rhythmjs/rhythm";
import { configModule } from "./config";

export const app = new Rhythm()
  .register(include(configModule, (m) => ({ configService: m.configService })))
  .register(decorate((ctx) => ({ greeting: `hello from ${ctx.configService.get("APP_NAME")}` })));
```

### Replace a module with `mockModule`

`mockModule(values)` is a real `Rhythm` module whose startup context is `values`. Swap it in where the app would
`include` the real module. Wiring is structural, so a mismatched mock is a compile error.

```ts
// src/app.test.ts
import { expect, test } from "bun:test";
import { Rhythm, decorate, include } from "@rhythmjs/rhythm";
import { mockModule } from "@rhythmjs/testing/rhythm";

test("builds the greeting from the mocked config", async () => {
  const configService = { get: (key: string) => (key === "APP_NAME" ? "test" : undefined) };

  const app = new Rhythm()
    .register(include(mockModule({ configService }), (m) => ({ configService: m.configService })))
    .register(decorate((ctx) => ({ greeting: `hello from ${ctx.configService.get("APP_NAME")}` })));

  const ctx = await app.callback()();

  expect(ctx.greeting).toBe("hello from test");
});
```

### Override startup values with `withMockContext`

When the app already exists and wires its own real module, `withMockContext(pipeline, values)` wraps it so `values` are
assigned onto every call's input. `Rhythm` merges input over its startup context, so the mock wins over the real value.

```ts
import { expect, test } from "bun:test";
import { Rhythm, decorate } from "@rhythmjs/rhythm";
import { withMockContext } from "@rhythmjs/testing/rhythm";

test("mock values replace real startup values", async () => {
  const app = new Rhythm().register(decorate(() => ({ name: "real" })));

  const ctx = (await withMockContext(app, { name: "mock" }).callback()({})) as { name: string };

  expect(ctx.name).toBe("mock");
});
```

### Run one middleware with `runMiddleware`

```ts
import { expect, test } from "bun:test";
import type { Middleware } from "@rhythmjs/rhythm";
import { runMiddleware } from "@rhythmjs/testing/rhythm";

type Gate = { allowed: boolean; note?: string };

const gate: Middleware<Gate> = async (ctx, next) => {
  if (!ctx.allowed) return;
  ctx.note = "passed";
  await next();
};

test("gate blocks and passes", async () => {
  const blocked = await runMiddleware(gate, { allowed: false } as Gate);
  expect(blocked.nextCalled).toBe(false);

  const passed = await runMiddleware(gate, { allowed: true } as Gate);
  expect(passed.nextCalled).toBe(true);
  expect(passed.ctx.note).toBe("passed");
});
```

### API reference

- `mockModule(values)` returns `Rhythm<typeof values>`: a module named `"mock"` that registers `decorate(() => values)`.
  Nothing to dispose; whoever created a resource closes it.
- `withMockContext(app, values)` returns a `Mountable` with the same `options` whose `callback()` assigns `values` onto
  each call's input (`Object.assign(ctx, values)`) before running `app`. It accepts any `Mountable`: a `Rhythm` app, a
  router, a CLI or a ws route. `values` may be `undefined` (no-op). The result is typed as plain `Mountable`, so you may
  need a cast on the context it returns, as above.
- `runMiddleware(middleware, ctx)` runs one middleware against exactly the context you pass and resolves to
  `{ ctx, nextCalled }`. `next` is a stub that records the call and resolves immediately; nothing downstream runs.
- Types: `MockContext<TApp>` (the startup fields plus declared input an app accepts mocks for) and
  `MiddlewareRun<TContext>`.

## Testing a router (`/router`)

Drive a router through real `Request` and `Response` objects. Here a users router depends on a `userService` that the
app provides with `decorate`:

```ts
// src/users.ts
import { Rhythm, decorate, mount } from "@rhythmjs/rhythm";
import { RhythmRouter } from "@rhythmjs/router";

export type UserService = { find: (id: string) => { id: string; name: string } | undefined };

export const usersRouter = new RhythmRouter<{ userService: UserService }>()
  .get("/users/:id", (ctx) => {
    const user = ctx.userService.find(ctx.params.id);
    if (!user) return ctx.error(404);
    ctx.json(user);
  })
  .post("/users", async (ctx) => {
    const body = (await ctx.request.json()) as { name: string };
    ctx.json({ created: body.name });
  });

export const app = new Rhythm()
  .register(decorate(() => ({ userService: { find: (id: string) => ({ id, name: "real" }) } as UserService })))
  .use(mount(usersRouter));
```

### Drive it with `createTestClient`

`createTestClient(appOrRouter, { baseUrl?, context? })` accepts a `Rhythm` app or a bare router. `context` is assigned
onto every request's context: for an app it replaces startup values, and for a bare router it supplies the router's
required input.

```ts
// src/users.test.ts
import { describe, expect, test } from "bun:test";
import { createTestClient } from "@rhythmjs/testing/router";
import { app, usersRouter } from "./users";

const fakeUserService = {
  find: (id: string) => (id === "7" ? { id, name: "ada" } : undefined),
};

describe("users", () => {
  test("overrides the real service on a full app", async () => {
    const client = createTestClient(app, { context: { userService: fakeUserService } });

    const res = await client.get("/users/7");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "7", name: "ada" });
  });

  test("tests a bare router by supplying its input", async () => {
    const client = createTestClient(usersRouter, { context: { userService: fakeUserService } });

    expect((await client.get("/users/404")).status).toBe(404);
  });

  test("json option serializes the body and sets content-type", async () => {
    const client = createTestClient(usersRouter, { context: { userService: fakeUserService } });

    const res = await client.post("/users", { json: { name: "grace" } });

    expect(await res.json()).toEqual({ created: "grace" });
  });

  test("fetch gives full control over the Request", async () => {
    const client = createTestClient(usersRouter, { context: { userService: fakeUserService } });

    const res = await client.fetch(new Request("http://localhost/users/7", { headers: { accept: "application/json" } }));

    expect(res.status).toBe(200);
  });
});
```

### Test middleware with `runHttpMiddleware`

`runHttpMiddleware(middleware, request?, extras?)` builds a real `RhythmHttpContext` from a path or `Request`, merges
`extras` (fields that earlier derive or startup steps would have provided), runs the middleware, and returns the
materialized `Response`.

```ts
import { expect, test } from "bun:test";
import type { Middleware } from "@rhythmjs/rhythm";
import type { RhythmHttpContext } from "@rhythmjs/router/context";
import { runHttpMiddleware } from "@rhythmjs/testing/router";

const guard: Middleware<RhythmHttpContext> = async (ctx, next) => {
  if (ctx.request.headers.get("x-key") !== "secret") {
    ctx.error(401);
    return;
  }
  await next();
};

test("rejects a missing key", async () => {
  const { nextCalled, response } = await runHttpMiddleware(guard, "/private");

  expect(nextCalled).toBe(false);
  expect(response.status).toBe(401);
  expect(await response.text()).toBe("Unauthorized");
});

test("passes a valid key", async () => {
  const { nextCalled, response } = await runHttpMiddleware(
    guard,
    new Request("http://localhost/private", { headers: { "x-key": "secret" } }),
  );

  expect(nextCalled).toBe(true);
  expect(response.status).toBe(200);
});

test("extras stand in for derived fields", async () => {
  const usesService: Middleware<RhythmHttpContext & { userService: { name: () => string } }> = async (ctx, next) => {
    ctx.json({ user: ctx.userService.name() });
    await next();
  };

  const { response } = await runHttpMiddleware(usesService, "/me", { userService: { name: () => "ada" } });

  expect(await response.json()).toEqual({ user: "ada" });
});
```

### API reference

- `createTestClient(app, options?)` returns a `TestClient`:
  - `get`, `head`, `post`, `put`, `patch`, `delete` `(path, { headers?, body?, json? })` resolve to a `Response`.
  - `fetch(input: string | Request, init?)`: a string is resolved against `baseUrl`; a `Request` is passed through
    untouched.
  - `options.baseUrl` defaults to `http://localhost`. `options.context` is typed as a `Partial<>` of the app's startup
    context and declared input, minus the HTTP base fields.
  - `json` serializes the body and sets `content-type: application/json` unless you passed that header yourself. It
    takes precedence over `body`.
  - The call fails to type-check when the app needs input the client cannot provide (a bare router with required
    input and no `context`).
- `runHttpMiddleware(middleware, request = "http://localhost/", extras?)` resolves to
  `{ ctx, nextCalled, response }`. A string request is resolved against `http://localhost`. `response` is built from
  `ctx.response` after the middleware ran. To test a whole router with this call, pass `mount(router)`.
- Types: `TestClient`, `TestClientOptions`, `TestRequestOptions`, `TestRequestHeaders`, `TestRequestBody`,
  `TestRequestInit`, `HttpMiddlewareRun`.

### Gotchas

- There is no `teardown`. Close any resources you created yourself.
- The client goes through `toFetchHandler`, so what you assert on is the real serialized `Response`: status, headers and
  body.

## Testing a CLI (`/cli`)

A small CLI with a command that uses an injected service and a command that fails:

```ts
// src/cli.ts
import { Rhythm, decorate, mount } from "@rhythmjs/rhythm";
import { RhythmCli } from "@rhythmjs/cli";
import { withParsedArgv } from "@rhythmjs/cli/argv";

export const cli = new RhythmCli<{ prefix: string }>()
  .use(withParsedArgv())
  .cmd("greet :name", (ctx) => {
    const line = `${ctx.prefix} ${ctx.params.name}`;
    ctx.log(ctx.flags.shout === true ? line.toUpperCase() : line);
  })
  .cmd("fail", (ctx) => {
    ctx.fail("boom", 3);
  });

export const app = new Rhythm().register(decorate(() => ({ prefix: "hello" }))).use(mount(cli));
```

```ts
// src/cli.test.ts
import { describe, expect, test } from "bun:test";
import { createCliRunner } from "@rhythmjs/testing/cli";
import { app, cli } from "./cli";

describe("cli", () => {
  test("runs a command from an argv string", async () => {
    const runner = createCliRunner(app);

    const result = await runner.run("greet ada");

    expect(result.stdout).toBe("hello ada\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("accepts an argv array and parses flags", async () => {
    const runner = createCliRunner(app);

    expect((await runner.run(["greet", "ada", "--shout"])).stdout).toBe("HELLO ADA\n");
  });

  test("mocks startup values on an app", async () => {
    const runner = createCliRunner(app, { context: { prefix: "mock" } });

    expect((await runner.run("greet grace")).stdout).toBe("mock grace\n");
  });

  test("supplies a bare CLI's required input", async () => {
    const runner = createCliRunner(cli, { context: { prefix: "given" } });

    expect((await runner.run("greet linus")).stdout).toBe("given linus\n");
  });

  test("captures stderr and exit codes", async () => {
    const runner = createCliRunner(app);

    const failed = await runner.run("fail");
    expect(failed.stderr).toBe("error: boom\n");
    expect(failed.exitCode).toBe(3);

    const unknown = await runner.run("nope");
    expect(unknown.stderr).toBe("error: unknown command 'nope'\n");
    expect(unknown.exitCode).toBe(2);
  });
});
```

### API reference

- `createCliRunner(cliOrApp, { context? })` returns a `CliRunner` with a single method,
  `run(argv: string | string[]): Promise<{ stdout, stderr, exitCode }>`.
- A string `argv` is trimmed and split on whitespace, so it cannot express quoted arguments with spaces; pass an array
  for those.
- Execution goes through the same `toCliHandler` as a real binary: an unknown command exits with code `2`, a thrown
  error with code `1`, and `ctx.fail(message, code)` with your code.
- `stdout` and `stderr` are the captured text joined together, newlines included. Nothing is written to the process's
  real stdio.
- `context` is assigned onto every run's context, typed as a `Partial<>` of the app's startup context and input, minus
  the CLI base fields.
- Types: `CliRunner`, `CliRunnerOptions`, `CliRunResult`.

### Gotchas

- Flags are only parsed when the CLI uses `withParsedArgv()`.
- The runner has no stdin. For commands using `withPrompt(...)`, give the prompt middleware your own IO to script
  answers.
- The runner is reusable: each `run` captures its own output.

## Testing WebSocket routes (`/ws`)

A chat route with an auth middleware, an upgrade step that attaches data to the connection, and open, message and close
hooks:

```ts
// src/chat.ts
import { Rhythm, mount } from "@rhythmjs/rhythm";
import { RhythmWs } from "@rhythmjs/ws";

export const chatWs = new RhythmWs()
  .use(async (ctx, next) => {
    if (ctx.request.headers.get("x-key") === "secret") await next();
    else ctx.error(401, "Unauthorized");
  })
  .ws("/chat/:room", {
    upgrade: (ctx) => ({ room: ctx.params.room, topic: `room:${ctx.params.room}` }),
    open(ws) {
      ws.subscribe(ws.data.topic);
      ws.send(`joined ${ws.data.room}`);
    },
    message(ws, message) {
      ws.send(`echo: ${typeof message === "string" ? message : new TextDecoder().decode(message)}`);
    },
    close(ws) {
      ws.publish(ws.data.topic, "left");
    },
  });

export const app = new Rhythm().use(mount(chatWs));
```

```ts
// src/chat.test.ts
import { describe, expect, test } from "bun:test";
import { fireClose, fireMessage, fireOpen, upgradeWs } from "@rhythmjs/testing/ws";
import { chatWs } from "./chat";

const authed = (path: string) =>
  new Request(new URL(path, "http://localhost").toString(), { headers: { upgrade: "websocket", "x-key": "secret" } });

describe("chat", () => {
  test("upgrade attaches ws.data", async () => {
    const result = await upgradeWs(chatWs, authed("/chat/lobby"));

    expect(result.upgraded).toBe(true);
    expect(result.response).toBeNull();
    expect(result.data).toEqual({ room: "lobby", topic: "room:lobby" });
  });

  test("middleware rejections come back as a response", async () => {
    const result = await upgradeWs(chatWs, "/chat/lobby"); // a plain path has no x-key header

    expect(result.upgraded).toBe(false);
    expect(result.response?.status).toBe(401);
    expect(await result.response?.text()).toBe("Unauthorized");
  });

  test("open and message hooks", async () => {
    const { peer } = await upgradeWs(chatWs, authed("/chat/dev"));

    await fireOpen(peer!);
    await fireMessage(peer!, "hi");
    await fireMessage(peer!, new TextEncoder().encode("bytes"));
    await fireMessage(peer!, { kind: "json" });

    expect(peer!.isSubscribed("room:dev")).toBe(true);
    expect(peer!.sent).toEqual(["joined dev", "echo: hi", "echo: bytes", 'echo: {"kind":"json"}']);
  });

  test("close hook", async () => {
    const { peer } = await upgradeWs(chatWs, authed("/chat/dev"));

    await fireClose(peer!, 1001, "bye");

    expect(peer!.published).toEqual([{ topic: "room:dev", data: "left" }]);
  });
});
```

### Standalone peers with `mockWs`

`mockWs(data)` builds a recording peer without an upgrade, useful for code that only takes a socket:

```ts
import { expect, test } from "bun:test";
import { mockWs } from "@rhythmjs/testing/ws";

test("records sends, publishes, subscriptions and closure", () => {
  const peer = mockWs({ room: "lobby" });

  peer.send("a");
  peer.publish("room", "b");
  peer.subscribe("room");
  peer.close(1001, "bye");

  expect(peer.sent).toEqual(["a"]);
  expect(peer.published).toEqual([{ topic: "room", data: "b" }]);
  expect(peer.isSubscribed("room")).toBe(true);
  expect(peer.closed).toEqual({ code: 1001, reason: "bye" });
  expect(peer.readyState).toBe(3);
});
```

### API reference

- `upgradeWs(ws, request)` mounts the `RhythmWs` in a fresh `Rhythm` app and runs the request through `toFetchHandler`
  with a recording server. `request` is a path or a `Request`; a plain path implies `upgrade: websocket` but no other
  headers. Resolves to:
  - `upgraded`: `true` when the route called `server.upgrade`.
  - `response`: the `Response` of a rejected or unmatched upgrade (middleware or hook rejection, origin 403, 404, a
    plain HTTP request), `null` when accepted.
  - `data`: the `ws.data` the route attached, or `null`.
  - `headers`: the headers the route passed to the upgrade, or `null`.
  - `peer`: a `MockWs` built on `data`, or `null` when not upgraded.
  - `upgradeWs<Data>` takes an optional type parameter for `data`.
- `mockWs(data)` returns a `MockWs` with `data`, `readyState` (`1`, then `3` after `close` or `terminate`),
  `remoteAddress` (`127.0.0.1`), `topics`, `sent`, `published` (`{ topic, data }[]`), `closed`
  (`{ code?, reason? } | null`), `terminated`, and the methods `send`, `publish`, `subscribe`, `unsubscribe`,
  `isSubscribed`, `close`, `terminate`.
- `fireOpen(peer)`, `fireMessage(peer, data)`, `fireClose(peer, code = 1000, reason = "")`, `fireDrain(peer)` invoke the
  matching handler of the `websocket` object from `@rhythmjs/ws`. `fireMessage` takes a string, a `Uint8Array` (passed
  as a `Buffer`), or any object (serialized with `JSON.stringify`). They return `void | Promise<void>`, so always
  `await` them.

### Gotchas

- The `fire*` helpers take only the peer. The peer must come from `upgradeWs` (or share its `data`): the handlers
  dispatch through `ws.data` to the matched route, so a peer from a bare `mockWs({...})` reaches no route handlers.
- `upgradeWs` does not accept a `context` option. The route is mounted in a bare `new Rhythm()`, so a route that needs
  startup values cannot be tested through it with mocks.
- Only the peer is simulated. There is no real pub/sub: `publish` is recorded on `peer.published` and is never
  delivered to other peers' `sent`.
