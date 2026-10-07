# @rhythmjs/testing

Testing utilities for [Rhythm](https://github.com/rhythmjs/rhythm), the Bun-native backend
framework, split by layer the way the ecosystem is: kernel helpers for `@rhythmjs/rhythm`, a fetch-based client for `@rhythmjs/router`, a
command runner for `@rhythmjs/cli`, and WebSocket hook harnesses for `@rhythmjs/ws`. Each module is
exported by its own subpath (there is no root barrel export) and only the kernel peer is required;
`@rhythmjs/router`, `@rhythmjs/cli`, and `@rhythmjs/ws` are optional peers you install when you use
their subpath.

## Install

```sh
bun add -D @rhythmjs/testing
```

## `@rhythmjs/testing/rhythm`

Kernel-level helpers, no HTTP or CLI involved.

```ts
import { include, Rhythm } from "@rhythmjs/rhythm";
import { mockModule, runMiddleware, withMockContext } from "@rhythmjs/testing/rhythm";

// Swap a real module for a mock at startup:
const app = new Rhythm()
  // production: .register(include(configModule, (m) => ({ configService: m.configService })))
  .register(include(mockModule({ configService: fakeConfigService }), (m) => ({ configService: m.configService })))
  .use(apiMiddleware); // later steps type-check against the mock's shape

// Run one middleware over any context shape:
const { ctx, nextCalled } = await runMiddleware(gate, { allowed: true });

// Override startup values on every call of a pipeline:
const mocked = withMockContext(app, { configService: otherFake });
```

- `mockModule(values)`: a real `Rhythm` module whose startup context is `values`. Nothing to
  dispose: whoever created a resource closes it. Wiring is structural, so a mock satisfying what the
  parent needs compiles exactly like the real thing, and a mismatch is a compile error.
- `runMiddleware(middleware, ctx)`: executes one middleware against the context you pass, returning
  the mutated `ctx` and whether `next()` was reached.
- `withMockContext(pipeline, values)`: wraps any mountable (a `Rhythm` app, `RhythmRouter`,
  `RhythmCli`) so `values` are assigned onto each call's input. `Rhythm` merges input over its startup
  context, so mocks replace real values. `createTestClient` and `createCliRunner` use this for their
  `context` option.

## `@rhythmjs/testing/router`

Drive an HTTP app (or a bare router) through real `Request`/`Response` objects, in memory: no
sockets, no ports.

```ts
import { createTestClient, runHttpMiddleware } from "@rhythmjs/testing/router";

const client = createTestClient(app, { context: { db: fakeDb } }); // a Rhythm app or a RhythmRouter

const res = await client.get("/users/7");
expect(await res.json()).toEqual({ id: 7 });

await client.post("/users", { json: { name: "ada" } }); // serializes body, sets content-type
await client.fetch(new Request("http://localhost/raw")); // full control when needed

// One middleware (or a mounted router) in isolation:
const { response, nextCalled } = await runHttpMiddleware(mount(usersRouter), "/users/7", { userService });
```

- `createTestClient(appOrRouter, { baseUrl?, context? })`: `get` / `head` / `post` / `put` / `patch` /
  `delete` `(path, { headers?, body?, json? })`, and raw `fetch`. The app is anything mountable that
  accepts the HTTP context. `context` is assigned onto every request's context (typed `Partial<>` of
  the app's startup context and declared input), so mocks replace real startup values and a bare
  router's required input can be supplied; there is no `teardown`, close any resources you created
  yourself.
- `runHttpMiddleware(middleware, request?, extras?)`: the kernel harness specialized for HTTP;
  builds a real `RhythmHttpContext` from a path or `Request`, merges `extras` for middleware that
  depends on derived or startup fields (`ctx.user`, `ctx.configService`, …), and returns the
  materialized `Response` alongside `ctx` and `nextCalled`. Pass `mount(router)` to test a router
  with the same call.

## `@rhythmjs/testing/cli`

Run CLI commands in memory and assert on the captured output.

```ts
import { createCliRunner } from "@rhythmjs/testing/cli";

const runner = createCliRunner(cli, { context: { db: fakeDb } }); // a RhythmCli or a Rhythm app that mounts one

const result = await runner.run("greet ada --shout");
expect(result.stdout).toBe("HELLO ADA\n");
expect(result.exitCode).toBe(0);
```

- `createCliRunner(cliOrApp, { context? })`: `run(argv)` accepts an argv array or a plain command
  string and returns `{ stdout, stderr, exitCode }`, running through the same `toCliHandler` as a real
  binary (so unknown commands give exit code 2 and thrown errors exit code 1). Output is captured as
  strings, newlines included; nothing is written to the process's actual stdio. Flags exist only if the
  CLI uses `withParsedArgv()`, and stdin is not fed by the runner: give `withPrompt(...)` your own IO
  to script prompts.

## `@rhythmjs/testing/ws`

Run WebSocket routes through the real upgrade pipeline and exercise their hooks without a socket, using a
recording mock for Bun's `ServerWebSocket` peer.

```ts
import { upgradeWs, fireOpen, fireMessage } from "@rhythmjs/testing/ws";

const { upgraded, response, peer } = await upgradeWs(ws, "/chat/lobby"); // a RhythmWs
expect(upgraded).toBe(true); // rejections: upgraded === false, response holds the 4xx

await fireOpen(peer!);
await fireMessage(peer!, { kind: "json" }); // string | Uint8Array | object
expect(peer!.sent).toEqual(["joined lobby", 'echo: {"kind":"json"}']);
```

- `upgradeWs(ws, request)`: mounts the `RhythmWs` in an app and runs the request (a path or a `Request`; upgrade
  headers are implied for plain paths) through `toFetchHandler` with a recording server. Returns `upgraded`, the
  `response` of a rejected or unmatched upgrade (middleware or hook rejection, origin 403, 404), the `data` and
  `headers` the route attached to the connection, and a `peer` built on that `data`.
- `mockWs(data)`: a recording peer shaped like Bun's `ServerWebSocket`; `sent`, `published`, `topics`, `closed`,
  and `terminated` capture everything the hooks do to it. A peer only reaches a route's handlers if its `data` is
  the object the upgrade attached, which is what `upgradeWs` returns as `peer`.
- `fireOpen` / `fireMessage` / `fireClose` / `fireDrain` `(peer, ...)`: drive the matching handler of the `websocket`
  object from `@rhythmjs/ws`; `fireMessage` takes a string, bytes, or a JSON object (serialized for you).

## Development

```sh
bun install
bun test # bun test runner
bun run typecheck # tsc --noEmit
bun run build # bun build + tsc declarations
```
