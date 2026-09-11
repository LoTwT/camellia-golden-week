export const SAVE_KEYS = {
  a: "camellia-golden-week.save.a",
  b: "camellia-golden-week.save.b",
  preMigration: "camellia-golden-week.save.pre-migration",
} as const;

export const MAX_SAVE_BYTES = 512 * 1024;
export const MAX_IMPORT_BYTES = 1024 * 1024;

export type SaveSlotId = "a" | "b";

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type PayloadValidation<T> =
  | { readonly ok: true; readonly value: T; readonly migrated?: boolean }
  | { readonly ok: false; readonly error: string; readonly kind: "future" | "invalid" };

export type PayloadValidator<T> = (payload: unknown) => PayloadValidation<T>;

export interface SaveEnvelope<T> {
  readonly saveGeneration: number;
  readonly savedAt: string;
  readonly payload: T;
  readonly supersededCorruptSlot?: { readonly id: SaveSlotId; readonly sha256: string };
}

export interface SaveSlot<T> {
  readonly id: SaveSlotId;
  readonly status: "empty" | "valid" | "invalid" | "future" | "unreadable";
  readonly raw: string | null;
  readonly generation: number | null;
  readonly envelope: SaveEnvelope<unknown> | null;
  readonly payload: T | null;
  readonly migrationRequired: boolean;
  readonly error: string | null;
}

export type SaveInspectionStatus =
  | "empty"
  | "ready"
  | "recovery"
  | "corrupt"
  | "future"
  | "conflict"
  | "unavailable";

export interface SaveInspection<T> {
  readonly status: SaveInspectionStatus;
  readonly slots: Readonly<Record<SaveSlotId, SaveSlot<T>>>;
  readonly maxGeneration: number;
  readonly latest: SaveSlot<T> | null;
  readonly backup: SaveSlot<T> | null;
  readonly message: string;
}

export type SaveWriteIntent =
  | "auto"
  | "retry"
  | "newGame"
  | "import"
  | "restoreBackup"
  | "migration";

export interface SaveWriteOptions<T> {
  readonly expected: SaveInspection<T>;
  readonly intent: SaveWriteIntent;
  readonly savedAt: string;
  readonly confirmedReplacement?: boolean;
  readonly migrationRequired?: boolean;
}

export type SaveFailureCode =
  | "notWriter"
  | "storageUnavailable"
  | "generationConflict"
  | "futureProtected"
  | "confirmationRequired"
  | "recoveryRequired"
  | "migrationRequired"
  | "invalidPayload"
  | "invalidEnvelope"
  | "tooLarge"
  | "generationExhausted"
  | "backupFailed"
  | "writeFailed"
  | "readbackFailed";

export type SaveWriteResult<T> =
  | {
      readonly ok: true;
      readonly inspection: SaveInspection<T>;
      readonly retryInspection: SaveInspection<T>;
      readonly envelope: SaveEnvelope<T>;
      readonly raw: string;
      readonly slot: SaveSlotId;
    }
  | {
      readonly ok: false;
      readonly code: SaveFailureCode;
      readonly message: string;
      readonly inspection: SaveInspection<T>;
      readonly retryInspection: SaveInspection<T>;
    };

export type PreparedImport<T> =
  | {
      readonly ok: true;
      readonly payload: T;
      readonly envelope: SaveEnvelope<unknown>;
      readonly raw: string;
      readonly migrationRequired: boolean;
    }
  | { readonly ok: false; readonly code: SaveFailureCode; readonly message: string };

export type MemoryExport =
  | { readonly ok: true; readonly raw: string }
  | { readonly ok: false; readonly code: SaveFailureCode; readonly message: string };

export interface SaveStore<T> {
  inspect(): SaveInspection<T>;
  write(payload: T, options: SaveWriteOptions<T>): SaveWriteResult<T>;
  prepareImport(raw: string): PreparedImport<T>;
  exportMemory(payload: T, savedAt: string, generation?: number): MemoryExport;
  exportRaw(inspection: SaveInspection<T>): Readonly<Record<SaveSlotId, string | null>>;
}

const SLOT_IDS: readonly SaveSlotId[] = ["a", "b"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function validSavedAt(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 100 &&
    Number.isFinite(Date.parse(value))
  );
}

