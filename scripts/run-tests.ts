import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { run } from "node:test";
import { spec } from "node:test/reporters";

export async function discoverTests(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await discoverTests(path)));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) files.push(path);
  }
  return files.sort();
}

export async function runTests(directory: string): Promise<boolean> {
  const files = await discoverTests(directory);
  if (!files.length) throw new Error(`没有发现测试文件：${directory}`);
  console.log(`Node 原生测试：递归发现 ${files.length} 个测试文件。`);
  const stream = run({ files });
  let passed = false;
  let executedTests = 0;
  stream.on("test:pass", (result) => {
    // Node reports an empty file itself as a passing test; it is not a registered case.
    if (
      result.details.type === "test" &&
      result.name !== result.file &&
      !result.skip &&
      !result.todo
    )
      executedTests += 1;
  });
  stream.on("test:summary", (summary) => {
    passed = summary.success && summary.counts.tests > 0;
  });
  for await (const output of stream.compose(spec)) process.stdout.write(output);
  if (!executedTests) console.error("没有执行任何已注册的测试用例。");
  return passed && executedTests > 0;
}

if (import.meta.main) {
  try {
    if (!(await runTests(resolve(process.argv[2] ?? "tests")))) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
