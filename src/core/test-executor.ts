import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { TestExecutionOptions, TestRunResult, ParallelExecutionOptions, FeatureExecutionOptions } from "../types";
import { Logger } from "../utils/logger";
import { ExtensionConfig } from "./extension-config";
import { BehaveJsonParser } from "../utils/behave-json-parser";
import { parsePytestCollectionReport } from "./pytest-collection";
import { ProjectContext, resolveProjectContexts, projectForFile } from "./project-context";
import { CommandInvocation, InvocationContext, requireWorkspaceTrust } from "./command-invocation";
import { OUTPUT_PUBLISH_BYTES, ProcessTerminationError, runOwnedProcess } from "./owned-process";
import { TestRunArtifacts } from "./test-run-artifacts";

function errMsg(error: unknown): string {return error instanceof Error ? error.message : String(error);}

type ScenarioRunResult = TestRunResult & {
  scenarioResults?: Record<string, string>;
  scenarioOutputs?: Record<string, string>;
};

/** One operation, including every selected unit, probe, process and report cleanup. */
export interface ExecutionSession {
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  readonly publish: (text: string) => void;
  readonly limitDisplay: (text: string) => string;
}

export class TestExecutor {
  private static active: { owner: TestExecutor; session: ExecutionSession; drained: Promise<void> } | undefined;
  private static poison: string | undefined;
  private disposed = false;
  private readonly config: ExtensionConfig;
  private readonly logger: Logger;
  private readonly behaveJsonParser: BehaveJsonParser;

  public static create(workspace?: typeof vscode.workspace, window?: typeof vscode.window, debug?: typeof vscode.debug,
    config?: ExtensionConfig, logger?: Logger, behaveJsonParser?: BehaveJsonParser): TestExecutor {
    return new TestExecutor(workspace, window, debug, config, logger, behaveJsonParser);
  }
  constructor(private readonly workspace: typeof vscode.workspace = vscode.workspace,
    private readonly window: typeof vscode.window = vscode.window, private readonly debug: typeof vscode.debug = vscode.debug,
    config?: ExtensionConfig, logger?: Logger, behaveJsonParser?: BehaveJsonParser) {
    this.config = config ?? ExtensionConfig.create(); this.logger = logger ?? Logger.create();
    this.behaveJsonParser = behaveJsonParser ?? BehaveJsonParser.create(logger);
  }
  public reloadConfiguration(): void {this.config.reload();}
  public resolveProjects(files?: readonly string[]): Promise<Map<string, ProjectContext>> {
    return resolveProjectContexts(files, this.workspace);
  }

  public async withExecutionSession<T>(operation: (session: ExecutionSession) => Promise<T>, token?: vscode.CancellationToken,
    onOutput?: (text: string) => void, formatOutput: (text: string) => string = (text) => text): Promise<T> {
    requireWorkspaceTrust();
    if (this.disposed) {throw new Error("Test execution is disposed.");}
    if (TestExecutor.poison) {throw new Error(TestExecutor.poison);}
    if (TestExecutor.active) {throw new Error("A test operation is already in progress. Wait for it to finish before starting another.");}
    const controller = new AbortController();
    let published = 0;
    const decoder = new StringDecoder("utf8");
    let truncated = false;
    const session: ExecutionSession = { controller, signal: controller.signal,
      limitDisplay: (text) => {
        if (!text || TestExecutor.active?.session !== session) {return "";}
        const available = Math.max(0, OUTPUT_PUBLISH_BYTES - published);
        // Encode only a bounded prefix, including when aliases share a large report body.
        const bytes = Buffer.from(text.slice(0, available));
        const chunk = decoder.write(bytes.subarray(0, available));
        published += Math.min(bytes.length, available);
        if ((text.length > available || bytes.length > available) && !truncated) {
          truncated = true;
          return chunk + formatOutput("\n[Output truncated: the operation reached the 1 MiB display limit]\n");
        }
        return chunk;
      },
      publish: (text) => {
        const chunk = session.limitDisplay(formatOutput(text));
        if (chunk) {if (onOutput) {onOutput(chunk);} else {this.logger.appendOutput(chunk);}}
      } };

    let resolveDrain: () => void = () => {};
    const drained = new Promise<void>((resolve) => {resolveDrain = resolve;});
    const lease = { owner: this, session, drained };
    TestExecutor.active = lease;
    const cancellation = token?.onCancellationRequested(() => controller.abort());
    if (token?.isCancellationRequested) {controller.abort();}
    try {return await operation(session);} finally {
      cancellation?.dispose();
      if (TestExecutor.active === lease) {TestExecutor.active = undefined;}
      resolveDrain();
    }
  }

