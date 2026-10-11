import type { Middleware, Mountable } from "@rhythmjs/rhythm";
import { toFetchHandler } from "@rhythmjs/router/fetch";
import { createHttpContext, toResponse, type RhythmHttpContext } from "@rhythmjs/router/context";
import { runMiddleware, withMockContext, type MockContext } from "../rhythm/rhythm";

export type TestRequestHeaders = ConstructorParameters<typeof Headers>[0];
export type TestRequestBody = NonNullable<ConstructorParameters<typeof Response>[0]>;
export type TestRequestInit = ConstructorParameters<typeof Request>[1];

export interface TestRequestOptions {
  headers?: TestRequestHeaders;
  body?: TestRequestBody;
  json?: unknown;
}

export interface TestClient {
  fetch(input: string | Request, init?: TestRequestInit): Promise<Response>;
  get(path: string, options?: TestRequestOptions): Promise<Response>;
  head(path: string, options?: TestRequestOptions): Promise<Response>;
  post(path: string, options?: TestRequestOptions): Promise<Response>;
  put(path: string, options?: TestRequestOptions): Promise<Response>;
  patch(path: string, options?: TestRequestOptions): Promise<Response>;
  delete(path: string, options?: TestRequestOptions): Promise<Response>;
}

export interface TestClientOptions<TContext extends object = {}> {
  baseUrl?: string;
  /** Values assigned onto every request's context (mocks win over real startup values). */
  context?: Partial<TContext>;
}

/** Fields of an app's startup context and input that can be mocked, minus the HTTP base the client supplies. */
type Mockable<TApp> = Omit<MockContext<TApp>, keyof RhythmHttpContext>;

/** Drives a `Rhythm` app or a bare `RhythmRouter` (anything mountable that accepts the HTTP context). */
export function createTestClient<TApp extends Mountable>(
  app: TApp & (RhythmHttpContext & Mockable<TApp> extends NonNullable<TApp["~input"]> ? unknown : never),
  options: TestClientOptions<Mockable<TApp>> = {},
): TestClient {
  const fetchHandler = toFetchHandler(withMockContext(app, options.context));
  const handler = async (request: Request): Promise<Response> => fetchHandler(request);
  const baseUrl = options.baseUrl ?? "http://localhost";

  const request = (method: string, path: string, requestOptions: TestRequestOptions = {}): Promise<Response> => {
    const headers = new Headers(requestOptions.headers);
    let body = requestOptions.body ?? null;
    if (requestOptions.json !== undefined) {
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      body = JSON.stringify(requestOptions.json);
    }
    return handler(
      new Request(new URL(path, baseUrl).toString(), { method, headers, ...(body === null ? {} : { body }) }),
    );
  };

  return {
    fetch: (input, init) =>
      handler(typeof input === "string" ? new Request(new URL(input, baseUrl).toString(), init) : input),
    get: (path, requestOptions) => request("GET", path, requestOptions),
    head: (path, requestOptions) => request("HEAD", path, requestOptions),
    post: (path, requestOptions) => request("POST", path, requestOptions),
    put: (path, requestOptions) => request("PUT", path, requestOptions),
    patch: (path, requestOptions) => request("PATCH", path, requestOptions),
    delete: (path, requestOptions) => request("DELETE", path, requestOptions),
  };
}

export interface HttpMiddlewareRun<TContext extends object> {
  ctx: TContext;
  nextCalled: boolean;
  response: Response;
}

export async function runHttpMiddleware<TExtras extends object = {}>(
  middleware: Middleware<RhythmHttpContext & TExtras>,
  request: string | Request = "http://localhost/",
  extras?: TExtras,
): Promise<HttpMiddlewareRun<RhythmHttpContext & TExtras>> {
  const req = typeof request === "string" ? new Request(new URL(request, "http://localhost").toString()) : request;
  const ctx = Object.assign(createHttpContext(req), extras) as RhythmHttpContext & TExtras;
  const { nextCalled } = await runMiddleware(middleware, ctx);
  return { ctx, nextCalled, response: toResponse(ctx.response) };
}
