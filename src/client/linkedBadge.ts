// Build the "关联" (Linked) badge appended after an employee name in detail-page search results.
//
// Employee "关联" declares that several external 工号 (Futu / Shareworks numbers) are the same
// person. When a search brings out rows from a linked group (see expandByLinkedGroup on the
// server), each such row carries `linkedIdentities` — the other 工号 in its canonical group. This
// helper renders a small badge so the user can tell a row surfaced because of a link, and which
// other identities it maps to (shown in the title tooltip).
//
// `escape` is injected (rather than importing the DOM-backed escapeHtml from main.ts) so this stays
// a pure, DOM-free function that can be unit-tested under node.
export interface LinkedBadgeIdentity {
  source: string;
  employeeId: string;
  name: string;
}

export function buildLinkedBadge(
  linkedIdentities: LinkedBadgeIdentity[] | undefined,
  lang: string,
  escape: (text: unknown) => string,
): string {
  const linked = linkedIdentities ?? [];
  if (!linked.length) return '';
  const title = linked
    .map((identity) => `${identity.source}:${identity.employeeId} ${identity.name}`.trim())
    .join('；');
  const label = lang === 'zh-CN' ? '关联' : 'Linked';
  return ` <span class="linked-badge" title="${escape(title)}">${label}</span>`;
}