  private checkSession(session: ExecutionSession): void {
    requireWorkspaceTrust();
    if (this.disposed || TestExecutor.active?.session !== session || TestExecutor.active.owner !== this) {throw new Error("Test execution session is no longer active.");}
    session.signal.throwIfAborted();
  }
  private poison(reason: string): void {
    TestExecutor.poison = reason;
    if (!this.disposed) {this.logger.error(reason);}
  }

  private async capture(build: (context: InvocationContext) => Promise<CommandInvocation>, session: ExecutionSession, project: ProjectContext): Promise<ScenarioRunResult> {
    const start = Date.now();
    const duration = () => Math.max(1, Date.now() - start);
    let artifacts: TestRunArtifacts | undefined;
    let processFailure = false;
    let termination: Promise<void> | undefined;
    try {
      this.checkSession(session);
      const behave = project.builder.getFrameworkName() === "behave";
      const invocation = await build({ cwd: project.cwd, projectRoot: project.folder.uri.fsPath, signal: session.signal, captureOutput: behave });
      this.checkSession(session);
      artifacts = await TestRunArtifacts.create();
      this.checkSession(session);
      const args = [...invocation.args, ...(behave ? ["-D", `btr_report=${artifacts.report}`] : [`--btr-report=${artifacts.report}`])];
      const result = await runOwnedProcess({ ...invocation, args, cwd: project.cwd }, session.signal, session.publish);
      if (result.terminationFailure) {
        termination = result.terminated;
        throw result.terminationFailure;
      }
      const display = [result.output, result.error].filter(Boolean).join("\n");
      if (session.signal.aborted || result.cancelled) {return { success: false, output: "", display, duration: duration(), cancelled: true, outputStreamed: true };}
      if (result.timedOut || result.launchFailure) {
        processFailure = true;
        session.controller.abort();
        throw new Error(result.launchFailure ?? "Test process exceeded the 15 minute timeout.");
      }
      const output = await artifacts.readReport();
      let scenarioResults: Record<string, string>;
      let scenarioOutputs: Record<string, string> = {};
      if (behave) {
        scenarioResults = {};
        for (const scenario of this.behaveJsonParser.parseBehaveJsonOutput(output)) {
          if (scenario.filePath && scenario.lineNumber) {
            const key = `${scenario.filePath}:${scenario.lineNumber}`;
            scenarioResults[key] = scenario.status;
            scenarioOutputs[key] = scenario.output;
          }
        }
      } else {({ scenarioResults, scenarioOutputs } = parsePytestCollectionReport(output, project.folder.uri.fsPath));}
      return { success: result.returnCode === 0, output, display, error: result.error, duration: duration(), scenarioResults, scenarioOutputs, outputStreamed: true };
    } catch (error) {
      if (error instanceof ProcessTerminationError) {
        processFailure = true;
        this.poison(errMsg(error));
        session.controller.abort();
      }
      if (session.signal.aborted && !processFailure) {
        return { success: false, output: "", error: errMsg(error), duration: duration(), cancelled: true, outputStreamed: true };
      }
      session.publish(`\nTest execution error: ${errMsg(error)}\n`);
      return { success: false, output: "", error: errMsg(error), duration: duration(), errored: true, outputStreamed: true };
    } finally {
      if (artifacts) {
        const ownedArtifacts = artifacts;
        const cleanup = () => ownedArtifacts.cleanup().catch((error: unknown) => {
          if (!this.disposed) {this.logger.warn("Test report cleanup failed", { error: errMsg(error) });}
        });
        if (termination) {termination.then(cleanup).catch((error: unknown) => {process.stderr.write(`Deferred test report cleanup failed: ${errMsg(error)}\n`);});} else {await cleanup();}
      }
    }
  }

