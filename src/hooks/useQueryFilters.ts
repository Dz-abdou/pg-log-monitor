import type { PersistedQuery, QueryFilters } from "../types/queries";

function includesValue(source: string | null, query: string) {
  if (!query) {
    return true;
  }

  return (source ?? "").toLowerCase().includes(query.trim().toLowerCase());
}

function displayState(query: PersistedQuery) {
  if (query.displayState) {
    return query.displayState;
  }

  return query.state ?? "Logged";
}

export function useQueryFilters(queries: PersistedQuery[], filters: QueryFilters) {
  return queries.filter((query) => {
    return (
      includesValue(query.pid.toString(), filters.pid) &&
      includesValue(query.queryStart, filters.queryStart) &&
      includesValue(query.database, filters.database) &&
      includesValue(query.user, filters.user) &&
      includesValue(query.applicationName, filters.applicationName) &&
      includesValue(displayState(query), filters.state) &&
      includesValue(query.duration, filters.duration) &&
      includesValue(query.query, filters.queryText)
    );
  });
}
