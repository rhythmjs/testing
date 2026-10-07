import { Rhythm, decorate, type Middleware, type Mountable } from "@rhythmjs/rhythm";

/** A module that only provides `values` at startup; pull them into an app with `include(mockModule(...), pick)`. */
export function mockModule<TExports extends object>(values: TExports): Rhythm<TExports> {
  return new Rhythm({ type: "module", name: "mock" }).register(decorate(() => values));
}

/** Context an app accepts mocks for: its startup fields plus its declared input (the HTTP/CLI base excluded by callers). */
export type MockContext<TApp> =
  TApp extends Rhythm<infer S, infer I, any> ? S & I : TApp extends Mountable<infer I> ? I : {};

/**
 * Wraps a pipeline so `values` are assigned onto every call's input. `Rhythm` merges input over its startup
 * context, so mocks replace real startup values; routers and CLIs simply see the extra fields.
 */
export function withMockContext(app: Mountable, values: object | undefined): Mountable {
  return {
    options: app.options,
    callback() {
      const run = app.callback();
      return (ctx: object) => run(Object.assign(ctx, values));
    },
  };
}

export interface MiddlewareRun<TContext extends object> {
  ctx: TContext;
  nextCalled: boolean;
}

export async function runMiddleware<TContext extends object>(
  middleware: Middleware<TContext>,
  ctx: TContext,
): Promise<MiddlewareRun<TContext>> {
  let nextCalled = false;
  await middleware(ctx, () => {
    nextCalled = true;
    return Promise.resolve();
  });
  return { ctx, nextCalled };
}
