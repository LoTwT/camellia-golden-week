import assert from "node:assert/strict";
import test from "node:test";
import { expandWitnessCollection } from "../src/content/witnesses/compact.ts";
import {
  compactWitnessPrefixes,
  expandWitnessPrefixes,
} from "../src/content/witnesses/prefixes.ts";

const example = () => ({
  encoding: "world-witness-prefixes-v1",
  commands: { Tick: { kind: "Tick" } },
  authoredFrom: "independent prefix example",
  witnesses: [
    { id: "first", runs: [[100, "Tick", "accepted", 3, 100]] },
    {
      id: "second",
      expected: { supplyUnits: 6 },
      prefix: { witnessId: "first", runCount: 1 },
      runs: [[500, "Tick", "blocked"]],
    },
    { id: "third", prefix: { witnessId: "second", runCount: 2 }, runs: [] },
  ],
});
const expand = (source: ReturnType<typeof example>) =>
  expandWitnessCollection(expandWitnessPrefixes(source));

test("前缀按 run 数量展开，保留每步绝对时间、独立期望与完整路线引用", () => {
  const result = expand(example());
  const first = [100, 200, 300].map((atMs) => ({
    atMs,
    command: { kind: "Tick" },
    expectedCode: "accepted",
  }));
  const second = [...first, { atMs: 500, command: { kind: "Tick" }, expectedCode: "blocked" }];
  assert.deepEqual(result, {
    authoredFrom: "independent prefix example",
    witnesses: [
      { id: "first", steps: first },
      { id: "second", expected: { supplyUnits: 6 }, steps: second },
      { id: "third", steps: second },
    ],
  });
});

test("共享前缀的命令与检查点修改不能污染来源、另一条路线或下一次展开", () => {
  const input = example();
  const checkpoint = { id: "checkpoint", expected: { supplyUnits: 6 } };
  Object.assign(input.witnesses[0]!, { runs: [[100, "Tick", "accepted", 1, 0, checkpoint]] });
  const flat = expandWitnessPrefixes(input);
  Object.assign(flat.witnesses[0]!.runs[0] as unknown[], { 2: "changed" });
  assert.equal(flat.witnesses[1]!.runs[0]![2], "accepted");
  const result = expand(input);
  Object.assign(result.witnesses[0]!.steps[0]!.command, { kind: "Interact" });
  Object.assign(result.witnesses[0]!.steps[0]!.checkpoint!.expected, { supplyUnits: 99 });
  assert.deepEqual(result.witnesses[1]!.steps[0], expand(input).witnesses[1]!.steps[0]);
  assert.equal(checkpoint.expected.supplyUnits, 6);
});

for (const [name, prefix] of Object.entries({
  未知路线: { witnessId: "missing", runCount: 1 },
  自身引用: { witnessId: "second", runCount: 1 },
  向后引用: { witnessId: "third", runCount: 1 },
  越界引用: { witnessId: "first", runCount: 2 },
  零长度: { witnessId: "first", runCount: 0 },
  小数长度: { witnessId: "first", runCount: 0.5 },
  缺少长度: { witnessId: "first" },
  多余字段: { witnessId: "first", runCount: 1, timeOffset: 100 },
  空引用: null,
}))
  test(`拒绝${name}，不会静默替换或截短路线`, () => {
    const input = example();
    Object.assign(input.witnesses[1]!, { prefix });
    assert.throws(() => expand(input));
  });

test("拒绝重复路线 ID、未知编码和不支持的续玩集合", () => {
  const input = example();
  input.witnesses[1]!.id = "first";
  assert.throws(() => expand(input));
  assert.throws(() => expand({ ...example(), encoding: "unknown" }));
  assert.throws(() => expand(Object.assign(example(), { continuations: [] })));
});

test("前缀与后续步骤共同遵守时间顺序和每条路线两万步上限", () => {
  const backward = example();
  backward.witnesses[1]!.runs = [[200, "Tick", "accepted"]];
  assert.throws(() => expand(backward));
  const oversized = example();
  oversized.witnesses[0]!.runs = [[100, "Tick", "accepted", 20000, 0]];
  assert.throws(() => expand(oversized));
  const tooManyRuns = example();
  tooManyRuns.witnesses[1]!.runs = Array.from({ length: 20000 }, () => [500, "Tick", "accepted"]);
  assert.throws(() => expand(tooManyRuns));
});

test("作者编码保留元数据，只引用至少八条完全一致的前缀", () => {
  const runs = Array.from({ length: 9 }, (_, index) => [index * 100, "Tick", "accepted"]);
  const source = {
    encoding: "world-witness-runs-v1",
    commands: { Tick: { kind: "Tick" } },
    witnesses: [
      { id: "first", runs, description: "original" },
      { id: "second", runs: [...runs, [1000, "Tick", "blocked"]], description: "longer" },
      { id: "short", runs: runs.slice(0, 7), description: "keep readable" },
    ],
  };
  const compact = compactWitnessPrefixes(source);
  assert.deepEqual(compact.witnesses[1]!.prefix, { witnessId: "first", runCount: 9 });
  assert.equal(compact.witnesses[2]!.prefix, undefined);
  assert.deepEqual(
    expandWitnessCollection(expandWitnessPrefixes(compact)),
    expandWitnessCollection(source),
  );
  assert.throws(() => compactWitnessPrefixes(compact));
  assert.throws(() => compactWitnessPrefixes(Object.assign(source, { continuations: [] })));
});
