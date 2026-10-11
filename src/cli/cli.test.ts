import { describe, expect, test } from "bun:test";
import { Rhythm, decorate, mount } from "@rhythmjs/rhythm";
import { RhythmCli } from "@rhythmjs/cli";
import { withParsedArgv } from "@rhythmjs/cli/argv";
import { createCliRunner } from "./cli";
import { fail, log } from "@rhythmjs/cli/output";

const greetCli = () =>
  new RhythmCli()
    .use(withParsedArgv())
    .cmd("greet :name", (ctx) => {
      const line = `hello ${ctx.params.name}`;
      log(ctx, ctx.flags.shout === true ? line.toUpperCase() : line);
    })
    .cmd("fail", (ctx) => {
      fail(ctx, "boom", 3);
    });

describe("createCliRunner", () => {
  test("runs a command from an argv string and captures stdout", async () => {
    const runner = createCliRunner(greetCli());

    const result = await runner.run("greet ada");
    expect(result.stdout).toBe("hello ada\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("accepts an argv array and parses flags", async () => {
    const runner = createCliRunner(greetCli());

    const result = await runner.run(["greet", "ada", "--shout"]);
    expect(result.stdout).toBe("HELLO ADA\n");
  });

  test("captures stderr and exit codes", async () => {
    const runner = createCliRunner(greetCli());

    const result = await runner.run("fail");
    expect(result.stderr).toBe("error: boom\n");
    expect(result.exitCode).toBe(3);
  });

  test("reports an unknown command like the real runner", async () => {
    const result = await createCliRunner(greetCli()).run("nope");

    expect(result.stderr).toBe("error: unknown command 'nope'\n");
    expect(result.exitCode).toBe(2);
  });

  test("context option replaces startup values of a Rhythm app", async () => {
    const cli = new RhythmCli<{ prefix: string }>().cmd("hi :name", (ctx) =>
      log(ctx, `${ctx.prefix} ${ctx.params.name}`),
    );
    const app = new Rhythm().register(decorate(() => ({ prefix: "real" }))).use(mount(cli));
    const runner = createCliRunner(app, { context: { prefix: "mock" } });

    expect((await runner.run("hi grace")).stdout).toBe("mock grace\n");
  });

  test("context option supplies a bare CLI's required input", async () => {
    const cli = new RhythmCli<{ prefix: string }>().cmd("hi", (ctx) => log(ctx, ctx.prefix));
    const runner = createCliRunner(cli, { context: { prefix: "given" } });

    expect((await runner.run("hi")).stdout).toBe("given\n");
  });
});
