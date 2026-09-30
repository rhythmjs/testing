import type { Middleware } from "@rhythmjs/rhythm/types";
import { Rhythm } from "@rhythmjs/rhythm";

export function mockModule<TExports extends object>(
  values: TExports,
  dispose?: (values: TExports) => void | Promise<void>,
): Rhythm<{}, TExports, TExports> {
  return new Rhythm({ type: "module", name: "mock" }).provide(
    () => values,
    dispose === undefined ? undefined : () => dispose(values),
  ) as unknown as Rhythm<{}, TExports, TExports>;
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
