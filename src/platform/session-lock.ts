export const SAVE_WRITER_LOCK_NAME = "camellia-golden-week.save-writer";

export interface SessionLockManager {
  request(
    name: string,
    options: { readonly mode: "exclusive"; readonly ifAvailable: true },
    callback: (lock: unknown | null) => Promise<void>,
  ): Promise<void>;
}

export type SessionLockStatus = "idle" | "acquiring" | "held" | "busy" | "unsupported" | "error";
export type SessionLockAcquisition = "acquired" | "busy" | "unsupported" | "error" | "cancelled";

export interface SaveSessionLock {
  acquire(signal?: AbortSignal): Promise<SessionLockAcquisition>;
  release(): void;
  isHeld(): boolean;
  status(): SessionLockStatus;
}

interface PendingAcquisition {
  readonly outcome: Promise<SessionLockAcquisition>;
  cancel(): void;
  attachSignal(signal: AbortSignal): void;
}

export function createSessionLock(manager: SessionLockManager | null | undefined): SaveSessionLock {
  let status: SessionLockStatus = manager ? "idle" : "unsupported";
  let pending: PendingAcquisition | null = null;
  let releaseHeldLock: (() => void) | null = null;
  let requestEpoch = 0;
  return {
    acquire: (signal) => {
      if (signal?.aborted) return Promise.resolve("cancelled");
      if (!manager) return Promise.resolve("unsupported");
      const availableManager = manager;
      if (status === "held") return Promise.resolve("acquired");
      if (pending) {
        // Concurrent callers share one acquisition, including its cancellation.
        const shared = pending;
        if (signal) shared.attachSignal(signal);
        return shared.outcome;
      }
      status = "acquiring";
      const epoch = ++requestEpoch;
      let resolveOutcome: (outcome: SessionLockAcquisition) => void = () => {};
      const outcome = new Promise<SessionLockAcquisition>((resolve) => {
        resolveOutcome = resolve;
      });
      let settled = false;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      const signals = new Set<AbortSignal>();
      const operation: PendingAcquisition = {
        outcome,
        cancel: () => {
          if (settled) return;
          if (epoch === requestEpoch) {
            requestEpoch += 1;
            status = "idle";
          }
          settle("cancelled");
        },
        attachSignal: (nextSignal) => {
          if (settled) return;
          if (nextSignal.aborted) {
            operation.cancel();
            return;
          }
          signals.add(nextSignal);
          nextSignal.addEventListener("abort", operation.cancel, { once: true });
        },
      };
      function settle(result: SessionLockAcquisition) {
        if (settled) return;
        settled = true;
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = null;
        for (const attached of signals) attached.removeEventListener("abort", operation.cancel);
        signals.clear();
        if (pending === operation) pending = null;
        resolveOutcome(result);
      }
      function fail() {
        if (epoch !== requestEpoch) return;
        status = "error";
        releaseHeldLock?.();
        releaseHeldLock = null;
        settle("error");
      }
      function request(isRetry: boolean) {
        if (epoch !== requestEpoch) return;
        try {
          void availableManager
            .request(
              SAVE_WRITER_LOCK_NAME,
              { mode: "exclusive", ifAvailable: true },
              async (lock) => {
                if (epoch !== requestEpoch) return;
                if (lock === null) {
                  if (isRetry) {
                    status = "busy";
                    settle("busy");
                  } else {
                    // Same-origin navigation can overlap the previous page's release.
                    // One bounded retry also preserves an actual holder's exclusivity.
                    retryTimer = setTimeout(() => {
                      retryTimer = null;
                      request(true);
                    }, 100);
                  }
                  return;
                }
                status = "held";
                const released = new Promise<void>((resolve) => {
                  releaseHeldLock = resolve;
                });
                settle("acquired");
                await released;
                if (epoch === requestEpoch) {
                  status = "idle";
                  releaseHeldLock = null;
                }
              },
            )
            .catch(fail);
        } catch {
          fail();
        }
      }
      pending = operation;
      if (signal) operation.attachSignal(signal);
      request(false);
      return outcome;
    },
    release: () => {
      pending?.cancel();
      requestEpoch += 1;
      releaseHeldLock?.();
      releaseHeldLock = null;
      status = manager ? "idle" : "unsupported";
    },
    isHeld: () => status === "held",
    status: () => status,
  };
}
