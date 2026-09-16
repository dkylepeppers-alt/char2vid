import type {
  CharacterReference,
  CharacterRevision,
} from '@char2vid/domain/characters/schema';
import type { ReferenceAvailability } from '@char2vid/domain/characters/port';

const ROLES: CharacterReference['role'][] = [
  'identity',
  'body',
  'look',
  'pose',
  'style',
];
const VIEWS: NonNullable<CharacterReference['view']>[] = [
  'front',
  'left',
  'right',
  'back',
  'three-quarter',
];

function formString(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}

function isRole(value: string): value is CharacterReference['role'] {
  return (ROLES as string[]).includes(value);
}

export function ReferenceSlots({
  revision,
  availability,
  detailed,
  busy = false,
  onAccept,
  onReject,
  onAdd,
}: {
  revision: CharacterRevision;
  availability: Record<string, ReferenceAvailability>;
  detailed: boolean;
  busy?: boolean;
  onAccept: (assetRevisionId: string) => void;
  onReject: (assetRevisionId: string) => void;
  onAdd: (slot: {
    assetRevisionId: string;
    role: CharacterReference['role'];
    view?: CharacterReference['view'];
  }) => void;
}) {
  return (
    <section
      className="reference-slots"
      aria-labelledby="reference-slots-title"
    >
      <h3 id="reference-slots-title">Reference slots</h3>
      <p>
        Identity stays on the character revision. A generated view is a
        candidate until you accept it. This is not model training and does not
        import proprietary iModel files.
      </p>
      <ul className="slot-list">
        {revision.references.map((reference) => {
          const state = availability[reference.assetRevisionId] ?? 'available';
          return (
            <li
              key={`${reference.assetRevisionId}-${reference.role}-${reference.view ?? 'any'}`}
              className="slot-row"
            >
              <div>
                <p className="slot-role">
                  {reference.role}
                  {reference.view ? ` · ${reference.view}` : ''}
                </p>
                <p className="library-card-meta">
                  {reference.approval}
                  {state === 'missing' ? ' · missing local source' : ''}
                </p>
              </div>
              {reference.approval === 'candidate' ? (
                <div className="slot-actions">
                  <button
                    type="button"
                    className="status-chip"
                    disabled={busy}
                    onClick={() => onAccept(reference.assetRevisionId)}
                  >
                    Accept view
                  </button>
                  <button
                    type="button"
                    className="status-chip"
                    disabled={busy}
                    onClick={() => onReject(reference.assetRevisionId)}
                  >
                    Reject view
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {detailed ? (
        <AddSlotForm existing={revision} busy={busy} onAdd={onAdd} />
      ) : null}
    </section>
  );
}

function AddSlotForm({
  existing,
  busy = false,
  onAdd,
}: {
  existing: CharacterRevision;
  busy?: boolean;
  onAdd: (slot: {
    assetRevisionId: string;
    role: CharacterReference['role'];
    view?: CharacterReference['view'];
  }) => void;
}) {
  return (
    <form
      className="slot-add"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const assetRevisionId = formString(data, 'assetRevisionId').trim();
        const roleValue = formString(data, 'role') || 'identity';
        const role: CharacterReference['role'] = isRole(roleValue)
          ? roleValue
          : 'identity';
        const viewRaw = formString(data, 'view');
        const view = viewRaw
          ? (viewRaw as NonNullable<CharacterReference['view']>)
          : undefined;
        if (!assetRevisionId) {
          return;
        }
        if (
          existing.references.some(
            (reference) => reference.assetRevisionId === assetRevisionId,
          )
        ) {
          return;
        }
        onAdd({ assetRevisionId, role, view });
        form.reset();
      }}
    >
      <h4>Add slot</h4>
      <label>
        Asset revision ID
        <input
          name="assetRevisionId"
          required
          aria-label="Slot asset revision ID"
        />
      </label>
      <label>
        Role
        <select name="role" aria-label="Slot role" defaultValue="identity">
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </label>
      <label>
        View
        <select name="view" aria-label="Slot view" defaultValue="">
          <option value="">Unspecified</option>
          {VIEWS.map((view) => (
            <option key={view} value={view}>
              {view}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="status-chip" disabled={busy}>
        Add candidate slot
      </button>
    </form>
  );
}
