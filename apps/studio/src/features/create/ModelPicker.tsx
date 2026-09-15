import type { NanoGptModelDescriptor } from '@char2vid/nanogpt';
import { getCompatibleModels } from '@char2vid/nanogpt';
import type { Operation, ReferenceBinding } from '@char2vid/domain';

export type ModelFilter = 'all' | 'compatible' | 'favorite' | 'recent';

const PAGE = 20;

export function ModelPicker({
  models,
  operation,
  references,
  selectedId,
  filter,
  query,
  favorites,
  recent,
  staleLabel,
  visibleCount,
  onFilter,
  onQuery,
  onSelect,
  onLoadMore,
}: {
  models: NanoGptModelDescriptor[];
  operation: Operation;
  references: ReferenceBinding[];
  selectedId: string | null;
  filter: ModelFilter;
  query: string;
  favorites: string[];
  recent: string[];
  staleLabel?: string;
  visibleCount: number;
  onFilter: (filter: ModelFilter) => void;
  onQuery: (query: string) => void;
  onSelect: (model: NanoGptModelDescriptor) => void;
  onLoadMore: () => void;
}) {
  const rows = getCompatibleModels(operation, references, models);
  const needle = query.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (needle) {
      const hay =
        `${row.model.id} ${row.model.displayName ?? ''}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (filter === 'compatible') return row.eligible;
    if (filter === 'favorite') return favorites.includes(row.model.id);
    if (filter === 'recent') return recent.includes(row.model.id);
    return true;
  });
  const ordered =
    filter === 'recent'
      ? [...filtered].sort(
          (a, b) => recent.indexOf(a.model.id) - recent.indexOf(b.model.id),
        )
      : filtered;
  const page = ordered.slice(0, visibleCount);

  return (
    <section className="model-picker" aria-labelledby="model-picker-title">
      <div className="model-picker-heading">
        <h2 id="model-picker-title">Models</h2>
        {staleLabel ? <p className="stale-stamp">{staleLabel}</p> : null}
      </div>
      <label htmlFor="model-search">Search models</label>
      <input
        id="model-search"
        type="search"
        value={query}
        placeholder="Exact id or display name"
        onChange={(event) => onQuery(event.target.value)}
      />
      <div className="filter-row" role="tablist" aria-label="Model filters">
        {(
          [
            ['all', 'All'],
            ['compatible', 'Compatible'],
            ['favorite', 'Favorite'],
            ['recent', 'Recent'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filter === id}
            className={filter === id ? 'filter-chip active' : 'filter-chip'}
            onClick={() => onFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="model-list">
        {page.map((row) => (
          <li key={row.model.id}>
            <button
              type="button"
              className={
                row.model.id === selectedId ? 'model-row selected' : 'model-row'
              }
              onClick={() => onSelect(row.model)}
            >
              <span className="model-id">
                {row.model.displayName ?? row.model.id}
              </span>
              <span className="model-meta">{row.model.id}</span>
              {!row.eligible ? (
                <span className="model-reason">{row.reasons.join(', ')}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      {ordered.length === 0 ? <p>No models match this filter.</p> : null}
      {visibleCount < ordered.length ? (
        <button type="button" className="secondary-action" onClick={onLoadMore}>
          Load more ({Math.min(PAGE, ordered.length - visibleCount)} of{' '}
          {ordered.length - visibleCount})
        </button>
      ) : null}
    </section>
  );
}

export const MODEL_PAGE_SIZE = PAGE;
