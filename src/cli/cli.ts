import type { Mountable } from "@rhythmjs/rhythm";
import type { RhythmCliContext } from "@rhythmjs/cli/context";
import { toCliHandler } from "@rhythmjs/cli/run";
import { withMockContext, type MockContext } from "../rhythm/rhythm";

export interface CliRunnerOptions<TContext extends object = {}> {
  /** Values assigned onto every run's context (mocks win over real startup values). */
  context?: Partial<TContext>;
}

export interface CliRunResult {
  /** Everything written to stdout, newlines included. */
  stdout: string;
  /** Everything written to stderr, newlines included. */
  stderr: string;
  exitCode: number;
}

export interface CliRunner {
  run(argv: string | string[]): Promise<CliRunResult>;
}

/** Fields of an app's startup context and input that can be mocked, minus the CLI base the runner supplies. */
type Mockable<TApp> = Omit<MockContext<TApp>, keyof RhythmCliContext>;

/** Runs a `Rhythm` app or a bare `RhythmCli` (anything mountable that accepts the CLI context) in memory. */
export function createCliRunner<TApp extends Mountable>(
  app: TApp & (RhythmCliContext & Mockable<TApp> extends NonNullable<TApp["~input"]> ? unknown : never),
  runnerOptions: CliRunnerOptions<Mockable<TApp>> = {},
): CliRunner {
  const mocked = withMockContext(app, runnerOptions.context);

  return {
    run: async (argv) => {
      const out: string[] = [];
      const err: string[] = [];
      const argvList = typeof argv === "string" ? argv.trim().split(/\s+/).filter(Boolean) : [...argv];
      const exitCode = await toCliHandler(mocked, {
        stdout: { write: (text) => out.push(text) },
        stderr: { write: (text) => err.push(text) },
      })(argvList);
      return { stdout: out.join(""), stderr: err.join(""), exitCode };
    },
  };
}
