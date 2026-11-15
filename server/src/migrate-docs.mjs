// fmt is metadata, separate from both document content and the optimistic write counter.
// Each type owns its history: index 0 is the pure v1 -> v2 transformer.
export const documentMigrations = Object.freeze(Object.fromEntries(
  ['day', 'week', 'month', 'quarter', 'year', 'settings', 'inbox', 'boards', 'team'].map(type => [type, Object.freeze([])]),
));
export function upgradeDocument(key, value, fmt = 1, registry = documentMigrations) {
  const type = key.split(':')[0];
  const steps = registry[type];
  if (!steps) throw new Error(`Unknown document type: ${type}`);
  const current = steps.length + 1;
  if (!Number.isInteger(fmt) || fmt < 1 || fmt > current) throw new Error(`Unsupported ${type} document format ${fmt}; supported format is ${current}.`);
  let next = structuredClone(value);
  for (let version = fmt; version < current; version++) next = steps[version - 1](next);
  return { value: next, fmt: current };
}
