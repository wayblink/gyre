import { productFileCollisionKey } from '../fileIdentity.js';

/**
 * Product file references are stored by logical path (`{ provider: 'product-files', key }`) inside
 * workflow definitions, so moving a file to another folder has to rewrite them or the workflow would
 * fail at run time with "Product file not found". Pure: the input value is never mutated.
 */
export function rewriteProductFileKey(
  value: unknown,
  oldKey: string,
  newKey: string,
): { value: unknown; changed: number } {
  const oldCollisionKey = productFileCollisionKey(oldKey);
  let changed = 0;

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;

    const record = node as Record<string, unknown>;
    if (
      record.provider === 'product-files' &&
      typeof record.key === 'string' &&
      productFileCollisionKey(record.key) === oldCollisionKey
    ) {
      changed += 1;
      return { ...record, key: newKey };
    }

    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(record)) next[key] = walk(child);
    return next;
  };

  return { value: walk(value), changed };
}
