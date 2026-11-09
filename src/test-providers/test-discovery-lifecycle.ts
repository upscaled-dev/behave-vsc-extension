import * as vscode from "vscode";

/** Serializes refreshes and revokes stale or disposed tree commits. */
export class TestDiscoveryLifecycle {
  private requested = false;
  private version = 0;
  private disposed = false;
  private running: Promise<void> | undefined;
  private readonly cancellation = new vscode.CancellationTokenSource();

  constructor(private readonly discover: (isCurrent: () => boolean, token: vscode.CancellationToken) => Promise<void>) {}

  public refresh(options: { invalidate?: boolean } = {}): Promise<void> {
    if (this.disposed) {return Promise.resolve();}
    this.requested = true;
    if (!this.running || options.invalidate) {this.version += 1;}
    this.running ??= Promise.resolve().then(() => this.drain());
    return this.running;
  }

  public invalidate(): Promise<void> {
    return this.requested ? this.refresh({ invalidate: true }) : Promise.resolve();
  }

  public dispose(): Promise<void> {
    this.disposed = true;
    this.version += 1;
    this.cancellation.cancel();
    this.cancellation.dispose();
    return this.running ?? Promise.resolve();
  }

  private async drain(): Promise<void> {
    try {
      let version: number;
      do {
        if (this.disposed) {return;}
        version = this.version;
        let onCancellation: vscode.Disposable | undefined;
        const cancelled = new Promise<void>((resolve) => {onCancellation = this.cancellation.token.onCancellationRequested(resolve);});
        try {
          // Native filesystem requests may ignore cancellation. Their continuations
          // must check the token/isCurrent before logging or committing any result.
          await Promise.race([
            this.discover(() => !this.disposed && version === this.version, this.cancellation.token),
            cancelled,
          ]);
        } catch (error) {
          if (!this.disposed && version === this.version) {throw error;}
        } finally {
          onCancellation?.dispose();
        }
      } while (!this.disposed && version !== this.version);
    } finally {
      this.running = undefined;
    }
  }
}
