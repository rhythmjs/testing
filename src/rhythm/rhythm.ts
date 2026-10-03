import type { Middleware } from "@rhythmjs/rhythm/types";
import { Rhythm } from "@rhythmjs/rhythm";

export function mockModule<TExports extends object>(values: TExports): Rhythm<{}, TExports> {
  const module = new Rhythm<{}, TExports>({ type: "module", name: "mock" });
  Object.assign(module.context, values);
  return module;
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
    return Promise.resolve(ctx);
  });
  return { ctx, nextCalled };
}
