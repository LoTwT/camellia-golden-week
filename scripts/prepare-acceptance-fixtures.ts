import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assembleLegacyContent } from "../src/content/assemble.ts";
import type { ProfileId } from "../src/core/types.ts";
import { additiveProfileMigrations } from "../src/platform/migrations.ts";
import { validatePayload } from "../src/platform/save-payload.ts";
import type { SavePayload } from "../src/platform/save-payload.ts";
import {
  createSaveStore,
  MAX_IMPORT_BYTES,
  prepareSaveImport,
  SAVE_KEYS,
} from "../src/platform/save-store.ts";
import type {
  SaveFailureCode,
  SaveInspectionStatus,
  SaveSlotId,
} from "../src/platform/save-store.ts";

// This command is intentionally absent from build and validate:content. It writes
// only this ignored directory, never browser storage or tracked evidence files.
const mode = process.argv[2];
assert.ok(
  process.argv.length === 3 && (mode === "--write" || mode === "--check"),
  "用法：node scripts/prepare-acceptance-fixtures.ts --write | --check",
);
const repository = new URL("../", import.meta.url);
const outputPath = "test-results/m5-fault-fixtures/";
const outputDirectory = new URL(outputPath, repository);
const sourcePath = "docs/verification/evidence/m4-chrome-browser-full-save.json";
const trackedManifestPath = "docs/verification/evidence/m5-fault-fixtures.json";
const sourceBytes = readFileSync(new URL(sourcePath, repository));
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sourceHash = "4e71abc34dae4b070d8c3846f56985d93d528a09027d6862e2606bae088a956b";
assert.equal(sha256(sourceBytes), sourceHash, "真实 UI 导出来源发生变化，请先重新核对来源");
const sourceRaw = sourceBytes.toString("utf8");

interface FixtureEnvelope {
  saveGeneration: number;
  savedAt: string;
  payload: SavePayload;
}
const source = JSON.parse(sourceRaw) as FixtureEnvelope;
// This generator reproduces the published v1 evidence manifest and its original rule boundaries.
const releases = (["M1", "M2", "M3", "M4", "M5"] as ProfileId[]).map(assembleLegacyContent);
const target = releases.at(-1)!;
const registry = additiveProfileMigrations(releases);
const validate = (payload: unknown) => validatePayload(payload, target, registry);
const validSource = prepareSaveImport(sourceRaw, validate);
assert.ok(validSource.ok, "真实源档必须通过当前 M5 导入校验");
assert.equal(source.payload.releaseProfileId, "M4");
assert.equal(source.payload.claimedRewardIds.length, 26);
assert.equal(Object.keys(source.payload.completedRoomLayouts).length, 9);
assert.equal(
  target.rewards.reduce(
    (units, reward) =>
      units + (source.payload.claimedRewardIds.includes(reward.id) ? reward.units : 0),
    0,
  ),
  130,
);
const sourceProgress = structuredClone(source.payload);
const nextGeneration = source.saveGeneration + 1;
const mutateEnvelope = (mutate: (envelope: FixtureEnvelope) => void): string => {
  const envelope = structuredClone(source);
  mutate(envelope);
  return JSON.stringify(envelope);
};

