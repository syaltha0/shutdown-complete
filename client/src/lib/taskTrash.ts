import type { InboxDoc } from './model';
export const TRASH_TTL = 30 * 86400000;
export const cleanTrash = (b: InboxDoc, now = Date.now()): InboxDoc => ({ ...b, trash: (b.trash ?? []).filter((x) => Date.parse(x.deletedAt) > now - TRASH_TTL) });
export const trashTasks = (b: InboxDoc, ids: string[], now = Date.now()): InboxDoc => ({ ...cleanTrash(b, now), items: b.items.filter((t) => !ids.includes(t.id)), trash: [...(cleanTrash(b, now).trash ?? []), ...b.items.filter((t) => ids.includes(t.id)).map((item) => ({ item, deletedAt: new Date(now).toISOString() }))] });
export const restoreTasks = (b: InboxDoc, ids: string[]): InboxDoc => ({ ...b, items: [...b.items, ...(b.trash ?? []).filter((x) => ids.includes(x.item.id) && !b.items.some((t) => t.id === x.item.id)).map((x) => x.item)], trash: b.trash?.filter((x) => !ids.includes(x.item.id)) });
