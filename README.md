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
import { mockModule, runMiddleware } from "@rhythmjs/testing/rhythm";

// Swap a real module for a mock at register:
const app = new Rhythm()
  // production: .register(configModule.forRoot(...configs), (m) => ({ configService: m.configService }))
  .register(mockModule({ configService: fakeConfigService }), (m) => ({ configService: m.configService }))
  .register(apiModule); // child modules type-check against the mock's shape

// Run one middleware over any context shape:
const { ctx, nextCalled } = await runMiddleware(gate, { allowed: true });
```

- `mockModule(values)`: a real `Rhythm` module whose startup `context` is `values`. Nothing to
  dispose: whoever created a resource closes it. Module wiring is structural, so a mock satisfying a child module's declared input
  context compiles exactly like the real thing, and a mismatch is a compile error.
- `runMiddleware(middleware, ctx)`: executes one middleware against the context you pass, returning
  the mutated `ctx` and whether `next()` was reached.

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
```

- `createTestClient(appOrRouter, { baseUrl? })`: `get` / `head` / `post` / `put` / `patch` /
  `delete` `(path, { headers?, body?, json? })`, and raw `fetch`. `context` is assigned onto the
  app's startup `context` (typed `Partial<>` of its declared startup shape), so mocks replace real
  values; there is no `teardown`, close any resources you created yourself.
- `runHttpMiddleware(middleware, request?, extras?)`: the kernel harness specialized for HTTP;
  builds a real `RhythmHttpContext` from a path or `Request`, merges `extras` for derive-dependent
  middleware (`ctx.user`, `ctx.configService`, …), and returns the materialized `Response` alongside
  `ctx` and `nextCalled`.

## `@rhythmjs/testing/cli`

Run CLI commands in memory and assert on the captured output.

```ts
import { createCliRunner } from "@rhythmjs/testing/cli";

const runner = createCliRunner(cli, { context: { db: fakeDb } }); // a RhythmCli or a Rhythm<RhythmCliContext> app

const result = await runner.run("greet ada --shout");
expect(result.stdout).toEqual(["HELLO ADA"]);
expect(result.exitCode).toBe(0);

await runner.run("import", { stdin: "piped,csv,rows\n" }); // stdin as a string
```

- `createCliRunner(cliOrApp, { context? })`: `run(argv, { stdin? })` accepts an argv array or a plain command
  string, parses flags exactly like the real adapters, and returns `{ stdout, stderr, exitCode, ctx }`.
  Nothing is written to the process's actual stdio.

## `@rhythmjs/testing/ws`

Resolve WebSocket routes and exercise their hooks without a socket, using a recording mock for
Bun's `ServerWebSocket` peer.

```ts
import { resolveWs, mockPeer, fireOpen, fireMessage } from "@rhythmjs/testing/ws";

const { accepted, hooks, response } = await resolveWs(ws, "/chat/lobby"); // a RhythmWs
expect(accepted).toBe(true); // middleware rejections: accepted === false, response holds the 4xx

const peer = mockPeer();
await fireOpen(hooks, peer);
await fireMessage(hooks, peer, { kind: "json" }); // string | Uint8Array | object
expect(peer.sent).toEqual(["joined lobby", 'echo: {"kind":"json"}']);
```

- `resolveWs(ws, request)`: runs the ws middleware chain and route matching for a path or `Request`
  (upgrade headers implied for plain paths). Returns the matched `hooks` plus `accepted` /
  `response`, decoding both middleware `Response` rejections and the built-in 404. Note that it
  invokes the resolved `upgrade` hook to detect rejections.
- `mockPeer({ id?, request?, hooks? })`: a recording peer shaped like Bun's `ServerWebSocket`;
  `peer.data` carries `{ id, request, hooks }`, while `sent`, `published`, `topics`, `closed`, and
  `terminated` capture everything the hooks do to it.
- `fireOpen` / `fireMessage` / `fireClose`: drive the corresponding hooks directly; `fireMessage`
  takes a string, bytes, or a JSON object (serialized for you).

## Development

```sh
bun install
bun test # bun test runner
bun run typecheck # tsc --noEmit
bun run build # bun build + tsc declarations
```
