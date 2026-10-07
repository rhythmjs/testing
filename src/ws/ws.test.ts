import { describe, expect, test } from "bun:test";
import { RhythmWs } from "@rhythmjs/ws";
import { fireClose, fireMessage, fireOpen, mockWs, upgradeWs } from "./ws";

const chatWs = () =>
  new RhythmWs()
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

const authed = (path: string) =>
  new Request(new URL(path, "http://localhost").toString(), { headers: { upgrade: "websocket", "x-key": "secret" } });

describe("upgradeWs", () => {
  test("runs the route's upgrade and reports the attached ws.data", async () => {
    const result = await upgradeWs(chatWs(), authed("/chat/lobby"));

    expect(result.upgraded).toBe(true);
    expect(result.response).toBeNull();
    expect(result.data).toEqual({ room: "lobby", topic: "room:lobby" });
  });

  test("reports middleware rejections with the response", async () => {
    const result = await upgradeWs(chatWs(), "/chat/lobby");

    expect(result.upgraded).toBe(false);
    expect(result.response?.status).toBe(401);
    expect(await result.response?.text()).toBe("Unauthorized");
  });

  test("reports unmatched paths and plain HTTP requests as not upgraded", async () => {
    expect((await upgradeWs(chatWs(), authed("/nope"))).upgraded).toBe(false);
    expect((await upgradeWs(chatWs(), new Request("http://localhost/chat/lobby"))).upgraded).toBe(false);
  });

  test("reports a route-upgrade rejection and captured headers", async () => {
    const guarded = new RhythmWs().ws("/vip", {
      upgrade: (ctx) => (ctx.request.headers.get("x-vip") === "yes" ? { vip: true } : ctx.error(403, "Forbidden")),
      headers: { "x-served-by": "vip" },
    });

    const denied = await upgradeWs(guarded, "/vip");
    expect(denied.response?.status).toBe(403);

    const allowed = await upgradeWs(
      guarded,
      new Request("http://localhost/vip", { headers: { upgrade: "websocket", "x-vip": "yes" } }),
    );
    expect(allowed.upgraded).toBe(true);
    expect(allowed.headers).toEqual({ "x-served-by": "vip" });
  });
});

describe("hook firing", () => {
  test("fireOpen/fireMessage dispatch through ws.data to the matched route", async () => {
    const { peer } = await upgradeWs(chatWs(), authed("/chat/dev"));

    await fireOpen(peer!);
    await fireMessage(peer!, "hi");
    await fireMessage(peer!, new TextEncoder().encode("bytes"));

    expect(peer!.isSubscribed("room:dev")).toBe(true);
    expect(peer!.sent).toEqual(["joined dev", "echo: hi", "echo: bytes"]);
  });

  test("fireClose invokes the close handler", async () => {
    const { peer } = await upgradeWs(chatWs(), authed("/chat/dev"));

    await fireClose(peer!, 1001, "bye");
    expect(peer!.published).toEqual([{ topic: "room:dev", data: "left" }]);
  });
});

describe("mockWs", () => {
  test("records sends, publishes, subscriptions, and closure", () => {
    const peer = mockWs({ room: "lobby" });

    peer.send("a");
    peer.publish("room", "b");
    peer.subscribe("room");
    peer.close(1001, "bye");

    expect(peer.data.room).toBe("lobby");
    expect(peer.sent).toEqual(["a"]);
    expect(peer.published).toEqual([{ topic: "room", data: "b" }]);
    expect(peer.isSubscribed("room")).toBe(true);
    expect(peer.closed).toEqual({ code: 1001, reason: "bye" });
    expect(peer.readyState).toBe(3);
  });
});
