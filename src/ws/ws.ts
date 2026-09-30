import type { RhythmWs, Server } from "@rhythmjs/ws";

export interface MockWs<Data extends object = Record<string, string>> {
  data: Data;
  readyState: number;
  remoteAddress: string;
  topics: Set<string>;
  sent: unknown[];
  published: { topic: string; data: unknown }[];
  closed: { code?: number; reason?: string } | null;
  terminated: boolean;
  send(data: unknown): number;
  publish(topic: string, data: unknown): number;
  subscribe(topic: string): void;
  unsubscribe(topic: string): void;
  isSubscribed(topic: string): boolean;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

export function mockWs<Data extends object = Record<string, string>>(data: Data): MockWs<Data> {
  const peer: MockWs<Data> = {
    data,
    readyState: 1,
    remoteAddress: "127.0.0.1",
    topics: new Set(),
    sent: [],
    published: [],
    closed: null,
    terminated: false,
    send: (payload) => {
      peer.sent.push(payload);
      return typeof payload === "string" ? payload.length : (payload as Uint8Array).byteLength;
    },
    publish: (topic, payload) => {
      peer.published.push({ topic, data: payload });
      return typeof payload === "string" ? payload.length : (payload as Uint8Array).byteLength;
    },
    subscribe: (topic) => void peer.topics.add(topic),
    unsubscribe: (topic) => void peer.topics.delete(topic),
    isSubscribed: (topic) => peer.topics.has(topic),
    close: (code, reason) => {
      peer.readyState = 3;
      peer.closed = { ...(code === undefined ? {} : { code }), ...(reason === undefined ? {} : { reason }) };
    },
    terminate: () => {
      peer.readyState = 3;
      peer.terminated = true;
    },
  };
  return peer;
}

export interface WsUpgradeResult<Data extends object = Record<string, string>> {
  matched: boolean;
  upgraded: boolean;
  response: Response | null;
  data: Data | null;
  headers: Bun.HeadersInit | null;
}

export async function upgradeWs<Data extends object = Record<string, string>>(
  ws: RhythmWs,
  request: string | Request,
): Promise<WsUpgradeResult<Data>> {
  const req =
    typeof request === "string"
      ? new Request(new URL(request, "http://localhost").toString(), { headers: { upgrade: "websocket" } })
      : request;

  let didUpgrade = false;
  let captured: { data: unknown; headers: Bun.HeadersInit | null } = { data: null, headers: null };
  const server = {
    upgrade(_request: Request, options?: { data?: unknown; headers?: Bun.HeadersInit }) {
      didUpgrade = true;
      captured = { data: options?.data, headers: options?.headers ?? null };
      return true;
    },
  } as unknown as Server;

  const pending = ws.upgrade(req, server);
  if (pending === null) return { matched: false, upgraded: false, response: null, data: null, headers: null };
  const response = (await pending) ?? null;
  const upgraded = didUpgrade && response === null;
  return {
    matched: true,
    upgraded,
    response,
    data: upgraded ? (captured.data as Data) : null,
    headers: upgraded ? captured.headers : null,
  };
}

export function fireOpen<Data extends object>(ws: RhythmWs, peer: MockWs<Data>): void | Promise<void> {
  return ws.websocket.open?.(peer as never);
}

export function fireMessage<Data extends object>(
  ws: RhythmWs,
  peer: MockWs<Data>,
  data: string | Uint8Array | object,
): void | Promise<void> {
  const message =
    typeof data === "string" ? data : data instanceof Uint8Array ? Buffer.from(data) : JSON.stringify(data);
  return ws.websocket.message(peer as never, message);
}

export function fireClose<Data extends object>(
  ws: RhythmWs,
  peer: MockWs<Data>,
  code = 1000,
  reason = "",
): void | Promise<void> {
  return ws.websocket.close?.(peer as never, code, reason);
}

export function fireDrain<Data extends object>(ws: RhythmWs, peer: MockWs<Data>): void | Promise<void> {
  return ws.websocket.drain?.(peer as never);
}
