import assert from "node:assert/strict";
import test from "node:test";
import { assembleContent, worldCatalog } from "../src/content/assemble.ts";
import { validateContent } from "../src/content/validate.ts";
import aSource from "../src/content/areas/a.json" with { type: "json" };
import dSource from "../src/content/areas/d.json" with { type: "json" };
import revisitSource from "../src/content/areas/revisits.json" with { type: "json" };
import staticSource from "../src/content/challenges/static.json" with { type: "json" };
import type { ProfileId } from "../src/core/types.ts";

function withSourceChange<T extends object>(
  source: T,
  change: (source: T) => void,
  verify: () => void,
): void {
  const original = structuredClone(source);
  try {
    change(source);
    verify();
  } finally {
    restoreSource(source, original);
  }
}

function restoreSource(target: object, original: object): void {
  const current = target as Record<string, unknown>;
  const saved = original as Record<string, unknown>;
  for (const key of Object.keys(current)) if (!Object.hasOwn(saved, key)) delete current[key];
  for (const [key, value] of Object.entries(saved)) {
    const existing = current[key];
    if (existing && value && typeof existing === "object" && typeof value === "object")
      restoreSource(existing, value);
    else current[key] = structuredClone(value);
  }
  if (Array.isArray(target) && Array.isArray(original)) target.length = original.length;
}

test("装配前拒绝不存在的实体格，即使其所属区域尚未收录", () => {
  withSourceChange(
    dSource,
    (source) => {
      source.entities[0]!.tileId = "d.t.missing";
    },
    () => assert.throws(() => assembleContent("M1"), /d\.t\.missing/),
  );
});

test("回访合并前检查 A 首访 tileIds，不能用派生集合掩盖孤儿格", () => {
  withSourceChange(
    aSource,
    (source) => {
      source.area.tileIds = source.area.tileIds.filter((id) => id !== "a.t.0.0");
    },
    () => assert.throws(() => assembleContent("M1"), /tileIds.*a\.t\.0\.0/),
  );
});

for (const membership of ["entityIds", "roomIds"] as const) {
  test(`装配前拒绝错误的区域 ${membership}，不静默重建`, () => {
    withSourceChange(
      aSource,
      (source) => {
        source.area[membership].push("a.missing");
      },
      () => assert.throws(() => assembleContent("M1"), new RegExp(`${membership}.*a\\.missing`)),
    );
  });
}

test("装配前拒绝跨区实体归属", () => {
  withSourceChange(
    dSource,
    (source) => {
      source.entities[0]!.tileId = "a.t.0.0";
    },
    () => assert.throws(() => assembleContent("M1"), /d\.teleport\.point.*a\.t\.0\.0/),
  );
});

test("装配前拒绝基础地图与回访扩展之间的重复 ID", () => {
  withSourceChange(
    revisitSource,
    (source) => {
      source.areas[0]!.tiles[0]!.id = "a.t.0.0";
    },
    () => assert.throws(() => assembleContent("M1"), /a\.t\.0\.0.*重复 ID/),
  );
});

test("装配前拒绝未找到父区域的回访扩展", () => {
  withSourceChange(
    revisitSource,
    (source) => {
      source.areas[0]!.areaId = "missing";
    },
    () => assert.throws(() => assembleContent("M1"), /missing.*未解析区域/),
  );
});

test("装配前拒绝重复区域扩展，不能只读取第一份", () => {
  withSourceChange(
    revisitSource,
    (source) => {
      source.areas.push(structuredClone(source.areas[0]!));
    },
    () => assert.throws(() => assembleContent("M1"), /revisits.*重复区域/),
  );
});

test("原始 profile 的房间清单不能被实际房间覆盖后假称闭合", () => {
  const profile = worldCatalog.releaseProfiles.find((profile) => profile.id === "M1")!;
  withSourceChange(
    profile,
    (source) => {
      source.includedRoomIds = source.includedRoomIds.filter((id) => id !== "a.maze.01");
    },
    () => assert.throws(() => assembleContent("M1"), /M1.*includedRoomIds.*a\.maze\.01/),
  );
});

test("装配前拒绝越过 M5 的收录阶段，不能把非法内容裁掉", () => {
  withSourceChange(
    dSource,
    (source) => {
      source.entities[0]!.includedFrom = 6;
    },
    () => assert.throws(() => assembleContent("M1"), /d\.teleport\.point.*includedFrom/),
  );
});

test("装配前拒绝未使用的效应和未注册的挑战，不能由引用过滤掩盖", () => {
  withSourceChange(
    worldCatalog,
    (source) => {
      source.effects.push({
        ...structuredClone(source.effects[0]!),
        id: "orphan.effects",
      });
    },
    () => assert.throws(() => assembleContent("M1"), /orphan\.effects.*孤儿效应/),
  );
  withSourceChange(
    staticSource,
    (source) => {
      source.definitions.push({
        ...structuredClone(source.definitions[0]!),
        id: "orphan.room",
      });
    },
    () => assert.throws(() => assembleContent("M1"), /orphan\.room.*孤儿挑战/),
  );
});

test("合法的未来地图和回访仍按 M1–M5 裁剪，装配只读", () => {
  const before = JSON.stringify([aSource, dSource, revisitSource, worldCatalog]);
  for (const profile of ["M1", "M2", "M3", "M4", "M5"] as ProfileId[]) {
    const content = assembleContent(profile);
    assert.deepEqual(validateContent(content), [], profile);
    assert.equal(
      content.entities.some((entity) => entity.id === "a.revisit.door"),
      ["M4", "M5"].includes(profile),
    );
    assert.equal(
      content.entities.some((entity) => entity.id === "hub.to.warehouse.unavailable"),
      ["M1", "M2", "M3"].includes(profile),
    );
  }
  assert.equal(JSON.stringify([aSource, dSource, revisitSource, worldCatalog]), before);
  const m4 = assembleContent("M4");
  const m5 = assembleContent("M5");
  assert.deepEqual(m4.tiles, m5.tiles);
  assert.deepEqual(m4.entities, m5.entities);
  assert.deepEqual(m4.rewards, m5.rewards);
});
