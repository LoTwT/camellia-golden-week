import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { worldCatalog } from "../src/content/assemble.ts";
import { worldWitnesses } from "../src/content/witnesses/index.ts";
import { validateWorldWitnessInventory } from "../src/content/validate.ts";
import type { WorldWitness } from "../src/content/validate.ts";
import type { ProfileId } from "../src/core/types.ts";

test("世界见证清单要求每个已发布 profile 的主路径和全收集，可另加合法路线", () => {
  for (const profile of ["M1", "M2", "M3", "M4", "M5"] as ProfileId[]) {
    const included = worldWitnesses.filter(
      (witness) => Number(witness.profileId.slice(1)) <= Number(profile.slice(1)),
    );
    assert.deepEqual(validateWorldWitnessInventory(included, worldCatalog, profile), []);
    const missing = included.filter((witness) => witness.profileId !== profile);
    assert.ok(
      validateWorldWitnessInventory(missing, worldCatalog, profile).some(
        (issue) => issue.path.startsWith(profile.toLowerCase()) && issue.message.includes("缺少"),
      ),
    );
  }
  assert.deepEqual(
    validateWorldWitnessInventory(
      [...worldWitnesses, { ...worldWitnesses[0]!, id: "m1.world.alternative-main-path" }],
      worldCatalog,
      "M5",
    ),
    [],
  );
});

test("见证清单拒绝重复 ID、错误版本和 profile", () => {
  for (const changed of [
    [...worldWitnesses, worldWitnesses[0]!],
    worldWitnesses.map((witness) =>
      witness.profileId === "M5" ? { ...witness, profileId: "M4" } : witness,
    ),
    worldWitnesses.map((witness) =>
      witness.profileId === "M5" ? { ...witness, contentVersion: 5 } : witness,
    ),
  ])
    assert.ok(validateWorldWitnessInventory(changed, worldCatalog, "M5").length > 0);
});

test("见证范围不能弱化本版终点、全奖励、数据或无计分挑战通关断言", () => {
  const fullId = "m5.world.full-collection-and-return";
  const mainId = "m5.world.main-path-without-scored-challenges";
  const cases: [string, (witness: WorldWitness) => WorldWitness, RegExp][] = [
    [
      fullId,
      (witness) => ({
        ...witness,
        expected: {
          ...witness.expected,
          completedObjectiveIds: witness.expected.completedObjectiveIds.filter(
            (id) => id !== "warehouse.complete",
          ),
        },
      }),
      /本版终点/,
    ],
    [
      fullId,
      (witness) => ({
        ...witness,
        expected: {
          ...witness.expected,
          claimedRewardIds: witness.expected.claimedRewardIds.slice(1),
        },
      }),
      /完整奖励集合/,
    ],
    [
      fullId,
      (witness) => ({ ...witness, expected: { ...witness.expected, supplyUnits: 129 } }),
      /130/,
    ],
    [
      fullId,
      (witness) => ({
        ...witness,
        expected: {
          ...witness.expected,
          completedObjectiveIds: witness.expected.completedObjectiveIds.filter(
            (id) => id !== "d.hidden.terminal",
          ),
        },
      }),
      /数据目标 d\.hidden\.terminal/,
    ],
    [
      mainId,
      (witness) => ({ ...witness, expected: { ...witness.expected, absentObjectiveIds: [] } }),
      /未完成断言/,
    ],
    [
      mainId,
      (witness) => ({
        ...witness,
        expected: {
          ...witness.expected,
          completedObjectiveIds: [...witness.expected.completedObjectiveIds, "b.antivirus.heavy"],
        },
      }),
      /不能依赖计分挑战/,
    ],
  ];
  for (const [id, change, expectedMessage] of cases) {
    const changed = worldWitnesses.map((witness) =>
      witness.id === id ? change(witness) : witness,
    );
    const issues = validateWorldWitnessInventory(changed, worldCatalog, "M5");
    assert.ok(
      issues.some((issue) => issue.path === id && expectedMessage.test(issue.message)),
      JSON.stringify(issues),
    );
  }
});

test("真实内容校验入口拒绝 M5 见证被清空，M1–M4 通过不能代替 M5", () => {
  const directory = mkdtempSync(join(tmpdir(), "camellia-witness-inventory-"));
  const root = new URL("../", import.meta.url);
  try {
    for (const path of ["src", "scripts", "package.json"])
      cpSync(new URL(path, root), join(directory, path), { recursive: true });
    for (const source of worldCatalog.sources) {
      if (/^https?:\/\//.test(source.urlOrPath)) continue;
      const destination = join(directory, source.urlOrPath);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, readFileSync(new URL(source.urlOrPath, root)));
    }
    const run = () =>
      spawnSync(process.execPath, ["scripts/validate-content.ts"], {
        cwd: directory,
        encoding: "utf8",
        timeout: 20_000,
      });
    const baseline = run();
    assert.equal(baseline.status, 0, baseline.stderr);
    assert.match(baseline.stdout, /m5\.world\.full-collection-and-return/);
    writeFileSync(
      join(directory, "src/content/witnesses/m5.ts"),
      "export const m5WorldWitnesses = [];\n",
    );
    const missing = run();
    assert.notEqual(missing.status, 0, "删除 M5 世界见证后内容校验必须失败");
    assert.match(missing.stderr, /m5\.world\..*缺少/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