interface Fixture {
  id: string;
  cases: string[];
  purpose: string;
  mutation: string;
  raw: string;
  expected: "accepted" | SaveFailureCode;
}
const fixtures: Fixture[] = [
  {
    id: "valid-original",
    cases: ["P04", "P05", "P06"],
    purpose: "合法导入对照、旧有效槽；浏览器仍须预览并明确确认才替换。",
    mutation: "无；与真实 Chrome UI 导出逐字节相同。",
    raw: sourceRaw,
    expected: "accepted",
  },
  {
    id: "valid-higher-generation-older-time",
    cases: ["P04"],
    purpose: "与 valid-original 分别交换 A/B，验证始终选择较高代数，不按键名或墙钟日期选择。",
    mutation: `仅 envelope.saveGeneration=${nextGeneration}，savedAt=2000-01-01T00:00:00.000Z；payload 原样保留。`,
    raw: mutateEnvelope((envelope) => {
      envelope.saveGeneration = nextGeneration;
      envelope.savedAt = "2000-01-01T00:00:00.000Z";
    }),
    expected: "accepted",
  },
  {
    id: "bad-json",
    cases: ["P04", "P06"],
    purpose: "单槽损坏、两槽损坏及 JSON 导入失败；截断后代数不可解析，必须显式恢复。",
    mutation: "截去真实源档最后一个闭合花括号。",
    raw: sourceRaw.trimEnd().slice(0, -1),
    expected: "invalidEnvelope",
  },
  {
    id: "over-1mib",
    cases: ["P06"],
    purpose: "仅超出导入大小上限 1 字节；JSON 本身仍合法，验证大小检查优先。",
    mutation: "在原 JSON 后追加合法 ASCII 空白，使 UTF-8 大小精确为 1,048,577 字节。",
    raw: sourceRaw + " ".repeat(MAX_IMPORT_BYTES + 1 - sourceBytes.byteLength),
    expected: "tooLarge",
  },
  {
    id: "wrong-project",
    cases: ["P06"],
    purpose: "错误项目文件必须拒绝。",
    mutation: "仅 payload.gameId=acceptance-other-game。",
    raw: mutateEnvelope((envelope) => {
      Object.assign(envelope.payload, { gameId: "acceptance-other-game" });
    }),
    expected: "invalidPayload",
  },
  {
    id: "unknown-objective",
    cases: ["P06"],
    purpose: "合法 ID 字符格式但目录中不存在的目标必须拒绝。",
    mutation: "仅追加 completedObjectiveIds=acceptance.unknown-objective。",
    raw: mutateEnvelope((envelope) => {
      envelope.payload.completedObjectiveIds.push("acceptance.unknown-objective");
    }),
    expected: "invalidPayload",
  },
  {
    id: "illegal-object-overlap",
    cases: ["P06"],
    purpose: "固定房间中两个已知对象占据同一已知格必须拒绝。",
    mutation: "仅把 c.theft.01 第二个对象的完成落点改为第一个对象落点；不改变目标、奖励或玩家。",
    raw: mutateEnvelope((envelope) => {
      const roomId = "c.theft.01";
      const layout = envelope.payload.completedRoomLayouts[roomId];
      assert.ok(layout);
      const [first, second] = Object.entries(layout.objectTileById);
      assert.ok(first && second && first[1] !== second[1]);
      envelope.payload.completedRoomLayouts[roomId] = {
        ...layout,
        objectTileById: { ...layout.objectTileById, [second[0]]: first[1] },
      };
    }),
    expected: "invalidPayload",
  },
  {
    id: "script-string",
    cases: ["P06"],
    purpose: "脚本文本只作为 JSON 字符串交给校验器，不得执行或注入 DOM；未知字段应拒绝。",
    mutation: "仅增加非法 acceptanceScript 字段，内容为无网络请求的 DOM 标记脚本文本。",
    raw: mutateEnvelope((envelope) => {
      Object.assign(envelope.payload, {
        acceptanceScript:
          '<script>document.documentElement.setAttribute("data-camellia-fixture-executed","true")</script>',
      });
    }),
    expected: "invalidPayload",
  },
  ...(["schemaVersion", "contentVersion"] as const).map((field): Fixture => ({
    id: field === "schemaVersion" ? "future-schema" : "future-content",
    cases: ["P05", "P06"],
    purpose: "与 valid-original 组成新旧两槽，较新版本必须阻止回退与写入；导入也必须拒绝。",
    mutation: `仅 envelope.saveGeneration=${nextGeneration}，payload.${field}=${source.payload[field] + 1}。`,
    raw: mutateEnvelope((envelope) => {
      envelope.saveGeneration = nextGeneration;
      envelope.payload[field] += 1;
    }),
    expected: "futureProtected",
  })),
];