function parseEnvelope(raw: string): SaveEnvelope<unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      !validGeneration(parsed.saveGeneration) ||
      !validSavedAt(parsed.savedAt) ||
      !Object.hasOwn(parsed, "payload")
    )
      return null;
    const acknowledgement = parsed.supersededCorruptSlot;
    if (
      acknowledgement !== undefined &&
      (!isRecord(acknowledgement) ||
        !SLOT_IDS.includes(acknowledgement.id as SaveSlotId) ||
        typeof acknowledgement.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(acknowledgement.sha256))
    )
      return null;
    return {
      saveGeneration: parsed.saveGeneration,
      savedAt: parsed.savedAt,
      payload: parsed.payload,
      ...(isRecord(acknowledgement)
        ? {
            supersededCorruptSlot: {
              id: acknowledgement.id as SaveSlotId,
              sha256: acknowledgement.sha256 as string,
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}

function extractGeneration(raw: string): number | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) && validGeneration(parsed.saveGeneration)
      ? parsed.saveGeneration
      : null;
  } catch {
    return null;
  }
}

// Portable SHA-256 lets a confirmed replacement recognize the preserved corrupt raw slot.
export function saveRawSha256(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((bytes.length * 8) / 0x1_0000_0000));
  view.setUint32(padded.length - 4, (bytes.length * 8) >>> 0);
  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
  for (let block = 0; block < padded.length; block += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(block + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const earlier = words[index - 15] ?? 0;
      const later = words[index - 2] ?? 0;
      const sigma0 = rotate(earlier, 7) ^ rotate(earlier, 18) ^ (earlier >>> 3);
      const sigma1 = rotate(later, 17) ^ rotate(later, 19) ^ (later >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }
    let a = hash[0] ?? 0,
      b = hash[1] ?? 0,
      c = hash[2] ?? 0,
      d = hash[3] ?? 0;
    let e = hash[4] ?? 0,
      f = hash[5] ?? 0,
      g = hash[6] ?? 0,
      h = hash[7] ?? 0;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 =
        (h + sigma1 + choice + (constants[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const sigma0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    const working = [a, b, c, d, e, f, g, h];
    for (let index = 0; index < 8; index += 1)
      hash[index] = ((hash[index] ?? 0) + (working[index] ?? 0)) >>> 0;
  }
  return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function safeValidate<T>(validate: PayloadValidator<T>, payload: unknown): PayloadValidation<T> {
  try {
    return validate(payload);
  } catch {
    return { ok: false, error: "存档内容校验失败。", kind: "invalid" };
  }
}

function readSlot<T>(
  storage: SaveStorage,
  validate: PayloadValidator<T>,
  id: SaveSlotId,
): SaveSlot<T> {
  let raw: string | null;
  try {
    raw = storage.getItem(SAVE_KEYS[id]);
  } catch {
    return {
      id,
      status: "unreadable",
      raw: null,
      generation: null,
      envelope: null,
      payload: null,
      migrationRequired: false,
      error: "浏览器拒绝读取存档；原数据未被覆盖。",
    };
  }
  if (raw === null)
    return {
      id,
      status: "empty",
      raw,
      generation: null,
      envelope: null,
      payload: null,
      migrationRequired: false,
      error: null,
    };
  const envelope = parseEnvelope(raw);
  const generation = envelope?.saveGeneration ?? extractGeneration(raw);
  if (!envelope)
    return {
      id,
      status: "invalid",
      raw,
      generation,
      envelope: null,
      payload: null,
      migrationRequired: false,
      error: "存档 JSON 或公共记录字段损坏。",
    };
  if (utf8Length(raw) > MAX_SAVE_BYTES)
    return {
      id,
      status: "invalid",
      raw,
      generation,
      envelope,
      payload: null,
      migrationRequired: false,
      error: "存档超过单槽 512 KiB 限制。",
    };
  const validated = safeValidate(validate, envelope.payload);
  if (!validated.ok)
    return {
      id,
      status: validated.kind === "future" ? "future" : "invalid",
      raw,
      generation,
      envelope,
      payload: null,
      migrationRequired: false,
      error: validated.error,
    };
  return {
    id,
    status: "valid",
    raw,
    generation,
    envelope,
    payload: validated.value,
    migrationRequired: validated.migrated ?? false,
    error: null,
  };
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  const pending: [unknown, unknown][] = [[left, right]];
  const compared = new WeakMap<object, WeakSet<object>>();
  while (pending.length) {
    const pair = pending.pop();
    if (!pair) break;
    const [a, b] = pair;
    if (a === b) continue;
    if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
    const previous = compared.get(a);
    if (previous?.has(b)) continue;
    if (previous) previous.add(b);
    else compared.set(a, new WeakSet([b]));
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let index = 0; index < a.length; index += 1) pending.push([a[index], b[index]]);
    } else {
      const aRecord = a as Record<string, unknown>;
      const bRecord = b as Record<string, unknown>;
      const keys = Object.keys(aRecord);
      if (keys.length !== Object.keys(bRecord).length) return false;
      for (const key of keys) {
        if (!Object.hasOwn(bRecord, key)) return false;
        pending.push([aRecord[key], bRecord[key]]);
      }
    }
  }
  return true;
}

export function inspectSaveSlots<T>(
  storage: SaveStorage,
  validate: PayloadValidator<T>,
): SaveInspection<T> {
  const slots = { a: readSlot(storage, validate, "a"), b: readSlot(storage, validate, "b") };
  const allSlots = [slots.a, slots.b];
  const candidates = allSlots
    .filter((slot) => slot.generation !== null)
    .toSorted((left, right) => (right.generation ?? 0) - (left.generation ?? 0));
  const latest = candidates[0] ?? null;
  const backup =
    allSlots
      .filter((slot) => slot.status === "valid" && slot.id !== latest?.id)
      .toSorted(
        (left, right) =>
          (right.envelope?.saveGeneration ?? 0) - (left.envelope?.saveGeneration ?? 0),
      )[0] ?? null;
  const base = { slots, maxGeneration: latest?.generation ?? 0, latest, backup };
  if (allSlots.some((slot) => slot.status === "unreadable"))
    return { ...base, status: "unavailable", message: "存储不可读，可主动选择临时游玩并导出。" };
  if (allSlots.every((slot) => slot.status === "empty"))
    return { ...base, status: "empty", message: "没有本地存档。" };
  if (allSlots.some((slot) => slot.status === "future"))
    return {
      ...base,
      status: "future",
      message: "检测到较新构建的存档，原槽已保护；请使用匹配构建或导出。",
    };
  if (
    slots.a.envelope &&
    slots.b.envelope &&
    slots.a.envelope.saveGeneration === slots.b.envelope.saveGeneration &&
    !sameJsonValue(slots.a.envelope.payload, slots.b.envelope.payload)
  )
    return {
      ...base,
      status: "conflict",
      message: "两个槽的代数相同但进度不同，无法自动选择；可分别导出原文。",
    };
  const acknowledgement = latest?.envelope?.supersededCorruptSlot;
  const uncertainCorruption = allSlots.some(
    (slot) =>
      slot.status === "invalid" &&
      slot.generation === null &&
      !(
        acknowledgement?.id === slot.id &&
        slot.raw !== null &&
        acknowledgement.sha256 === saveRawSha256(slot.raw)
      ),
  );
  if (latest?.status === "valid" && !uncertainCorruption)
    return {
      ...base,
      status: "ready",
      message: latest.migrationRequired ? "存档可迁移；保存前会保护两份原槽。" : "可继续最新存档。",
    };
  const validBackup = latest?.status === "valid" ? latest : backup;
  if (validBackup)
    return {
      ...base,
      backup: validBackup,
      status: "recovery",
      message: "发现损坏存档；确认使用有效备份后才能恢复保存。",
    };
  return {
    ...base,
    status: "corrupt",
    message: "没有可自动恢复的有效存档；可导出原文、导入或明确开始新游戏。",
  };
}

function sameRawSlots<T>(left: SaveInspection<T>, right: SaveInspection<T>): boolean {
  return SLOT_IDS.every(
    (id) =>
      left.slots[id].raw === right.slots[id].raw &&
      left.slots[id].status !== "unreadable" &&
      right.slots[id].status !== "unreadable",
  );
}

function chooseWriteSlot<T>(inspection: SaveInspection<T>): SaveSlotId {
  const validSlots = SLOT_IDS.map((id) => inspection.slots[id])
    .filter((slot) => slot.status === "valid")
    .toSorted(
      (left, right) => (right.envelope?.saveGeneration ?? 0) - (left.envelope?.saveGeneration ?? 0),
    );
  const newestValid = validSlots[0];
  if (newestValid) return newestValid.id === "a" ? "b" : "a";
  return (inspection.slots.a.envelope?.saveGeneration ?? 0) <=
    (inspection.slots.b.envelope?.saveGeneration ?? 0)
    ? "a"
    : "b";
}

function serializeEnvelope<T>(
  payload: T,
  savedAt: string,
  generation: number,
  supersededCorruptSlot?: SaveEnvelope<T>["supersededCorruptSlot"],
): MemoryExport {
  if (!validGeneration(generation) || !validSavedAt(savedAt))
    return { ok: false, code: "invalidEnvelope", message: "保存代数或显示时间无效。" };
  try {
    const raw = JSON.stringify({
      saveGeneration: generation,
      savedAt,
      payload,
      ...(supersededCorruptSlot ? { supersededCorruptSlot } : {}),
    });
    if (utf8Length(raw) > MAX_SAVE_BYTES)
      return { ok: false, code: "tooLarge", message: "完整存档超过单槽 512 KiB 限制。" };
    if (!parseEnvelope(raw))
      return { ok: false, code: "invalidEnvelope", message: "无法序列化完整存档。" };
    return { ok: true, raw };
  } catch {
    return { ok: false, code: "invalidPayload", message: "当前快照不能序列化为 JSON。" };
  }
}

export function prepareSaveImport<T>(
  raw: string,
  validate: PayloadValidator<T>,
): PreparedImport<T> {
  if (utf8Length(raw) > MAX_IMPORT_BYTES)
    return { ok: false, code: "tooLarge", message: "导入文件超过 1 MiB 限制。" };
  const envelope = parseEnvelope(raw);
  if (!envelope)
    return { ok: false, code: "invalidEnvelope", message: "导入文件不是完整有效的存档 JSON。" };
  const validated = safeValidate(validate, envelope.payload);
  if (!validated.ok)
    return {
      ok: false,
      code: validated.kind === "future" ? "futureProtected" : "invalidPayload",
      message: validated.error,
    };
  const serialized = serializeEnvelope(validated.value, envelope.savedAt, envelope.saveGeneration);
  if (!serialized.ok) return serialized;
  return {
    ok: true,
    payload: validated.value,
    envelope,
    raw,
    migrationRequired: validated.migrated ?? false,
  };
}

export function createSaveStore<T>(
  storage: SaveStorage,
  validate: PayloadValidator<T>,
  isWriter: () => boolean,
): SaveStore<T> {
  const inspect = () => inspectSaveSlots(storage, validate);
  const write = (payload: T, options: SaveWriteOptions<T>): SaveWriteResult<T> => {
    let current = inspect();
    let retryInspection = options.expected;
    const failure = (code: SaveFailureCode, message: string): SaveWriteResult<T> => ({
      ok: false,
      code,
      message,
      inspection: current,
      retryInspection,
    });
    if (!isWriter())
      return failure("notWriter", "进度正在另一窗口使用，或当前为临时模式；未写入存档。");
    if (current.status === "unavailable") return failure("storageUnavailable", current.message);
    if (!sameRawSlots(current, options.expected))
      return failure(
        "generationConflict",
        "存档已被其他会话更改；请重新读取，当前快照未覆盖新进度。",
      );
    if (current.status === "future") return failure("futureProtected", current.message);
    const explicitReplacement =
      options.intent === "newGame" ||
      options.intent === "import" ||
      options.intent === "restoreBackup";
    const hasExistingData = SLOT_IDS.some((id) => current.slots[id].raw !== null);
    if (
      (options.intent === "import" ||
        options.intent === "restoreBackup" ||
        (options.intent === "newGame" && hasExistingData)) &&
      !options.confirmedReplacement
    )
      return failure("confirmationRequired", "请先预览并明确确认替换进度，可先导出原存档。");
    if (current.status !== "ready" && current.status !== "empty" && !explicitReplacement)
      return failure("recoveryRequired", current.message);
    if (options.intent === "restoreBackup" && !current.backup && current.latest?.status !== "valid")
      return failure("recoveryRequired", "没有有效备份可恢复。");
    const needsMigration =
      current.latest?.migrationRequired === true ||
      (options.intent === "restoreBackup" && current.backup?.migrationRequired === true);
    if (needsMigration && options.intent !== "migration" && !explicitReplacement)
      return failure("migrationRequired", "需先完成原槽备份和内存迁移，再保存新格式。");
    if (current.maxGeneration === Number.MAX_SAFE_INTEGER)
      return failure("generationExhausted", "本地保存代数已到安全整数上限；未覆盖原存档，可导出。");
    const validated = safeValidate(validate, payload);
    if (!validated.ok)
      return failure(
        validated.kind === "future" ? "futureProtected" : "invalidPayload",
        validated.error,
      );
    if (
      options.intent === "restoreBackup" &&
      !sameJsonValue(validated.value, (current.backup ?? current.latest)?.payload)
    )
      return failure("invalidPayload", "恢复内容与所选有效备份不一致。");
    const generation = current.maxGeneration + 1;
    const targetSlot = chooseWriteSlot(current);
    const retainedSlot = current.slots[targetSlot === "a" ? "b" : "a"];
    const acknowledgement =
      explicitReplacement &&
      retainedSlot.status === "invalid" &&
      retainedSlot.generation === null &&
      retainedSlot.raw !== null
        ? { id: retainedSlot.id, sha256: saveRawSha256(retainedSlot.raw) }
        : undefined;
    const serialized = serializeEnvelope(
      validated.value,
      options.savedAt,
      generation,
      acknowledgement,
    );
    if (!serialized.ok) return failure(serialized.code, serialized.message);
    const roundTrip = parseEnvelope(serialized.raw);
    const roundTripValidation = roundTrip ? safeValidate(validate, roundTrip.payload) : null;
    if (!roundTripValidation?.ok || roundTripValidation.migrated)
      return failure("invalidPayload", "序列化后的快照未通过当前版本完整校验。");
    const migration =
      options.intent === "migration" ||
      needsMigration ||
      validated.migrated === true ||
      options.migrationRequired === true;
    if (migration && hasExistingData) {
      const backupRaw = JSON.stringify({
        backedUpAt: options.savedAt,
        saves: { a: current.slots.a.raw, b: current.slots.b.raw },
      });
      try {
        storage.setItem(SAVE_KEYS.preMigration, backupRaw);
        if (storage.getItem(SAVE_KEYS.preMigration) !== backupRaw)
          return failure("backupFailed", "迁移前原槽备份回读失败；两槽未改写，可导出原文。");
      } catch {
        return failure("backupFailed", "迁移前原槽备份写入失败；已停止持久迁移，可导出原文。");
      }
      const afterBackup = inspect();
      if (!sameRawSlots(current, afterBackup)) {
        current = afterBackup;
        return failure("generationConflict", "迁移备份期间原槽发生变化，未写入新格式。");
      }
    }
    if (!isWriter()) return failure("notWriter", "保存前会话锁已释放，当前快照未写入。");
    const inspectOwnWrite = () => {
      current = inspect();
      if (
        current.status === "ready" &&
        current.slots[targetSlot].raw === serialized.raw &&
        current.slots[retainedSlot.id].raw === retainedSlot.raw
      )
        retryInspection = current;
    };
    try {
      storage.setItem(SAVE_KEYS[targetSlot], serialized.raw);
    } catch {
      return failure("writeFailed", "浏览器拒绝写入；当前游戏仍在内存中，可导出或重试保存。");
    }
    try {
      if (storage.getItem(SAVE_KEYS[targetSlot]) !== serialized.raw) {
        inspectOwnWrite();
        return failure("readbackFailed", "新存档回读不匹配；未标记已保存，上一有效槽保留。");
      }
    } catch {
      inspectOwnWrite();
      return failure("readbackFailed", "新存档无法回读；未标记已保存，上一有效槽保留。");
    }
    inspectOwnWrite();
    if (current.slots[retainedSlot.id].raw !== retainedSlot.raw)
      return failure(
        "generationConflict",
        "写后复核发现另一槽已变化；未接受新的保存基线，请先导出当前进度再重新读取。",
      );
    const confirmed = current.slots[targetSlot];
    if (
      current.status !== "ready" ||
      confirmed.status !== "valid" ||
      confirmed.envelope?.saveGeneration !== generation ||
      confirmed.raw !== serialized.raw ||
      confirmed.migrationRequired
    )
      return failure("readbackFailed", "写后完整校验未通过；未标记已保存。");
    return {
      ok: true,
      inspection: current,
      retryInspection: current,
      envelope: {
        saveGeneration: generation,
        savedAt: options.savedAt,
        payload: roundTripValidation.value,
        ...(acknowledgement ? { supersededCorruptSlot: acknowledgement } : {}),
      },
      raw: serialized.raw,
      slot: targetSlot,
    };
  };
  return {
    inspect,
    write,
    prepareImport: (raw) => prepareSaveImport(raw, validate),
    exportMemory: (payload, savedAt, generation = 1) => {
      const validated = safeValidate(validate, payload);
      return validated.ok
        ? serializeEnvelope(validated.value, savedAt, generation)
        : {
            ok: false,
            code: validated.kind === "future" ? "futureProtected" : "invalidPayload",
            message: validated.error,
          };
    },
    exportRaw: (inspection) => ({ a: inspection.slots.a.raw, b: inspection.slots.b.raw }),
  };
}
