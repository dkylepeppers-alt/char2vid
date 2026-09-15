import type { ReferenceBinding } from '@char2vid/domain';

export function ReferenceTray({
  references,
}: {
  references: ReferenceBinding[];
}) {
  return (
    <section className="reference-tray" aria-labelledby="reference-tray-title">
      <h2 id="reference-tray-title">References</h2>
      {references.length === 0 ? (
        <p>
          No references attached. Library attachments wire up with generation
          jobs.
        </p>
      ) : (
        <ol>
          {references.map((item) => (
            <li key={`${item.assetRevisionId}-${item.ordinal}`}>
              {item.role} · {item.assetRevisionId}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
