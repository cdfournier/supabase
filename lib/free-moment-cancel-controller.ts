export type RuntimeTurnCancellationMode = "graceful" | "force";
// Kept as an alias while Free Moment callers retain their product-specific
// naming. The controller itself is intentionally turn-agnostic.
export type FreeMomentCancellationMode = RuntimeTurnCancellationMode;

/**
 * Small, provider-neutral control for one active runtime turn. It owns only
 * cancellation state and its timer; the runtime owns model/tool execution and
 * durable receipts. Keeping this seam pure lets us exercise Stop without
 * waking an agent or reaching any external surface.
 */
export class RuntimeTurnCancelController {
  readonly abortController = new AbortController();
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private requestedAt: string | null = null;
  private requestedMode: RuntimeTurnCancellationMode | null = null;
  private forceAvailable = false;

  get cancellationRequestedAt() {
    return this.requestedAt;
  }

  get cancellationMode() {
    return this.requestedMode;
  }

  get forceStopRequested() {
    return this.requestedMode === "force";
  }

  get forceStopAvailable() {
    return this.forceAvailable;
  }

  get gracefulStopRequested() {
    return this.requestedMode === "graceful";
  }

  requestGracefulStop(graceMs: number, onGraceElapsed: () => void) {
    if (this.requestedAt) {
      return false;
    }

    this.requestedAt = new Date().toISOString();
    this.requestedMode = "graceful";
    this.clearGraceTimer();
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;

      if (!this.gracefulStopRequested) {
        return;
      }

      this.forceAvailable = true;
      onGraceElapsed();
    }, graceMs);
    return true;
  }

  requestForceStop(options: { abortImmediately?: boolean } = {}) {
    if (this.forceStopRequested) {
      return false;
    }

    this.requestedAt ??= new Date().toISOString();
    this.requestedMode = "force";
    this.forceAvailable = false;
    this.clearGraceTimer();
    if (options.abortImmediately !== false) {
      this.abort();
    }
    return true;
  }

  abort() {
    this.abortController.abort();
  }

  clear() {
    this.clearGraceTimer();
  }

  private clearGraceTimer() {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }
}

// Existing Free Moment imports retain their narrow, human-readable name.
export class FreeMomentCancelController extends RuntimeTurnCancelController {}
