import { Rhythm } from "@rhythmjs/rhythm";
import { RhythmCli } from "@rhythmjs/cli";
import { parseArgv } from "@rhythmjs/cli/argv";
import { RhythmCliResponse, type RhythmCliContext } from "@rhythmjs/cli/adapters/context";

export interface CliRunnerOptions<TStartup extends object = {}> {
  /** Startup values assigned onto the app's `context` before any run (mocks win over real ones). */
  context?: Partial<TStartup>;
}

export interface CliRunOptions {
  stdin?: string;
}

export interface CliRunResult<TContext extends RhythmCliContext = RhythmCliContext> {
  ctx: TContext;
  stdout: string[];
  stderr: string[];
  exitCode: number;
}

export interface CliRunner<TContext extends RhythmCliContext = RhythmCliContext> {
  run(argv: string | string[], options?: CliRunOptions): Promise<CliRunResult<TContext>>;
}

type TestableCliApp<TStartup extends object> = Rhythm<RhythmCliContext, TStartup, any>;

function isCli(value: object): value is RhythmCli {
  return value instanceof RhythmCli;
}

export function createCliRunner<TStartup extends object = {}>(
  app: TestableCliApp<TStartup> | RhythmCli,
  runnerOptions: CliRunnerOptions<TStartup> = {},
): CliRunner {
  const rhythm = isCli(app) ? new Rhythm<RhythmCliContext, TStartup>().use(app.middleware()) : app;
  Object.assign(rhythm.context, runnerOptions.context);
  const callback = rhythm.callback();

  return {
    run: async (argv, options = {}) => {
      const argvList = typeof argv === "string" ? argv.trim().split(/\s+/).filter(Boolean) : [...argv];
      const { flags } = parseArgv(argvList);
      const stdin = options.stdin === undefined ? null : new Response(options.stdin).body;

      const ctx = await callback({ argv: argvList, flags, stdin, response: new RhythmCliResponse() });

      return {
        ctx,
        stdout: [...ctx.response.stdout],
        stderr: [...ctx.response.stderr],
        exitCode: ctx.response.exitCode,
      };
    },
  };
}
