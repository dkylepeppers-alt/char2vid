import type { ReferenceBinding } from '@char2vid/domain';
import type { AssetRecord } from '@char2vid/domain/storage';

export function ReferenceTray({
  references,
  libraryAssets,
  onAttach,
  onRemove,
}: {
  references: ReferenceBinding[];
  libraryAssets: AssetRecord[];
  onAttach: (asset: AssetRecord) => void;
  onRemove: (binding: ReferenceBinding) => void;
}) {
  const attached = new Set(references.map((item) => item.assetRevisionId));
  const available = libraryAssets.filter(
    (asset) =>
      asset.kind === 'image' &&
      asset.state === 'available' &&
      !asset.trashedAt &&
      !attached.has(asset.revisionId),
  );

  return (
    <section className="reference-tray" aria-labelledby="reference-tray-title">
      <h2 id="reference-tray-title">References</h2>
      {references.length === 0 ? (
        <p>
          No references attached. Attach a library image when the selected model
          needs one. Create stays image-first.
        </p>
      ) : (
        <ol>
          {references.map((item) => (
            <li key={`${item.assetRevisionId}-${item.ordinal}`}>
              <span>
                {item.role} · {item.assetRevisionId}
              </span>
              <button
                type="button"
                className="secondary-action"
                onClick={() => onRemove(item)}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
      <h3 className="reference-attach-title">Attach from library</h3>
      {available.length === 0 ? (
        <p>Import an image in Library, then attach it here before Generate.</p>
      ) : (
        <ul className="reference-attach-list">
          {available.map((asset) => (
            <li key={asset.id}>
              <span>
                {asset.name} · {asset.kind}
              </span>
              <button
                type="button"
                className="secondary-action"
                onClick={() => onAttach(asset)}
              >
                Attach as identity
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
