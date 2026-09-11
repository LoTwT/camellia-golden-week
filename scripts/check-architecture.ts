import { existsSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { API } from "typescript/unstable/sync";
import {
  isIdentifier,
  isStringLiteral,
  isImportExpression,
  isCallExpression,
} from "typescript/unstable/ast";
import type { Node } from "typescript/unstable/ast";

export interface ArchitectureResult {
  files: number;
  edges: { from: string; to: string }[];
  issues: string[];
}

/** Uses the pinned TypeScript 7 compiler AST, including type imports and re-exports. */
export function checkArchitecture(root = process.cwd()): ArchitectureResult {
  root = realpathSync(root);
  const api = new API({ cwd: root });
  const result: ArchitectureResult = { files: 0, edges: [], issues: [] };
  try {
    const config = resolve(root, "tsconfig.json");
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    const project = snapshot.getProject(config);
    if (!project) throw new Error(`无法载入工程：${config}`);
    const core = resolve(root, "src/core") + sep;
    const files = project.program.getSourceFileNames().filter((file) => file.startsWith(core));
    if (!files.length) throw new Error("核心规则层没有可检查的 TypeScript 文件。");
    result.files = files.length;
    for (const file of files) {
      const source = project.program.getSourceFile(file)!;
      const location = (node: Node) =>
        `${relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
      const dependency = (specifier: string, node: Node) => {
        const target = resolve(dirname(file), specifier);
        const resolved = existsSync(target) ? realpathSync(target) : target;
        result.edges.push({ from: relative(root, file), to: specifier });
        if (!specifier.startsWith(".") || !resolved.startsWith(core) || !existsSync(resolved))
          result.issues.push(`${location(node)} 核心规则层只能引用 core 内文件：${specifier}`);
      };
      for (const specifier of source.imports) {
        if (isStringLiteral(specifier)) dependency(specifier.text, specifier);
      }
      for (const reference of source.referencedFiles) dependency(reference.fileName, source);
      if (source.typeReferenceDirectives.length || source.libReferenceDirectives.length)
        result.issues.push(`${relative(root, file)} 核心规则层不能引入环境类型指令。`);
      const identifiers: Node[] = [];
      const visit = (node: Node): void => {
        if (isIdentifier(node)) identifiers.push(node);
        if (
          isCallExpression(node) &&
          isImportExpression(node.expression) &&
          (!node.arguments[0] || !isStringLiteral(node.arguments[0]))
        )
          result.issues.push(`${location(node)} 核心规则层不能使用动态模块路径。`);
        node.forEachChild(visit);
      };
      visit(source);
      const symbols = project.checker.getSymbolAtLocation(identifiers);
      symbols.forEach((symbol, index) => {
        const node = identifiers[index]!;
        if (!symbol || !isIdentifier(node) || node.text === "structuredClone") return;
        if (
          node.text === "globalThis" ||
          symbol.declarations.some((declaration) =>
            /(?:lib\.(?:dom|webworker)[^/]*\.d\.ts|[/\\]@types[/\\]node[/\\]|[/\\]undici-types[/\\])/.test(
              declaration.path,
            ),
          )
        )
          result.issues.push(`${location(node)} 核心规则层不能依赖环境 API：${node.text}`);
      });
    }
    result.issues = [...new Set(result.issues)];
    return result;
  } finally {
    api.close();
  }
}

if (import.meta.main) {
  try {
    const result = checkArchitecture();
    if (result.issues.length) throw new Error(result.issues.join("\n"));
    console.log(`架构校验通过：${result.files} 个核心模块，${result.edges.length} 条依赖。`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
