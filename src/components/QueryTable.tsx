import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { PersistedQuery, QueryFilters } from "../types/queries";

type QueryTableProps = {
  emptyMessage?: string;
  filters: QueryFilters;
  isLoading: boolean;
  lastUpdatedAt: string | null;
  onFiltersChange: (filters: QueryFilters) => void;
  onSelect: (queryId: string) => void;
  queries: PersistedQuery[];
  refreshIntervalMs: number;
  selectedQueryId: string | null;
  summary: {
    averageDuration: string;
    errorRate: string;
    rowCount: number;
    totalCount: number;
  };
};

type TableColumn = {
  header: string;
  filter: {
    field: keyof QueryFilters;
    label: string;
  };
  align?: "left" | "right";
  cellClassName?: string;
  render: (query: PersistedQuery) => string;
};

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

function previewQuery(query: string | null) {
  const normalized = (query ?? "").replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "No query text";
  }

  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
}

function displayValue(value: string | null) {
  return value && value.trim() ? value : "-";
}

function displayState(query: PersistedQuery) {
  if (query.displayState) {
    return query.displayState;
  }

  return query.state ?? "Logged";
}

function getStateClass(query: PersistedQuery) {
  const state = displayState(query).toLowerCase();

  if (query.isError || state.includes("error") || state.includes("fatal") || state.includes("panic")) {
    return "is-error";
  }

  if (state.includes("warning") || state.includes("notice")) {
    return "is-waiting";
  }

  return "is-active";
}

