const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Parses ?limit=&offset= with sane bounds. */
export function parsePagination(query) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

export function paginatedResponse(items, total, { limit, offset }) {
  return { items, pagination: { total, limit, offset, hasMore: offset + items.length < total } };
}
