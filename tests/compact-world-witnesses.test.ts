import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import m1 from "../src/content/witnesses/m1.ts";
import m2 from "../src/content/witnesses/m2.ts";
import m3 from "../src/content/witnesses/m3.ts";
import m4 from "../src/content/witnesses/m4.ts";
import r1 from "../src/content/witnesses/r1-world.ts";
import {
  compactWitnessCollection,
  expandWitnessCollection,
} from "../src/content/witnesses/compact.ts";
import type { WorldWitnessStep } from "../src/content/validate.ts";
import digests from "./fixtures/world-witness-digests.json" with { type: "json" };

// Frozen before conversion, independently of the encoder/decoder; includes every metadata field.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
    );
  return value;
}
const sources = { m1, m2, m3, m4, "r1-world": r1 };
for (const digest of digests)
  test(`${digest.name} 展开后全部步骤、时间、检查点、续玩及元数据与独立冻结摘要一致`, () => {
    const source = sources[digest.name as keyof typeof sources];
    const hash = createHash("sha256")
      .update(JSON.stringify(canonical(source)))
      .digest("hex");
    assert.equal(hash, digest.expandedCanonicalSha256);
    const routes = [
      ...source.witnesses,
      ...("continuations" in source ? source.continuations : []),
    ];
    assert.equal(
      routes.reduce((sum, route) => sum + route.steps.length, 0),
      digest.steps,
    );
  });

const checkpoint = {
  id: "checkpoint.test",
  expected: {
    areaId: "hub",
    tileId: "hub.t.0.0",
    mode: "explore",
    completedObjectiveIds: [],
    absentObjectiveIds: [],
    claimedRewardIds: [],
    supplyUnits: 0,
    aData: 0,
  },
};
const example = () => ({
  encoding: "world-witness-runs-v1",
  commands: { Tick: { kind: "Tick" }, "Move:right": { kind: "Move", direction: "right" } },
  witnesses: [
    {
      id: "example",
      runs: [
        [100, "Tick", "accepted", 3, 100],
        [340, "Move:right", "blocked", 1, 0, checkpoint],
      ],
    },
  ],
});

test("连续 Tick 保留逐次调度，间隔、结果变化和检查点不被合并", () => {
  const steps: WorldWitnessStep[] = [
    { atMs: 100, command: { kind: "Tick" }, expectedCode: "accepted" },
    { atMs: 200, command: { kind: "Tick" }, expectedCode: "accepted" },
    { atMs: 300, command: { kind: "Tick" }, expectedCode: "accepted" },
    {
      atMs: 340,
      command: { kind: "Move", direction: "right" },
      expectedCode: "blocked",
      checkpoint,
    },
  ];
  assert.deepEqual(expandWitnessCollection(example()).witnesses[0]!.steps, steps);
  const source = {
    authoredFrom: "independent example",
    witnesses: [
      {
        id: "example",
        steps: [
          ...steps,
          { atMs: 340, command: { kind: "Tick" } as const, expectedCode: "success" },
        ],
      },
    ],
    continuations: [{ initialStateId: "previous", steps: [steps[3]!] }],
  };
  assert.deepEqual(expandWitnessCollection(compactWitnessCollection(source)), source);
  assert.deepEqual(compactWitnessCollection(source).witnesses[0]!.runs[0], [
    100,
    "Tick",
    "accepted",
    3,
    100,
  ]);
});

test("每步命令和检查点均独立，消费者修改不能污染字典或其他展开结果", () => {
  const input = example();
  const first = expandWitnessCollection(input);
  const second = expandWitnessCollection(input);
  assert.notEqual(first.witnesses[0]!.steps[0]!.command, first.witnesses[0]!.steps[1]!.command);
  assert.notEqual(
    first.witnesses[0]!.steps[3]!.checkpoint,
    second.witnesses[0]!.steps[3]!.checkpoint,
  );
  Object.assign(first.witnesses[0]!.steps[0]!.command, { kind: "Interact" });
  assert.deepEqual(second, expandWitnessCollection(input));
});

for (const [name, runs] of Object.entries({
  缺失字段: [[100, "Tick"]],
  额外字段: [[100, "Tick", "accepted", 1, 0, checkpoint, "ignored"]],
  未知命令: [[100, "missing", "accepted"]],
  原型命令: [[100, "toString", "accepted"]],
  缺失结果: [[100, "Tick", ""]],
  零次数: [[100, "Tick", "accepted", 0, 100]],
  小数次数: [[100, "Tick", "accepted", 1.5, 100]],
  过大展开: [[100, "Tick", "accepted", 20001, 100]],
  累计过大展开: [
    [100, "Tick", "accepted", 20000, 0],
    [100, "Tick", "accepted"],
  ],
  负时间: [[-1, "Tick", "accepted"]],
  小数时间: [[0.5, "Tick", "accepted"]],
  负间隔: [[100, "Tick", "accepted", 2, -1]],
  单步非法间隔: [[100, "Tick", "accepted", 1, 10]],
  时间溢出: [[Number.MAX_SAFE_INTEGER, "Tick", "accepted", 2, 1]],
  时间倒退: [
    [100, "Tick", "accepted", 3, 100],
    [200, "Tick", "accepted"],
  ],
  重复检查点: [[100, "Tick", "accepted", 2, 100, checkpoint]],
  无效检查点: [[100, "Tick", "accepted", 1, 0, {}]],
  空路线: [],
}))
  test(`紧凑见证拒绝${name}`, () => {
    assert.throws(() => expandWitnessCollection({ ...example(), witnesses: [{ runs }] }));
  });

test("格式版本与命令字典失效时立即拒绝", () => {
  assert.throws(() => expandWitnessCollection({ ...example(), encoding: "world-witness-runs-v2" }));
  assert.throws(() => expandWitnessCollection({ ...example(), commands: { Tick: null } }));
  assert.throws(() =>
    expandWitnessCollection({
      ...example(),
      witnesses: [{ steps: [], runs: example().witnesses[0]!.runs }],
    }),
  );
});

test("作者编码不能静默丢弃未知步骤字段或覆盖已有编码", () => {
  const step = { atMs: 100, command: { kind: "Tick" } as const, expectedCode: "accepted" };
  assert.throws(() =>
    compactWitnessCollection({ witnesses: [{ steps: [{ ...step, unexpected: "retain me" }] }] }),
  );
  assert.throws(() => compactWitnessCollection({ commands: {}, witnesses: [{ steps: [step] }] }));
  assert.throws(() => compactWitnessCollection({ witnesses: [{ runs: [], steps: [step] }] }));
});
