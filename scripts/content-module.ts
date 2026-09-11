/** Shares equal immutable content subtrees across historical release views. */
export function contentModuleSource(releases: readonly unknown[]): string {
  if (!releases.length) throw new Error("内容模块至少包含一个发布视图。");
  const counts = new Map<string, number>();
  const serialized = new WeakMap<object, string>();
  const visit = (value: unknown) => {
    if (value === null || typeof value !== "object") return;
    const raw = JSON.stringify(value);
    serialized.set(value, raw);
    if (raw.length >= 64) counts.set(raw, (counts.get(raw) ?? 0) + 1);
    for (const child of Object.values(value)) visit(child);
  };
  releases.forEach(visit);
  const declarations: string[] = [];
  const references = new Map<string, string>();
  const literal = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(emit).join(",")}]`;
    if (value !== null && typeof value === "object")
      return `{${Object.entries(value)
        .map(([key, child]) => `${JSON.stringify(key)}:${emit(child)}`)
        .join(",")}}`;
    return JSON.stringify(value);
  };
  const emit = (value: unknown): string => {
    if (value === null || typeof value !== "object") return literal(value);
    const raw = serialized.get(value)!;
    if ((counts.get(raw) ?? 0) < 2) return literal(value);
    const existing = references.get(raw);
    if (existing) return existing;
    const expression = literal(value);
    const name = `contentPart${declarations.length}`;
    declarations.push(`const ${name}=${expression};`);
    references.set(raw, name);
    return name;
  };
  const expressions = releases.map(emit);
  return `${declarations.join("\n")}\nexport const migrationReleases=[${expressions.join(",")}];\nexport default migrationReleases[migrationReleases.length-1];`;
}
