import { describe, expect, test } from "vite-plus/test";
import { RhythmWs } from "@rhythmjs/ws";
import { fireClose, fireMessage, fireOpen, mockMessage, mockPeer, resolveWs } from "./ws";

const chatWs = () =>
  new RhythmWs()
    .use(async (request, next) => {
      if (request.headers.get("x-key") !== "secret") return new Response("Unauthorized", { status: 401 });
      return next();
    })
    .ws("/chat/:room", (params) => ({
      open(peer) {
        peer.send(`joined ${params.room}`);
      },
      message(peer, message) {
        peer.send(`echo: ${message.text()}`);
      },
      close(peer) {
        void peer;
      },
    }));

const authed = (path: string) =>
  new Request(new URL(path, "http://localhost"), { headers: { upgrade: "websocket", "x-key": "secret" } });

describe("resolveWs", () => {
  test("resolves a matching route to its hooks with params applied", async () => {
    const { accepted, hooks } = await resolveWs(chatWs(), authed("/chat/lobby"));
    expect(accepted).toBe(true);

    const peer = mockPeer();
    await fireOpen(hooks, peer);
    expect(peer.sent).toEqual(["joined lobby"]);
  });

  test("reports middleware rejections with the response", async () => {
    const { accepted, response } = await resolveWs(chatWs(), "/chat/lobby");

    expect(accepted).toBe(false);
    expect(response?.status).toBe(401);
    expect(await response?.text()).toBe("Unauthorized");
  });

  test("reports unmatched paths as a 404 rejection", async () => {
    const { accepted, response } = await resolveWs(chatWs(), authed("/nope"));

    expect(accepted).toBe(false);
    expect(response?.status).toBe(404);
  });
});

describe("hook firing", () => {
  test("fireMessage delivers text, binary, and json payloads", async () => {
    const { hooks } = await resolveWs(chatWs(), authed("/chat/dev"));
    const peer = mockPeer();

    await fireMessage(hooks, peer, "hi");
    await fireMessage(hooks, peer, new TextEncoder().encode("bytes"));
    await fireMessage(hooks, peer, { kind: "json" });

    expect(peer.sent).toEqual(["echo: hi", "echo: bytes", 'echo: {"kind":"json"}']);
  });

  test("fireClose invokes the close hook without error", async () => {
    const { hooks } = await resolveWs(chatWs(), authed("/chat/dev"));

    await expect(fireClose(hooks, mockPeer(), { code: 1000, reason: "done" })).resolves.toBeUndefined();
  });
});

describe("mockPeer", () => {
  test("records sends, publishes, subscriptions, and closure", () => {
    const peer = mockPeer({ id: "p1", request: "/chat/lobby" });

    peer.send("a");
    peer.publish("room", "b");
    peer.subscribe("room");
    peer.close(1001, "bye");

    expect(peer.id).toBe("p1");
    expect(new URL(peer.request.url).pathname).toBe("/chat/lobby");
    expect(peer.sent).toEqual(["a"]);
    expect(peer.published).toEqual([{ topic: "room", data: "b" }]);
    expect([...peer.topics]).toEqual(["room"]);
    expect(peer.closed).toEqual({ code: 1001, reason: "bye" });
  });
});

describe("mockMessage", () => {
  test("converts between text, json, and bytes from any input", () => {
    expect(mockMessage("plain").text()).toBe("plain");
    expect(mockMessage({ a: 1 }).json()).toEqual({ a: 1 });
    expect(mockMessage('{"b":2}').json()).toEqual({ b: 2 });
    expect(new TextDecoder().decode(mockMessage("xy").uint8Array())).toBe("xy");
    expect(mockMessage(new TextEncoder().encode("raw")).text()).toBe("raw");
  });
});
