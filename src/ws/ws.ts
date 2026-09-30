import type { RhythmWs, WsHooks } from "@rhythmjs/ws";

export interface MockPeer {
  id: string;
  request: Request;
  topics: Set<string>;
  sent: unknown[];
  published: { topic: string; data: unknown }[];
  closed: { code?: number; reason?: string } | null;
  terminated: boolean;
  send(data: unknown): void;
  publish(topic: string, data: unknown): void;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

export interface MockPeerInit {
  id?: string;
  request?: string | Request;
}

export function mockPeer(init: MockPeerInit = {}): MockPeer {
  const request =
    typeof init.request === "string" || init.request === undefined
      ? new Request(new URL(init.request ?? "/", "http://localhost"))
      : init.request;

  const peer: MockPeer = {
    id: init.id ?? crypto.randomUUID(),
    request,
    topics: new Set(),
    sent: [],
    published: [],
    closed: null,
    terminated: false,
    send: (data) => void peer.sent.push(data),
    publish: (topic, data) => void peer.published.push({ topic, data }),
    subscribe: (topic) => void peer.topics.add(topic),
    unsubscribe: (topic) => void peer.topics.delete(topic),
    close: (code, reason) => {
      peer.closed = { ...(code === undefined ? {} : { code }), ...(reason === undefined ? {} : { reason }) };
    },
    terminate: () => void (peer.terminated = true),
  };
  return peer;
}

export interface MockMessage {
  rawData: unknown;
  data: unknown;
  text(): string;
  json<T = unknown>(): T;
  uint8Array(): Uint8Array;
}

export function mockMessage(data: string | Uint8Array | object): MockMessage {
  const text = (): string => {
    if (typeof data === "string") return data;
    if (data instanceof Uint8Array) return new TextDecoder().decode(data);
    return JSON.stringify(data);
  };
  return {
    rawData: data,
    data,
    text,
    json: <T = unknown>() => JSON.parse(text()) as T,
    uint8Array: () => (data instanceof Uint8Array ? data : new TextEncoder().encode(text())),
  };
}

export interface WsResolution {
  accepted: boolean;
  hooks: WsHooks;
  response: Response | null;
}

export async function resolveWs(ws: RhythmWs, request: string | Request): Promise<WsResolution> {
  const req =
    typeof request === "string"
      ? new Request(new URL(request, "http://localhost"), { headers: { upgrade: "websocket" } })
      : request;

  const hooks = await ws.resolve(req);
  try {
    const result = await hooks.upgrade?.(req as never);
    if (result instanceof Response && result.status >= 400) return { accepted: false, hooks, response: result };
    return { accepted: true, hooks, response: null };
  } catch (error) {
    if (error instanceof Response) return { accepted: false, hooks, response: error };
    throw error;
  }
}

export async function fireOpen(hooks: WsHooks, peer: MockPeer): Promise<void> {
  await hooks.open?.(peer as never);
}

export async function fireMessage(hooks: WsHooks, peer: MockPeer, data: string | Uint8Array | object): Promise<void> {
  await hooks.message?.(peer as never, mockMessage(data) as never);
}

export async function fireClose(
  hooks: WsHooks,
  peer: MockPeer,
  details: { code?: number; reason?: string } = {},
): Promise<void> {
  await hooks.close?.(peer as never, details as never);
}
