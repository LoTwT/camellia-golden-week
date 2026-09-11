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
  acquire(): Promise<SessionLockAcquisition>;
  release(): void;
  isHeld(): boolean;
  status(): SessionLockStatus;
}

export function createSessionLock(manager: SessionLockManager | null | undefined): SaveSessionLock {
  let status: SessionLockStatus = manager ? "idle" : "unsupported";
  let pending: Promise<SessionLockAcquisition> | null = null;
  let releaseHeldLock: (() => void) | null = null;
  let requestEpoch = 0;
  return {
    acquire: () => {
      if (!manager) return Promise.resolve("unsupported");
      if (status === "held") return Promise.resolve("acquired");
      if (pending) return pending;
      status = "acquiring";
      const epoch = ++requestEpoch;
      let settleAcquisition: (outcome: SessionLockAcquisition) => void = () => {};
      const outcome = new Promise<SessionLockAcquisition>((resolve) => {
        settleAcquisition = resolve;
      });
      pending = outcome;
      try {
        void manager
          .request(
            SAVE_WRITER_LOCK_NAME,
            { mode: "exclusive", ifAvailable: true },
            async (lock) => {
              if (epoch !== requestEpoch) {
                settleAcquisition("cancelled");
                return;
              }
              if (lock === null) {
                status = "busy";
                settleAcquisition("busy");
                return;
              }
              status = "held";
              const released = new Promise<void>((resolve) => {
                releaseHeldLock = resolve;
              });
              settleAcquisition("acquired");
              await released;
              if (epoch === requestEpoch) status = "idle";
            },
          )
          .catch(() => {
            if (epoch === requestEpoch) {
              status = "error";
              releaseHeldLock?.();
              releaseHeldLock = null;
            }
            settleAcquisition("error");
          });
      } catch {
        status = "error";
        settleAcquisition("error");
      }
      void outcome.then(() => {
        if (pending === outcome) pending = null;
      });
      return outcome;
    },
    release: () => {
      requestEpoch += 1;
      releaseHeldLock?.();
      releaseHeldLock = null;
      status = manager ? "idle" : "unsupported";
      pending = null;
    },
    isHeld: () => status === "held",
    status: () => status,
  };
}