function parseSortTimestamp(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function getQuerySortRank(query: PersistedQuery) {
  const queryStart = parseSortTimestamp(query.queryStart);
  if (queryStart !== null) {
    return queryStart;
  }

  const captureId = Number(query.id.split(":")[1] ?? 0);
  if (!Number.isNaN(captureId)) {
    return captureId;
  }

  return query.pid;
}

function buildColumns(): TableColumn[] {
  return [
    {
      header: "Logged",
      filter: { field: "queryStart", label: "Filter logged time column" },
      render: (query) => displayValue(query.queryStart),
    },
    {
      header: "Query",
      filter: { field: "queryText", label: "Filter query column" },
      cellClassName: "monitor-query-preview",
      render: (query) => previewQuery(query.query),
    },
    {
      header: "Duration",
      filter: { field: "duration", label: "Filter duration column" },
      align: "right",
      render: (query) => displayValue(query.duration),
    },
    {
      header: "State",
      filter: { field: "state", label: "Filter state column" },
      render: (query) => displayState(query),
    },
    {
      header: "Database",
      filter: { field: "database", label: "Filter database column" },
      render: (query) => displayValue(query.database),
    },
    {
      header: "User",
      filter: { field: "user", label: "Filter user column" },
      render: (query) => displayValue(query.user),
    },
    {
      header: "Application",
      filter: { field: "applicationName", label: "Filter application column" },
      render: (query) => displayValue(query.applicationName),
    },
    {
      header: "PID",
      filter: { field: "pid", label: "Filter PID column" },
      align: "right",
      render: (query) => query.pid.toString(),
    },
  ];
}

export function QueryTable({
  emptyMessage,
  filters,
  isLoading,
  lastUpdatedAt,
  onFiltersChange,
  onSelect,
  queries,
  refreshIntervalMs,
  selectedQueryId,
  summary,
}: QueryTableProps) {
  const columns = buildColumns();
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState(1);

  const sortedQueries = useMemo(() => {
    return [...queries].sort((left, right) => {
      const rankDelta = getQuerySortRank(right) - getQuerySortRank(left);
      if (rankDelta !== 0) {
        return rankDelta;
      }

      return right.pid - left.pid;
    });
  }, [queries]);

  const totalPages = Math.max(1, Math.ceil(sortedQueries.length / pageSize));
  const pageStart = (currentPage - 1) * pageSize;
  const paginatedQueries = sortedQueries.slice(pageStart, pageStart + pageSize);

  useEffect(() => {
    setCurrentPage(1);
  }, [filters, pageSize]);

  useEffect(() => {
    setCurrentPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  function updateFilter<K extends keyof QueryFilters>(field: K, value: QueryFilters[K]) {
    onFiltersChange({
      ...filters,
      [field]: value,
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>, queryId: string) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(queryId);
    }
  }

  return (
    <section className="monitor-table-frame">
      <div className="monitor-table-head">
        <div>
          <strong>Query Log</strong>
          <span>Newest statements stay at the top. Click any row to inspect the full SQL text.</span>
        </div>

        <div className="monitor-table-pills">
          <span className="monitor-table-pill">{summary.rowCount} rows</span>
          <span className="monitor-table-pill">Avg {summary.averageDuration}</span>
          <span className="monitor-table-pill">Err {summary.errorRate}</span>
        </div>
      </div>

      <div className="monitor-table-scroll">
        <table className="monitor-query-table">
          <thead>
            <tr className="monitor-query-table-headrow">
              {columns.map((column) => (
                <th className={column.align === "right" ? "is-right" : ""} key={column.header}>
                  {column.header}
                </th>
              ))}
            </tr>
            <tr className="monitor-query-table-filterrow">
              {columns.map((column) => (
                <th className={column.align === "right" ? "is-right" : ""} key={`${column.header}-filter`}>
                  <input
                    aria-label={column.filter.label}
                    className="monitor-column-filter"
                    onChange={(event) => updateFilter(column.filter.field, event.target.value)}
                    placeholder="filter"
                    type="text"
                    value={filters[column.filter.field]}
                  />
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {sortedQueries.length === 0 ? (
              <tr>
                <td className="monitor-empty-state" colSpan={columns.length}>
                  {isLoading ? "Loading queries..." : (emptyMessage ?? "No observed queries match the current filters.")}
                </td>
              </tr>
            ) : (
              paginatedQueries.map((query) => {
                const isSelected = selectedQueryId === query.id;

                return (
                  <tr
                    aria-label={`Open details for query ${query.pid}`}
                    aria-pressed={isSelected}
                    className={[
                      "monitor-query-row",
                      isSelected ? "is-selected" : "",
                      getStateClass(query),
                    ]
                      .join(" ")
                      .trim()}
                    key={query.id}
                    onClick={() => onSelect(query.id)}
                    onKeyDown={(event) => handleKeyDown(event, query.id)}
                    role="button"
                    tabIndex={0}
                  >
                    {columns.map((column) => (
                      <td
                        className={[
                          column.align === "right" ? "is-right" : "",
                          column.cellClassName ?? "",
                        ]
                          .join(" ")
                          .trim()}
                        key={`${query.id}-${column.header}`}
                      >
                        {column.header === "State" ? (
                          <span className={`monitor-state-pill ${getStateClass(query)}`}>{column.render(query)}</span>
                        ) : (
                          column.render(query)
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="monitor-table-foot">
        <span>
          {summary.rowCount} of {summary.totalCount} visible
        </span>
        <div className="monitor-table-pagination">
          <label className="monitor-pagination-size">
            <span>rows</span>
            <select
              className="monitor-pagination-select"
              onChange={(event) => setPageSize(Number(event.target.value))}
              value={pageSize}
            >
              {PAGE_SIZE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <span>
            page {currentPage} / {totalPages}
          </span>

          <div className="monitor-pagination-buttons">
            <button
              className="monitor-pagination-button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              type="button"
            >
              Prev
            </button>
            <button
              className="monitor-pagination-button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              type="button"
            >
              Next
            </button>
          </div>
        </div>
        <span>{lastUpdatedAt ? `last update ${lastUpdatedAt}` : "waiting for data"}</span>
        <span>refresh {refreshIntervalMs}ms</span>
      </div>
    </section>
  );
}
