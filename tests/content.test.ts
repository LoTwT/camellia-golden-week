import assert from "node:assert/strict";
import test from "node:test";
import { AVAILABLE_PROFILE, assembleContent, worldCatalog } from "../src/content/assemble.ts";
import {
  assertContent,
  validateCatalog,
  validateContent,
  validateWorldWitness,
} from "../src/content/validate.ts";
import type { GameContent, ProfileId } from "../src/core/types.ts";
import m1Witnesses from "../src/content/witnesses/m1.json" with { type: "json" };

function altered(change: (content: GameContent) => void): GameContent {
  const content = structuredClone(assembleContent("M1"));
  change(content);
  return content;
}
function rejected(content: unknown, text: string): void {
  const issues = validateContent(content);
  assert.ok(issues.length > 0);
  assert.ok(
    issues.some((issue) => `${issue.path} ${issue.message}`.includes(text)),
    JSON.stringify(issues),
  );
}

test("目录账本保留 26 个唯一奖励、130 单位和五个 profile 的准确分母", () => {
  assert.deepEqual(validateCatalog(worldCatalog), []);
  assert.equal(worldCatalog.rewards.length, 26);
  assert.equal(new Set(worldCatalog.rewards.map((reward) => reward.id)).size, 26);
  assert.deepEqual(
    worldCatalog.releaseProfiles.map((profile) =>
      worldCatalog.rewards
        .filter((reward) => profile.includedRewardIds.includes(reward.id))
        .reduce((sum, reward) => sum + reward.units, 0),
    ),
    [26, 51, 81, 130, 130],
  );
  assert.equal(worldCatalog.dataNodes.length, 20);
  for (const area of ["a", "b", "c", "d"])
    assert.equal(
      worldCatalog.dataNodes
        .filter((node) => node.areaId === area)
        .reduce((sum, node) => sum + node.weight, 0),
      100,
    );
});

test("M1 已加载结构、所有实体 / 房间 / 来源 / 效应引用闭合", () => {
  const content = assembleContent("M1");
  const before = JSON.stringify(content);
  assertContent(content);
  assert.deepEqual(validateContent(content), []);
  assert.equal(JSON.stringify(content), before);
  assert.deepEqual(content.areaIds, ["hub", "a"]);
  assert.equal(content.rooms.length, 7);
  assert.equal(content.staticChallenges.length, 3);
  assert.equal(content.realtimeChallenges.length, 4);
  assert.equal(content.rewards.length, 6);
  assert.equal(content.dataNodes.length, 4);
  assert.equal(
    content.gates.some((gate) => gate.id === "gate.warehouse"),
    false,
  );
  assert.equal(
    content.entities.some(
      (entity) =>
        entity.kind === "teleport" && ["b", "warehouse"].includes(entity.params.destinationAreaId),
    ),
    false,
  );
});

test("未实际收录的未来世界不能只凭完整目录声明为通过", () => {
  const available = Number(AVAILABLE_PROFILE.slice(1));
  for (const profileId of ["M2", "M3", "M4", "M5"] as ProfileId[]) {
    if (Math.min(Number(profileId.slice(1)), 4) <= Math.min(available, 4)) continue;
    const issues = validateContent(assembleContent(profileId));
    assert.ok(issues.length > 0, `${profileId} missing maps must be rejected`);
  }
});

test("目录拒绝奖励改名、重复生产者、错误数量和重复数据事件", () => {
  for (const mutate of [
    (catalog: typeof worldCatalog) => {
      catalog.rewards[0]!.units = 2;
    },
    (catalog: typeof worldCatalog) => {
      catalog.rewards[0]!.id = "hub.supply.renamed";
    },
    (catalog: typeof worldCatalog) => {
      catalog.rewards[1]!.producerId = catalog.rewards[0]!.producerId;
    },
    (catalog: typeof worldCatalog) => {
      catalog.dataNodes[1]!.completionObjectiveId = catalog.dataNodes[0]!.completionObjectiveId;
    },
    (catalog: typeof worldCatalog) => {
      catalog.dataNodes[0]!.weight = 10;
    },
  ]) {
    const catalog = structuredClone(worldCatalog);
    mutate(catalog);
    assert.ok(validateCatalog(catalog).length > 0);
  }
});

test("目录拒绝目标环、主路径读取可选挑战和错误回访依赖", () => {
  for (const [objectiveId, dependency] of [
    ["hub.amplifier", "hub.tutorial"],
    ["a.main", "a.firewall.core"],
    ["c.main", "c.theft.03"],
    ["a.revisit.terminal", "warehouse.complete"],
  ]) {
    const catalog = structuredClone(worldCatalog);
    const objective = catalog.objectives.find((objective) => objective.id === objectiveId);
    assert.ok(objective && dependency);
    objective.prerequisites = { kind: "objective", objectiveId: dependency };
    assert.ok(validateCatalog(catalog).length > 0);
  }
});