const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
assert.equal(fixtureById.size, fixtures.length);
const oversized = fixtureById.get("over-1mib");
assert.ok(oversized);
assert.equal(Buffer.byteLength(oversized.raw), MAX_IMPORT_BYTES + 1);
assert.deepEqual(JSON.parse(oversized.raw), source, "超限夹具只改变字节数，JSON 内容仍合法");
const checkedFixtures = fixtures.map((fixture) => {
  const outcome = prepareSaveImport(fixture.raw, validate);
  assert.equal(outcome.ok ? "accepted" : outcome.code, fixture.expected, fixture.id);
  assert.deepEqual(source.payload, sourceProgress, `${fixture.id}: 校验不能改变源 payload`);
  return {
    id: fixture.id,
    path: `${outputPath}${fixture.id}.json`,
    bytes: Buffer.byteLength(fixture.raw),
    sha256: sha256(fixture.raw),
    cases: fixture.cases,
    purpose: fixture.purpose,
    mutation: fixture.mutation,
    expectedImport: fixture.expected,
    actualImport: outcome.ok
      ? {
          ok: true,
          releaseProfileId: outcome.payload.releaseProfileId,
          migrationRequired: outcome.migrationRequired,
        }
      : { ok: false, code: outcome.code, message: outcome.message },
  };
});

interface SlotScenario {
  id: string;
  caseId: "P04" | "P05";
  a: string;
  b: string;
  expected: SaveInspectionStatus;
  latest?: SaveSlotId;
  backup?: SaveSlotId;
}
const slotScenarios: SlotScenario[] = [
  {
    id: "corrupt-a-valid-b",
    caseId: "P04",
    a: "bad-json",
    b: "valid-original",
    expected: "recovery",
    backup: "b",
  },
  {
    id: "valid-a-corrupt-b",
    caseId: "P04",
    a: "valid-original",
    b: "bad-json",
    expected: "recovery",
    backup: "a",
  },
  { id: "both-corrupt", caseId: "P04", a: "bad-json", b: "bad-json", expected: "corrupt" },
  {
    id: "higher-a-older-wall-clock",
    caseId: "P04",
    a: "valid-higher-generation-older-time",
    b: "valid-original",
    expected: "ready",
    latest: "a",
    backup: "b",
  },
  {
    id: "higher-b-older-wall-clock",
    caseId: "P04",
    a: "valid-original",
    b: "valid-higher-generation-older-time",
    expected: "ready",
    latest: "b",
    backup: "a",
  },
  ...["future-schema", "future-content"].flatMap((id): SlotScenario[] => [
    {
      id: `${id}-a`,
      caseId: "P05",
      a: id,
      b: "valid-original",
      expected: "future",
      latest: "a",
      backup: "b",
    },
    {
      id: `${id}-b`,
      caseId: "P05",
      a: "valid-original",
      b: id,
      expected: "future",
      latest: "b",
      backup: "a",
    },
  ]),
];
const checkedScenarios = slotScenarios.map((scenario) => {
  const a = fixtureById.get(scenario.a),
    b = fixtureById.get(scenario.b);
  assert.ok(a && b);
  const rawSlots = new Map<string, string>([
    [SAVE_KEYS.a, a.raw],
    [SAVE_KEYS.b, b.raw],
  ]);
  const originalSlots = [...rawSlots];
  let writes = 0;
  const store = createSaveStore(
    {
      getItem: (key) => rawSlots.get(key) ?? null,
      setItem: (key, value) => {
        writes += 1;
        rawSlots.set(key, value);
      },
    },
    validate,
    () => true,
  );
  const inspection = store.inspect();
  assert.equal(inspection.status, scenario.expected, scenario.id);
  if (scenario.latest) assert.equal(inspection.latest?.id, scenario.latest, scenario.id);
  if (scenario.backup) assert.equal(inspection.backup?.id, scenario.backup, scenario.id);
  let rejectedWrite: { code: SaveFailureCode; writes: number } | null = null;
  if (scenario.expected !== "ready") {
    const outcome = store.write(validSource.payload, {
      expected: inspection,
      intent: "auto",
      savedAt: source.savedAt,
    });
    assert.ok(!outcome.ok, `${scenario.id}: 不得静默恢复写入`);
    assert.equal(
      outcome.code,
      scenario.expected === "future" ? "futureProtected" : "recoveryRequired",
    );
    assert.equal(writes, 0);
    rejectedWrite = { code: outcome.code, writes };
  }
  assert.deepEqual([...rawSlots], originalSlots, `${scenario.id}: 两槽原文保持不变`);
  return {
    ...scenario,
    actual: {
      status: inspection.status,
      latest: inspection.latest?.id ?? null,
      backup: inspection.backup?.id ?? null,
      maxGeneration: inspection.maxGeneration,
      rejectedWrite,
      rawSlotsUnchanged: true,
    },
  };
});

