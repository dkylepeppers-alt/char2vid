import type {
  CapabilityIssue,
  ReferenceBinding,
  ReferenceRole,
} from '@char2vid/domain';

const ROLES: ReferenceRole[] = [
  'identity',
  'body',
  'look',
  'pose',
  'style',
  'composition',
  'start-frame',
  'end-frame',
  'motion',
  'continuity',
  'voice',
];

function isRole(value: string): value is ReferenceRole {
  return (ROLES as string[]).includes(value);
}

export function ReferenceAssignmentSheet({
  selected,
  omitted,
  issues,
  onRoleChange,
  onOmit,
}: {
  selected: ReferenceBinding[];
  omitted: ReferenceBinding[];
  issues: CapabilityIssue[];
  onRoleChange?: (assetRevisionId: string, role: ReferenceRole) => void;
  onOmit?: (assetRevisionId: string) => void;
}) {
  const blocking = issues.filter((issue) => issue.severity === 'blocking');
  const advisory = issues.filter((issue) => issue.severity === 'advisory');

  return (
    <section
      className="reference-assignment"
      aria-labelledby="reference-assignment-title"
    >
      <h2 id="reference-assignment-title">Reference assignment</h2>
      <p>
        Selected references keep their revision IDs and order. Extra identities
        stay visible until you omit them — Generate will not silently drop a
        character.
      </p>
      {blocking.length > 0 ? (
        <ul
          className="plan-issues blocking"
          aria-label="Blocking reference issues"
        >
          {blocking.map((issue) => (
            <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
      {advisory.length > 0 ? (
        <ul
          className="plan-issues advisory"
          aria-label="Advisory reference issues"
        >
          {advisory.map((issue) => (
            <li key={`${issue.code}-${issue.message}`}>{issue.message}</li>
          ))}
        </ul>
      ) : null}
      <h3>Selected</h3>
      {selected.length === 0 ? (
        <p>No references selected for this route yet.</p>
      ) : (
        <ol>
          {selected.map((item) => (
            <li key={`${item.assetRevisionId}-${item.ordinal}`}>
              <label>
                Role
                <select
                  aria-label={`Role for ${item.assetRevisionId}`}
                  value={item.role}
                  disabled={!onRoleChange}
                  onChange={(event) => {
                    if (isRole(event.target.value)) {
                      onRoleChange?.(item.assetRevisionId, event.target.value);
                    }
                  }}
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <p className="library-card-meta">
                {item.assetRevisionId}
                {item.characterRevisionId
                  ? ` · character ${item.characterRevisionId}`
                  : ''}
                {` · ordinal ${item.ordinal}`}
              </p>
              {onOmit ? (
                <button
                  type="button"
                  className="secondary-action"
                  onClick={() => onOmit(item.assetRevisionId)}
                >
                  Omit
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <h3>Omitted</h3>
      {omitted.length === 0 ? (
        <p>Every requested reference can be sent.</p>
      ) : (
        <ul>
          {omitted.map((item) => (
            <li key={`${item.assetRevisionId}-omitted`}>
              {item.role} · {item.assetRevisionId} · ordinal {item.ordinal}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
