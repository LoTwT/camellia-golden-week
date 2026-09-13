import assert from "node:assert/strict";
import test from "node:test";
import {
  compactExpectationLists,
  expandExpectationLists,
} from "../src/content/witnesses/expectation-lists.ts";
import { expandWitnessCollection } from "../src/content/witnesses/compact.ts";
import {
  compactWitnessPrefixes,
  expandWitnessPrefixes,
} from "../src/content/witnesses/prefixes.ts";

const example = () => {
  const expected = {
    areaId: "hub",
    tileId: "hub.t.0.0",
    mode: "explore",
    supplyUnits: 6,
    aData: 0,
    completedObjectiveIds: ["second", "first"],
    absentObjectiveIds: ["missing-a", "missing-b"],
    claimedRewardIds: ["reward-a", "reward-b"],
  };
  return {
    encoding: "world-witness-runs-v1",
    commands: { Tick: { kind: "Tick" } },
    metadata: { completedObjectiveIds: 999 },
    witnesses: [
      {
        id: "route",
        expected: structuredClone(expected),
        runs: [
          [
            100,
            "Tick",
            "accepted",
            1,
            0,
            { id: "checkpoint", expected: structuredClone(expected) },
          ],
        ],
      },
    ],
    continuations: [
      {
        id: "continue",
        initialStateId: "saved",
        expected: structuredClone(expected),
        runs: [[200, "Tick", "accepted"]],
      },
    ],
  };
};

test("有序列表独立于其它元数据，路线、续玩和检查点完整还原", () => {
  const original = example();
  const encoded = compactExpectationLists(original);
  assert.deepEqual(encoded.expectationLists.completedObjectiveIds, [["second", "first"]]);
  assert.equal(encoded.witnesses[0]!.expected.completedObjectiveIds, 0);
  assert.equal(encoded.metadata.completedObjectiveIds, 999);
  const restored = expandExpectationLists(encoded);
  assert.deepEqual(restored, original);
  assert.equal(JSON.stringify(restored), JSON.stringify(original));
  assert.deepEqual(expandWitnessCollection(restored), expandWitnessCollection(original));
  assert.deepEqual(compactExpectationLists(original), encoded);
});

test("每次引用独立克隆，改动目标列表不能污染其他检查点、续玩或来源", () => {
  const input = compactExpectationLists(example());
  const first = expandWitnessCollection(expandExpectationLists(input));
  const second = expandWitnessCollection(expandExpectationLists(input));
  first.witnesses[0]!.expected.completedObjectiveIds.push("mutated");
  assert.deepEqual(first.witnesses[0]!.steps[0]!.checkpoint!.expected.completedObjectiveIds, [
    "second",
    "first",
  ]);
  assert.deepEqual(first.continuations[0]!.expected.completedObjectiveIds, ["second", "first"]);
  assert.deepEqual(expandWitnessCollection(expandExpectationLists(input)), second);
});

test("不排序、不跨语义字段共享，独有列表和短列表保留原表示", () => {
  const original = example();
  original.witnesses[0]!.expected.completedObjectiveIds = ["first", "second"];
  original.witnesses[0]!.expected.claimedRewardIds = ["second", "first"];
  original.continuations[0]!.expected.absentObjectiveIds = [];
  const encoded = compactExpectationLists(original);
  assert.deepEqual(encoded.witnesses[0]!.expected.completedObjectiveIds, ["first", "second"]);
  assert.deepEqual(encoded.witnesses[0]!.expected.claimedRewardIds, ["second", "first"]);
  assert.deepEqual(encoded.continuations[0]!.expected.absentObjectiveIds, []);
  assert.deepEqual(expandExpectationLists(encoded), original);
});

for (const [name, value] of Object.entries({
  负索引: -1,
  小数索引: 0.5,
  越界索引: 1,
  非有限索引: Infinity,
  字符串索引: "0",
  空引用: null,
  嵌套引用: { index: 0 },
  非字符串列表: [1],
}))
  test(`列表引用拒绝${name}`, () => {
    const encoded = compactExpectationLists(example());
    Object.assign(encoded.witnesses[0]!.expected, { completedObjectiveIds: value });
    assert.throws(() => expandExpectationLists(encoded));
  });

test("拒绝未知格式、缺失或损坏的列表池及重复作者编码", () => {
  const input = compactExpectationLists(example());
  assert.throws(() => expandExpectationLists(example()));
  assert.throws(() =>
    expandExpectationLists({
      ...input,
      expectationLists: { ...input.expectationLists, format: "unknown" },
    }),
  );
  assert.throws(() =>
    expandExpectationLists({
      ...input,
      expectationLists: { format: input.expectationLists.format },
    }),
  );
  assert.throws(() =>
    expandExpectationLists({
      ...input,
      expectationLists: { ...input.expectationLists, unexpected: [] },
    }),
  );
  assert.throws(() =>
    expandExpectationLists({
      ...input,
      expectationLists: { ...input.expectationLists, completedObjectiveIds: [1] },
    }),
  );
  assert.throws(() => compactExpectationLists(input));
  const authored = example();
  Object.assign(authored.witnesses[0]!.expected, { completedObjectiveIds: 0 });
  assert.throws(() => compactExpectationLists(authored));
});

test("列表先还原再展开路线前缀，保留被共享前缀中的检查点", () => {
  const { continuations: _continuations, ...source } = example();
  source.witnesses[0]!.runs = Array.from({ length: 9 }, (_, index) => [
    index * 100,
    "Tick",
    "accepted",
  ]);
  source.witnesses[0]!.runs[8] = [
    800,
    "Tick",
    "accepted",
    1,
    0,
    { id: "last", expected: source.witnesses[0]!.expected },
  ];
  source.witnesses.push({ ...structuredClone(source.witnesses[0]!), id: "same-prefix" });
  const encoded = compactExpectationLists(compactWitnessPrefixes(source));
  const result = expandWitnessCollection(expandWitnessPrefixes(expandExpectationLists(encoded)));
  assert.deepEqual(result, expandWitnessCollection(source));
  assert.equal(result.witnesses[1]!.steps[8]!.checkpoint!.id, "last");
});