  private runWithOutput(options: TestExecutionOptions, feature: boolean, session?: ExecutionSession, project?: ProjectContext): Promise<ScenarioRunResult> {
    const execute = async (owned: ExecutionSession) => {
      const resolved = project ?? projectForFile(await this.resolveProjects([options.filePath]), options.filePath);
      return this.capture((context) => (feature ? resolved.builder.buildFeatureCommand(options, context)
        : resolved.builder.buildScenarioCommand(options, context)), owned, resolved);
    };
    return session ? execute(session) : this.withExecutionSession(execute);
  }
  public runScenarioWithOutput(options: TestExecutionOptions, session?: ExecutionSession, project?: ProjectContext): Promise<ScenarioRunResult> {
    return this.runWithOutput(options, false, session, project);
  }
  public runFeatureFileWithOutput(options: FeatureExecutionOptions, session?: ExecutionSession, project?: ProjectContext): Promise<ScenarioRunResult> {
    return this.runWithOutput(options, true, session, project);
  }
  private runWorkspace(tag?: string): Promise<ScenarioRunResult> {
    return this.withExecutionSession(async (session) => {
      const projects = await this.resolveProjects();
      let success = true;
      let duration = 0;
      let error: string | undefined;
      for (const project of projects.values()) {
        if (session.signal.aborted) {break;}
        const result = await this.capture((context) => (tag === undefined ? project.builder.buildRunAllCommand(context)
          : project.builder.buildTagCommand(tag, context)), session, project);
        success &&= result.success; duration += result.duration; error ??= result.error;
      }
      return { success: !session.signal.aborted && success, output: "", duration, outputStreamed: true,
        ...(session.signal.aborted ? { cancelled: true } : {}),
        ...(error ? { error } : {}) };
    });
  }
  public runAllTestsWithOutput(): Promise<ScenarioRunResult> {return this.runWorkspace();}
  public runAllTestsWithTagsOutput(tag: string): Promise<ScenarioRunResult> {return this.runWorkspace(tag);}
  public async runScenario(options: TestExecutionOptions): Promise<void> {await this.runScenarioWithOutput(options);}
  public async runFeatureFile(options: FeatureExecutionOptions): Promise<void> {await this.runFeatureFileWithOutput(options);}
  public async runAllTests(): Promise<void> {await this.runAllTestsWithOutput();}
  public async runAllTestsWithTags(tag: string): Promise<void> {await this.runAllTestsWithTagsOutput(tag);}
  public executeTestWithOutput(options: TestExecutionOptions): Promise<TestRunResult> {return this.runScenarioWithOutput(options);}