test("schema 拒绝未知 kind、脚本条件和数组伪装布尔 / 枚举", () => {
  rejected(
    altered((content) => {
      content.entities[0]!.kind = "script" as never;
    }),
    "未知实体 kind",
  );
  rejected(
    altered((content) => {
      content.gates[0]!.condition = { kind: "eval", source: "unsafe()" } as never;
    }),
    "未知 gate kind",
  );
  rejected(
    altered((content) => {
      content.profile.fullCampaign = [false] as never;
    }),
    "布尔值",
  );
  rejected(
    altered((content) => {
      content.tiles[0]!.terrain = ["floor"] as never;
    }),
    "非法地形",
  );
  rejected(
    altered((content) => {
      content.objectives[0]!.kind = "script" as never;
    }),
    "kind",
  );
  rejected(
    altered((content) => {
      content.staticChallenges[0] = { ...content.staticChallenges[0]!, kind: "script" } as never;
    }),
    "未知静态谜题类型",
  );
});

test("地图拒绝重复 ID / 坐标、非有限坐标、孤立的主终端", () => {
  rejected(
    altered((content) => {
      content.tiles.push(structuredClone(content.tiles[0]!));
    }),
    "重复 ID",
  );
  rejected(
    altered((content) => {
      content.tiles[1]!.x = content.tiles[0]!.x;
      content.tiles[1]!.y = content.tiles[0]!.y;
    }),
    "坐标重复",
  );
  rejected(
    altered((content) => {
      content.tiles[0]!.x = Number.POSITIVE_INFINITY;
    }),
    "安全整数",
  );
  rejected(
    altered((content) => {
      content.tiles.find((tile) => tile.id === "a.t.7.0")!.x = 100;
    }),
    "不可达",
  );
});

test("引用校验拒绝未知门 / 物资格、失配生产者和效应包", () => {
  rejected(
    altered((content) => {
      content.entities[0]!.gateId = "gate.missing";
    }),
    "未解析引用",
  );
  rejected(
    altered((content) => {
      content.entities = content.entities.filter(
        (entity) => entity.id !== "a.supply.maze01.pickup",
      );
      content.areas.find((area) => area.id === "a")!.entityIds = content.areas
        .find((area) => area.id === "a")!
        .entityIds.filter((id) => id !== "a.supply.maze01.pickup");
    }),
    "没有且仅有一个",
  );
  rejected(
    altered((content) => {
      const objective = content.catalogObjectives.find((value) => value.id === "hub.amplifier")!;
      objective.producer = "hub.wrong";
      content.objectives.find((value) => value.id === objective.id)!.producer = objective.producer;
    }),
    "实际生产者",
  );
  rejected(
    altered((content) => {
      content.rooms[0]!.effectBundleId = "effect.missing";
    }),
    "未解析引用",
  );
  rejected(
    altered((content) => {
      content.rooms[3]!.boardId = "wrong.board";
    }),
    "棋盘",
  );
  rejected(
    altered((content) => {
      content.rooms[3]!.witnessIds = ["wrong.witness"];
    }),
    "见证 ID",
  );
});

test("安全恢复拒绝房间出口覆盖、传送入自动房间及反向自跳", () => {
  rejected(
    altered((content) => {
      content.rooms[0]!.returnTileId = "a.t.2.0";
    }),
    "恢复锚点",
  );
  rejected(
    altered((content) => {
      const portal = content.entities.find((entity) => entity.id === "hub.to.a")!;
      if (portal.kind === "teleport") portal.params.destinationTileId = "a.t.4.0";
    }),
    "自动进入",
  );
  rejected(
    altered((content) => {
      const portal = content.entities.find((entity) => entity.id === "a.to.hub")!;
      if (portal.kind === "teleport") {
        portal.params.destinationAreaId = "a";
        portal.params.destinationTileId = portal.tileId;
      }
    }),
    "落回自身",
  );
  rejected(
    altered((content) => {
      content.tiles.find((tile) => tile.id === "a.t.0.0")!.etherGroupId = "ether.unreachable";
    }),
    "传送落点",
  );
});

test("主路径和未收录展示不能携带全数据门、未来坐标或执行效应", () => {
  rejected(
    altered((content) => {
      content.gates[0]!.condition = { kind: "areaDataComplete", areaId: "a" };
    }),
    "只允许中央仓库",
  );
  rejected(
    altered((content) => {
      content.tiles[0]!.includedFrom = 4;
    }),
    "未来地图坐标",
  );
  rejected(
    altered((content) => {
      content.entities.find((entity) => entity.kind === "unavailable")!.effectBundleId =
        "hub.amplifier.effects";
    }),
    "未收录展示",
  );
  rejected(
    altered((content) => {
      content.profile.fullCampaign = true;
    }),
    "违反阶段合同",
  );
});

test("固定世界见证只允许公开命令，不接受进度或坐标注入", () => {
  for (const witness of m1Witnesses.witnesses) assert.deepEqual(validateWorldWitness(witness), []);
  const witness = m1Witnesses.witnesses[0]!;
  const first = witness.steps[0]!;
  assert.ok(
    validateWorldWitness({
      ...witness,
      steps: [{ ...first, command: { kind: "SetPosition", tileId: "a.t.7.0" } }],
    }).length > 0,
  );
  assert.ok(
    validateWorldWitness({
      ...witness,
      steps: [
        {
          ...first,
          command: { kind: "Move", direction: "right", completedObjectiveIds: ["a.main"] },
        },
      ],
    }).length > 0,
  );
  assert.ok(
    validateWorldWitness({ ...witness, steps: [{ ...first, atMs: Number.NaN }] }).length > 0,
  );
  assert.ok(
    validateWorldWitness({
      ...witness,
      steps: [
        { ...first, atMs: 10 },
        { ...first, atMs: 9 },
      ],
    }).length > 0,
  );
});
