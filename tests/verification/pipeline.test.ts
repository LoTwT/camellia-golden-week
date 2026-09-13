import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { discoverTests } from "../../scripts/run-tests.ts";
import { profileForMode } from "../../scripts/build-profile.ts";
import { checkArchitecture } from "../../scripts/check-architecture.ts";

test("测试入口递归发现子目录失败用例并传播非零退出；空目录不能通过", async () => {
  const directory = await mkdtemp(join(tmpdir(), "camellia-test-discovery-"));
  try {
    const runner = resolve("scripts/run-tests.ts");
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const empty = spawnSync(process.execPath, [runner, directory], { encoding: "utf8", env });
    assert.equal(empty.status, 1);
    assert.match(empty.stderr, /没有发现测试文件/);
    await mkdir(join(directory, "nested"));
    const file = join(directory, "nested/failure.test.ts");
    await writeFile(
      file,
      'import test from "node:test"; test("nested deliberate failure", () => { throw new Error("nested test executed"); });',
    );
    await writeFile(join(directory, "helper.ts"), "throw new Error('not a test');");
    assert.deepEqual(await discoverTests(directory), [file]);
    const failed = spawnSync(process.execPath, [runner, directory], { encoding: "utf8", env });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /nested test executed/);
    await writeFile(file, 'import test from "node:test"; test("nested success", () => {});');
    assert.equal(spawnSync(process.execPath, [runner, directory], { env }).status, 0);
    await writeFile(file, "export {};");
    const noCases = spawnSync(process.execPath, [runner, directory], { encoding: "utf8", env });
    assert.equal(noCases.status, 1);
    assert.match(noCases.stderr, /没有执行任何已注册/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("构建模式保持开发 / 生产 / 验收与五个分期；未知分期明确失败", () => {
  for (const mode of ["development", "production", "acceptance", "m5", "M5"])
    assert.equal(profileForMode(mode), "M5");
  for (const stage of [1, 2, 3, 4]) assert.equal(profileForMode(`m${stage}`), `M${stage}`);
  for (const mode of ["m0", "m6", "m10", "bogus", "", "production-m1"])
    assert.throws(() => profileForMode(mode), /未知构建模式/);
});

test("真实编译器依赖图拒绝核心反向引用、外部包和浏览器 API，保留同名局部字段", async () => {
  const directory = await mkdtemp(join(tmpdir(), "camellia-architecture-"));
  try {
    await mkdir(join(directory, "src/core"), { recursive: true });
    await mkdir(join(directory, "src/platform"));
    await writeFile(
      join(directory, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { target: "ES2023", module: "ESNext", types: [], lib: ["ES2023", "DOM"] },
        include: ["src"],
      }),
    );
    await writeFile(join(directory, "src/core/value.ts"), "export const value = 1;");
    await writeFile(join(directory, "src/platform/value.ts"), "export const value = 2;");
    const file = join(directory, "src/core/rules.ts");
    await writeFile(
      file,
      'import { value } from "./value.ts"; export const result = structuredClone({ value, window: 1 });',
    );
    const valid = checkArchitecture(directory);
    assert.deepEqual(valid.issues, []);
    assert.equal(valid.edges.length, 1);
    await writeFile(
      file,
      'export { value } from "../platform/value.ts"; import type { Object3D } from "three"; export const result = window.localStorage.getItem("a"); void import("../platform/value.ts");',
    );
    const invalid = checkArchitecture(directory);
    assert.ok(invalid.issues.some((issue) => issue.includes("../platform/value.ts")));
    assert.ok(invalid.issues.some((issue) => issue.includes("three")));
    assert.ok(invalid.issues.some((issue) => issue.includes("环境 API：window")));
    await writeFile(file, 'const path = "../platform/value.ts"; void import(path);');
    assert.ok(checkArchitecture(directory).issues.some((issue) => issue.includes("动态模块路径")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
