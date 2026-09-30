import { describe, expect, test } from "vite-plus/test";
import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmCli } from "@rhythmjs/cli";
import type { RhythmCliContext } from "@rhythmjs/cli/adapters/context";
import { createCliRunner } from "./cli";

const greetCli = () =>
  new RhythmCli()
    .command("greet :name", (ctx) => {
      const shout = ctx.flags.shout === true;
      const line = `hello ${ctx.args.name}`;
      ctx.response.print(shout ? line.toUpperCase() : line);
    })
    .command("fail", (ctx) => {
      ctx.response.printError("boom").exit(1);
    })
    .command("drain", async (ctx) => {
      const text = ctx.stdin === null ? "" : await new Response(ctx.stdin).text();
      ctx.response.print(`got: ${text.trim()}`);
    });

describe("createCliRunner", () => {
  test("runs a command from an argv string and captures stdout", async () => {
    const runner = createCliRunner(greetCli());

    const result = await runner.run("greet ada");
    expect(result.stdout).toEqual(["hello ada"]);
    expect(result.stderr).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  test("parses flags from the argv", async () => {
    const runner = createCliRunner(greetCli());

    const result = await runner.run(["greet", "ada", "--shout"]);
    expect(result.stdout).toEqual(["HELLO ADA"]);
  });

  test("captures stderr and exit codes", async () => {
    const runner = createCliRunner(greetCli());

    const result = await runner.run("fail");
    expect(result.stderr).toEqual(["boom"]);
    expect(result.exitCode).toBe(1);
  });

  test("feeds a stdin string to the command", async () => {
    const runner = createCliRunner(greetCli());

    const result = await runner.run("drain", { stdin: "piped input\n" });
    expect(result.stdout).toEqual(["got: piped input"]);
  });

  test("accepts a full Rhythm app and disposes providers on teardown", async () => {
    let disposed = false;
    const app = new Rhythm<RhythmCliContext>()
      .provide(
        () => ({ service: { ok: true } }),
        () => void (disposed = true),
      )
      .use(greetCli().middleware());
    const runner = createCliRunner(app as never);

    const result = await runner.run("greet grace");
    expect(result.stdout).toEqual(["hello grace"]);

    await runner.teardown();
    expect(disposed).toBe(true);
  });
});
