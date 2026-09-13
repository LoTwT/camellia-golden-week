/** Compare JSON data by object keys and ordered array values, independent of serialization order. */
export function sameJsonValue(left: unknown, right: unknown): boolean {
  const pending: [unknown, unknown][] = [[left, right]];
  const compared = new WeakMap<object, WeakSet<object>>();
  while (pending.length) {
    const pair = pending.pop();
    if (!pair) break;
    const [a, b] = pair;
    if (a === b) continue;
    if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
    const previous = compared.get(a);
    if (previous?.has(b)) continue;
    if (previous) previous.add(b);
    else compared.set(a, new WeakSet([b]));
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let index = 0; index < a.length; index += 1) pending.push([a[index], b[index]]);
    } else {
      const aRecord = a as Record<string, unknown>;
      const bRecord = b as Record<string, unknown>;
      const keys = Object.keys(aRecord);
      if (keys.length !== Object.keys(bRecord).length) return false;
      for (const key of keys) {
        if (!Object.hasOwn(bRecord, key)) return false;
        pending.push([aRecord[key], bRecord[key]]);
      }
    }
  }
  return true;
}
