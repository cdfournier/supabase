export type FreeMomentCancellationMode = "graceful" | "force";

/**
 * Small, provider-neutral control for one active Free Moment. It owns only
 * cancellation state and its timer; the runtime owns model/tool execution and
 * durable receipts. Keeping this seam pure lets us exercise Stop without
 * waking an agent or reaching any external surface.
 */
export class FreeMomentCancelController {
  readonly abortController = new AbortController();
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private requestedAt: string | null = null;
  private requestedMode: FreeMomentCancellationMode | null = null;
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

  requestForceStop() {
    if (this.forceStopRequested) {
      return false;
    }

    this.requestedAt ??= new Date().toISOString();
    this.requestedMode = "force";
    this.forceAvailable = false;
    this.clearGraceTimer();
    this.abortController.abort();
    return true;
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
