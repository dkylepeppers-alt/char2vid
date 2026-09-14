export interface SelectionBarProps {
  selectedCount: number;
  trashedView: boolean;
  onClear: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onPermanentDelete: () => void;
  onFavorite: (value: boolean) => void;
}

export function SelectionBar({
  selectedCount,
  trashedView,
  onClear,
  onTrash,
  onRestore,
  onPermanentDelete,
  onFavorite,
}: SelectionBarProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div className="selection-bar" role="toolbar" aria-label="Batch selection">
      <p className="selection-count">{selectedCount} selected</p>
      <div className="selection-actions">
        {trashedView ? (
          <>
            <button type="button" className="status-chip" onClick={onRestore}>
              Restore
            </button>
            <button
              type="button"
              className="status-chip"
              onClick={onPermanentDelete}
            >
              Delete forever
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="status-chip"
              onClick={() => onFavorite(true)}
            >
              Favorite
            </button>
            <button type="button" className="status-chip" onClick={onTrash}>
              Move to trash
            </button>
          </>
        )}
        <button
          type="button"
          className="icon-button"
          onClick={onClear}
          aria-label="Clear selection"
        >
          ×
        </button>
      </div>
    </div>
  );
}
