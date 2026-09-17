import { SAVE_WRITER_LOCK_NAME } from "./session-lock.ts";
import type { SessionLockManager } from "./session-lock.ts";

const STORAGE_KEY = "camellia-golden-week.acceptance.session-diagnostics.v1";
const MAX_EVENTS = 80;
const MAX_BYTES = 48 * 1024;
const encoder = new TextEncoder();
type Detail = string | number | boolean | null;
type LockSnapshot = {
  readonly held?: readonly NativeLockInfo[];
  readonly pending?: readonly NativeLockInfo[];
};
interface NativeLockInfo {
  readonly name?: string;
  readonly mode?: string;
  readonly clientId?: string;
}
interface DiagnosticLockManager extends SessionLockManager {
  query?(): Promise<LockSnapshot>;
}
interface DiagnosticEvent {
  readonly sequence: number;
  readonly pageId: string;
  readonly path: string;
  readonly timeOriginMs: number;
  readonly elapsedMs: number;
  readonly visibility: string;
  readonly kind: string;
  readonly details: Readonly<Record<string, Detail>>;
  readonly locks?: {
    readonly held: readonly NativeLockInfo[];
    readonly pending: readonly NativeLockInfo[];
  };
}
export interface SessionDiagnosticsOptions {
  readonly buildMode: string;
  readonly storage: {
    getItem(key: string): string | null;
    setItem(key: string, raw: string): void;
  };
  readonly manager: DiagnosticLockManager | null | undefined;
  readonly pageId: string;
  readonly path: string;
  readonly timeOriginMs: number;
  readonly navigationType: string;
  readonly now: () => number;
  readonly visibility: () => string;
}
export interface SessionDiagnostics {
  readonly manager: SessionLockManager | null | undefined;
  record(kind: string, details?: Readonly<Record<string, Detail>>): void;
  query(reason: "acquired" | "busy"): void;
  snapshot(): {
    readonly pageId: string;
    readonly storage: "available" | "unavailable";
    readonly discardedStoredTraces: number;
    readonly events: readonly DiagnosticEvent[];
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum;
}
function isLockList(value: unknown): value is NativeLockInfo[] {
  return (
    Array.isArray(value) &&
    value.length <= 8 &&
    value.every(
      (lock) =>
        isObject(lock) &&
        lock.name === SAVE_WRITER_LOCK_NAME &&
        isText(lock.mode, 16) &&
        isText(lock.clientId, 128),
    )
  );
}
function isEvent(value: unknown): value is DiagnosticEvent {
  return (
    isObject(value) &&
    Number.isSafeInteger(value.sequence) &&
    (value.sequence as number) > 0 &&
    isText(value.pageId, 64) &&
    isText(value.path, 256) &&
    typeof value.timeOriginMs === "number" &&
    Number.isFinite(value.timeOriginMs) &&
    typeof value.elapsedMs === "number" &&
    Number.isFinite(value.elapsedMs) &&
    isText(value.visibility, 16) &&
    isText(value.kind, 48) &&
    isObject(value.details) &&
    Object.entries(value.details).length <= 8 &&
    Object.entries(value.details).every(
      ([key, detail]) =>
        key.length <= 48 &&
        (detail === null ||
          typeof detail === "boolean" ||
          (typeof detail === "number" && Number.isFinite(detail)) ||
          isText(detail, 160)),
    ) &&
    (value.locks === undefined ||
      (isObject(value.locks) && isLockList(value.locks.held) && isLockList(value.locks.pending)))
  );
}
function errorDetails(error: unknown): Record<string, Detail> {
  return error instanceof Error
    ? { error: error.name.slice(0, 160), message: error.message.slice(0, 160) }
    : { error: "UnknownError", message: typeof error === "string" ? error.slice(0, 160) : "" };
}

export function createSessionDiagnostics(
  options: SessionDiagnosticsOptions,
): SessionDiagnostics | null {
  if (options.buildMode !== "acceptance") return null;
  let events: DiagnosticEvent[] = [];
  let storage: "available" | "unavailable" = "available";
  let discardedStoredTraces = 0;
  let requestId = 0;
  function readStoredEvents(): DiagnosticEvent[] | null {
    try {
      const raw = options.storage.getItem(STORAGE_KEY);
      if (raw === null) return [];
      if (raw.length > MAX_BYTES || encoder.encode(raw).length > MAX_BYTES) {
        discardedStoredTraces += 1;
        return null;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        discardedStoredTraces += 1;
        return null;
      }
      if (
        !isObject(parsed) ||
        parsed.version !== 1 ||
        !Array.isArray(parsed.events) ||
        parsed.events.length > MAX_EVENTS ||
        !parsed.events.every(isEvent)
      ) {
        discardedStoredTraces += 1;
        return null;
      }
      return parsed.events;
    } catch {
      storage = "unavailable";
      return null;
    }
  }
  function record(
    kind: string,
    details: Readonly<Record<string, Detail>> = {},
    locks?: DiagnosticEvent["locks"],
  ) {
    try {
      events = readStoredEvents() ?? events;
      const previousSequence = events.at(-1)?.sequence ?? 0;
      const sequence = previousSequence < Number.MAX_SAFE_INTEGER ? previousSequence + 1 : 1;
      const safeDetails = Object.fromEntries(
        Object.entries(details)
          .slice(0, 8)
          .map(([key, detail]) => [
            key.slice(0, 48),
            typeof detail === "string"
              ? detail.slice(0, 160)
              : typeof detail === "number" && !Number.isFinite(detail)
                ? null
                : detail,
          ]),
      );
      events.push({
        sequence,
        pageId: options.pageId.slice(0, 64),
        path: options.path.slice(0, 256),
        timeOriginMs: options.timeOriginMs,
        elapsedMs: options.now(),
        visibility: options.visibility().slice(0, 16),
        kind: kind.slice(0, 48),
        details: safeDetails,
        ...(locks ? { locks } : {}),
      });
      events = events.slice(-MAX_EVENTS);
      let raw = JSON.stringify({ version: 1, events });
      while (encoder.encode(raw).length > MAX_BYTES && events.length > 1) {
        events.shift();
        raw = JSON.stringify({ version: 1, events });
      }
      options.storage.setItem(STORAGE_KEY, raw);
      storage = "available";
    } catch {
      storage = "unavailable";
    }
  }
  const manager = options.manager;
  const observedManager: SessionLockManager | null | undefined = manager
    ? {
        request: (name, requestOptions, callback) => {
          const id = ++requestId;
          record("request-start", { requestId: id, name, ...requestOptions });
          try {
            const nativeRequest = manager.request(name, requestOptions, (lock) => {
              record("request-callback", {
                requestId: id,
                result: lock === null ? "busy" : "acquired",
              });
              try {
                const waiting = callback(lock);
                void waiting.then(
                  () => record("callback-complete", { requestId: id }),
                  (error: unknown) =>
                    record("callback-error", { requestId: id, ...errorDetails(error) }),
                );
                // Preserve the exact waiting promise; observation adds no await layer.
                return waiting;
              } catch (error) {
                record("callback-error", { requestId: id, ...errorDetails(error) });
                throw error;
              }
            });
            void nativeRequest.then(
              () => record("request-complete", { requestId: id }),
              (error: unknown) =>
                record("request-error", { requestId: id, ...errorDetails(error) }),
            );
            return nativeRequest;
          } catch (error) {
            record("request-error", { requestId: id, ...errorDetails(error) });
            throw error;
          }
        },
      }
    : manager;
  record("page-start", { navigationType: options.navigationType });
  return {
    manager: observedManager,
    record,
    query: (reason) => {
      if (!manager?.query) {
        record("query-unavailable", { reason });
        return;
      }
      record("query-start", { reason });
      try {
        void manager
          .query()
          .then((snapshot) => {
            const matching = (items: readonly NativeLockInfo[] = []) =>
              items.filter((lock) => lock.name === SAVE_WRITER_LOCK_NAME);
            const held = matching(snapshot.held);
            const pending = matching(snapshot.pending);
            const trim = (items: readonly NativeLockInfo[]) =>
              items.slice(0, 8).map((lock) => ({
                name: SAVE_WRITER_LOCK_NAME,
                mode: (lock.mode ?? "").slice(0, 16),
                clientId: (lock.clientId ?? "").slice(0, 128),
              }));
            record(
              "query-result",
              { reason, heldCount: held.length, pendingCount: pending.length },
              {
                held: trim(held),
                pending: trim(pending),
              },
            );
          })
          .catch((error: unknown) => record("query-error", { reason, ...errorDetails(error) }));
      } catch (error) {
        record("query-error", { reason, ...errorDetails(error) });
      }
    },
    snapshot: () => ({
      pageId: options.pageId,
      storage,
      discardedStoredTraces,
      events: structuredClone(events),
    }),
  };
}