const manifest = {
  schemaVersion: 1,
  purpose: "P04/P05/P06 平台故障与导入边界夹具；不属于正常通关见证。",
  generator: "scripts/prepare-acceptance-fixtures.ts",
  commands: {
    generate: "node scripts/prepare-acceptance-fixtures.ts --write",
    verify: "node scripts/prepare-acceptance-fixtures.ts --check",
    publishEvidence: `cp ${outputPath}manifest.json ${trackedManifestPath}`,
  },
  source: {
    path: sourcePath,
    bytes: sourceBytes.byteLength,
    sha256: sourceHash,
    saveGeneration: source.saveGeneration,
    savedAt: source.savedAt,
    releaseProfileId: source.payload.releaseProfileId,
    rewardCount: 26,
    supplyUnits: 130,
    completedRoomLayoutCount: 9,
  },
  target: {
    releaseProfileId: target.profile.id,
    schemaVersion: 2,
    contentVersion: target.contentVersion,
    ruleVersion: target.ruleVersion,
  },
  validation: {
    implementation: [
      "prepareSaveImport",
      "validatePayload",
      "additiveProfileMigrations",
      "createSaveStore.inspect/write",
    ],
    fixtureCount: checkedFixtures.length,
    slotScenarioCount: checkedScenarios.length,
    allExpectedResultsMatched: true,
    sourceBytesUnchanged: true,
    browserStatus: "未执行；这些结果仅来自真实纯 TypeScript 校验器与内存存储端口。",
  },
  browserUse: [
    "先通过游戏 UI 导出当前正常进度；全部夹具只供 acceptance 构建和单独故障会话使用。",
    "P04/P05 通过可见故障面板按 slotScenarios 分别写入 A/B，再刷新检查；两槽原文仍应可导出。",
    "P06 使用游戏导入按钮选择夹具；失败后对比导入前世界与存档，合法文件必须先预览再确认。",
    "脚本字符串夹具应拒绝，document.documentElement 不应出现 data-camellia-fixture-executed；本脚本未执行 DOM 验证。",
    "over-1mib 只用于文件导入，不经过有 512 KiB 单槽限制的故障原文面板。",
    "故障边界记录与正常新档通关记录分开，不能把这些文件作为通关操作证据。",
  ],
  fixtures: checkedFixtures,
  slotScenarios: checkedScenarios,
};
const manifestRaw = `${JSON.stringify(manifest, null, 2)}\n`;
const outputs = [
  ...fixtures.map((fixture) => ({ name: `${fixture.id}.json`, raw: fixture.raw })),
  { name: "manifest.json", raw: manifestRaw },
];

for (const directory of [new URL("test-results/", repository), outputDirectory]) {
  const status = lstatSync(directory, { throwIfNoEntry: false });
  if (status)
    assert.ok(status.isDirectory() && !status.isSymbolicLink(), "输出目录不能是文件或符号链接");
}
if (mode === "--write") mkdirSync(outputDirectory, { recursive: true });
for (const output of outputs) {
  const url = new URL(output.name, outputDirectory);
  const status = lstatSync(url, { throwIfNoEntry: false });
  if (status)
    assert.ok(status.isFile() && !status.isSymbolicLink(), "输出文件不能是目录或符号链接");
  if (mode === "--write") writeFileSync(url, output.raw);
  assert.deepEqual(readFileSync(url), Buffer.from(output.raw), `${output.name}: 文件字节不匹配`);
}
assert.deepEqual(
  readFileSync(new URL(sourcePath, repository)),
  sourceBytes,
  "真实 UI 导出必须保持原文",
);
if (mode === "--check")
  assert.deepEqual(
    JSON.parse(readFileSync(new URL(trackedManifestPath, repository), "utf8")),
    manifest,
    "跟踪的证据清单与生成结果不一致（格式差异不影响内容）",
  );
console.log(
  `${mode}: ${fixtures.length} 个夹具、${slotScenarios.length} 个双槽组合全部符合预期；来源原文未改动。`,
);
console.log(`输出：${fileURLToPath(outputDirectory)}`);
