/** A contiguous range of visible file rows, used for Shift-click selection. */
export type SelectionRange = { fromIndex: number; toIndex: number };

/**
 * The rows a Shift-click selects: everything between the anchor row and the clicked row, in the
 * order they are rendered (the tree's folder order, or the filtered list).
 *
 * Returns null when either row is not visible any more — after collapsing a folder or typing in the
 * search box — so the caller falls back to a plain toggle instead of selecting a hidden range.
 */
export function selectionRange(
  visibleIds: ReadonlyArray<number>,
  anchorId: number | null,
  targetId: number,
): SelectionRange | null {
  if (anchorId === null) return null;
  const anchorIndex = visibleIds.indexOf(anchorId);
  const targetIndex = visibleIds.indexOf(targetId);
  if (anchorIndex === -1 || targetIndex === -1) return null;
  return anchorIndex <= targetIndex
    ? { fromIndex: anchorIndex, toIndex: targetIndex }
    : { fromIndex: targetIndex, toIndex: anchorIndex };
}