  public debugScenario(options: TestExecutionOptions, session?: ExecutionSession, project?: ProjectContext): Promise<void> {
    const execute = async (owned: ExecutionSession) => this.debugOwned(options, owned,
      project ?? projectForFile(await this.resolveProjects([options.filePath]), options.filePath));
    return session ? execute(session) : this.withExecutionSession(execute);
  }
  private async debugOwned(options: TestExecutionOptions, session: ExecutionSession, project: ProjectContext): Promise<void> {
    this.checkSession(session);
    const config = await project.builder.buildDebugConfiguration(options, { cwd: project.cwd, projectRoot: project.folder.uri.fsPath, signal: session.signal });
    const id = randomUUID();
    config["__behaveExecutionId"] = id; config["cwd"] = project.cwd; config.type = this.resolveDebugType();
    let debugSession: vscode.DebugSession | undefined;
    let resolveStart: (value: vscode.DebugSession) => void = () => {};
    let resolveEnd: () => void = () => {};
    let resolveAbort: () => void = () => {};
    let resolveNoLaunch: () => void = () => {};
    const started = new Promise<vscode.DebugSession>((resolve) => {resolveStart = resolve;});
    const ended = new Promise<void>((resolve) => {resolveEnd = resolve;});
    const aborted = new Promise<void>((resolve) => {resolveAbort = resolve;});
    const noLaunch = new Promise<void>((resolve) => {resolveNoLaunch = resolve;});
    let terminated = false;
    let declined = false;
    let launchRequested = false;
    let stopRequested = false;
    const acknowledgement = async <T>(pending: PromiseLike<T>, action: string): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {return await Promise.race([Promise.resolve(pending), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Debug ${action} was not confirmed within 10 seconds. Reload the window before running more tests.`)), 10000);
      })]);} finally {clearTimeout(timer);}
    };
    let stopping: Promise<void> | undefined;
    const stop = async (): Promise<void> => {
      if (terminated || declined) {return;}
      const target = debugSession ?? await acknowledgement(Promise.race([started, noLaunch.then(() => undefined)]), "start");
      if (terminated || !target) {return;}
      stopping ??= (async () => {
        await acknowledgement(this.debug.stopDebugging(target), "stop");
        await acknowledgement(ended, "termination");
      })();
      await stopping;
    };
    const stopLater = () => {stop().catch((error: unknown) => this.poison(errMsg(error)));};
    const listeners = [this.debug.onDidStartDebugSession((candidate) => {
      if (candidate.configuration["__behaveExecutionId"] === id) {
        debugSession = candidate; resolveStart(candidate);
        if (stopRequested) {stopLater();}
      }
    }), this.debug.onDidTerminateDebugSession((candidate) => {
      if (candidate.configuration["__behaveExecutionId"] === id) {terminated = true; resolveEnd(); release();}
    })];
    const release = () => {for (const listener of listeners) {listener.dispose();}};
    const abort = () => {stopRequested = true; resolveAbort();};
    session.signal.addEventListener("abort", abort, { once: true });
    try {
      this.checkSession(session);
      // A late false acknowledgement is definitive; an unknown launch retains its observers.
      launchRequested = true;
      const launching = Promise.resolve(this.debug.startDebugging(project.folder, config));
      launching.then((accepted) => {if (!accepted && !debugSession) {declined = true; resolveNoLaunch(); release();}}, () => {});
      const accepted = await acknowledgement(Promise.race([launching, aborted.then(() => false)]), "launch");
      if (session.signal.aborted) {await stop(); return;}
      if (!accepted) {throw new Error("The Python debugger declined to start the test session.");}
      await acknowledgement(Promise.race([started, aborted.then(() => undefined)]), "start");
      if (!session.signal.aborted) {await Promise.race([ended, aborted]);}
      if (session.signal.aborted) {await stop();}
    } catch (error) {
      stopRequested = true;
      if (launchRequested && !terminated && !declined) {this.poison(errMsg(error));}
      throw error;
    } finally {
      session.signal.removeEventListener("abort", abort);
      if (!launchRequested || terminated || declined) {release();}
      else {stopRequested = true; if (debugSession) {stopLater();}}
    }
  }

  private resolveDebugType(): string {
    if (vscode.extensions.getExtension("ms-python.debugpy")) {return "debugpy";}
    const version: unknown = vscode.extensions.getExtension("ms-python.python")?.packageJSON?.version;
    const major = typeof version === "string" ? Number.parseInt(version, 10) : 0;
    return major > 0 && major < 2024 ? "python" : "debugpy";
  }

  private async runParallel(options: ParallelExecutionOptions, session: ExecutionSession, projects: Map<string, ProjectContext>): Promise<void> {
    if (Array.from(projects.values()).some((project) => project.builder.getFrameworkName() !== "behave")) {
      throw new Error("Parallel feature execution currently supports Behave only.");
    }
    let failures = 0;
    for (const project of projects.values()) {
      const files = options.featureFiles.filter((file) => projectForFile(projects, file) === project);
      const count = Math.min(16, files.length, Math.max(1, Math.floor(project.config.maxParallelProcesses || 1)), Math.max(1, Math.floor(options.maxProcesses || 1)));
      let next = 0;
      await Promise.all(Array.from({ length: count }, async () => {
        while (!session.signal.aborted && next < files.length) {
          const filePath = files[next++];
          if (!filePath) {break;}
          const result = await this.runFeatureFileWithOutput({ filePath, ...(options.tags ? { tags: options.tags } : {}),
            ...(options.outputFormat !== undefined ? { outputFormat: options.outputFormat } : {}),
            ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}) }, session, project);
          if (!result.success && !result.cancelled) {failures++;}
        }
      }));
    }
    if (failures) {throw new Error(`${failures} parallel feature execution(s) failed. Inspect the captured output.`);}
  }
  public runTestsInParallel(options: ParallelExecutionOptions): Promise<void> {
    return this.withExecutionSession(async (session) => this.runParallel(options, session, await this.resolveProjects(options.featureFiles)));
  }
  private async projectFeatureFiles(projects: ReadonlyMap<string, ProjectContext>): Promise<string[]> {
    const files: string[] = [];
    for (const project of projects.values()) {
      const found = await this.workspace.findFiles(new vscode.RelativePattern(project.folder, project.config.testFilePattern));
      files.push(...found.filter((file) => projectForFile(projects, file.fsPath) === project).map((file) => file.fsPath));
    }
    return files;
  }
  public async discoverFeatureFiles(): Promise<string[]> {
    return this.projectFeatureFiles(await this.resolveProjects());
  }
  public async runAllTestsInParallel(): Promise<void> {
    return this.withExecutionSession(async (session) => {
      const projects = await this.resolveProjects();
      if (Array.from(projects.values()).some((project) => project.builder.getFrameworkName() !== "behave")) {
        throw new Error("Parallel feature execution currently supports Behave only.");
      }
      const featureFiles = await this.projectFeatureFiles(projects);
      if (!featureFiles.length) {await this.window.showWarningMessage("No feature files found to run in parallel"); return;}
      await this.runParallel({ featureFiles, maxProcesses: 16 }, session, projects);
    });
  }
  public async validateBehaveInstallation(): Promise<boolean> {
    return this.withExecutionSession(async (session) => {
      for (const project of (await this.resolveProjects()).values()) {
        this.checkSession(session);
        const invocation = await project.builder.buildRunAllCommand({ cwd: project.cwd, projectRoot: project.folder.uri.fsPath, signal: session.signal });
        this.checkSession(session);
        const result = await runOwnedProcess({ ...invocation, args: [...invocation.args, "--version"] }, session.signal, session.publish, 5000);
        if (result.terminationFailure) {this.poison(result.terminationFailure.message);}
        if (result.returnCode !== 0 || result.cancelled || result.timedOut || result.launchFailure || result.terminationFailure) {return false;}
      }
      return true;
    });
  }
  public dispose(): Promise<void> {
    this.disposed = true;
    const active = TestExecutor.active;
    if (active?.owner !== this) {return Promise.resolve();}
    active.session.controller.abort();
    return active.drained;
  }
}
