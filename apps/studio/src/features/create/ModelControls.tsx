import type { ParameterControl } from '@char2vid/nanogpt';

function controlValue(value: unknown, fallback: unknown): string {
  const resolved = value ?? fallback;
  if (
    typeof resolved === 'string' ||
    typeof resolved === 'number' ||
    typeof resolved === 'boolean'
  ) {
    return String(resolved);
  }
  return '';
}

export function ModelControls({
  controls,
  values,
  invalidated,
  onChange,
}: {
  controls: ParameterControl[];
  values: Record<string, unknown>;
  invalidated: string[];
  onChange: (key: string, value: unknown) => void;
}) {
  const editable = controls.filter((control) => control.kind !== 'unsupported');
  const inspectable = controls.filter(
    (control) => control.kind === 'unsupported',
  );

  return (
    <section className="model-controls" aria-labelledby="model-controls-title">
      <h2 id="model-controls-title">Controls</h2>
      {invalidated.length > 0 ? (
        <p role="status">
          Settings dropped on model switch: {invalidated.join(', ')}
        </p>
      ) : null}
      {editable.length === 0 ? (
        <p>This model has no verified editable controls.</p>
      ) : (
        editable.map((control) => (
          <label key={control.key} htmlFor={`control-${control.key}`}>
            {control.key}
            {control.kind === 'boolean' ? (
              <input
                id={`control-${control.key}`}
                type="checkbox"
                checked={Boolean(values[control.key] ?? control.default)}
                onChange={(event) =>
                  onChange(control.key, event.target.checked)
                }
              />
            ) : control.kind === 'number' ? (
              <input
                id={`control-${control.key}`}
                type="number"
                min={control.min}
                max={control.max}
                value={
                  typeof values[control.key] === 'number'
                    ? controlValue(values[control.key], '')
                    : ''
                }
                onChange={(event) => {
                  const next = event.target.value;
                  onChange(control.key, next === '' ? undefined : Number(next));
                }}
              />
            ) : control.kind === 'select' && control.options ? (
              <select
                id={`control-${control.key}`}
                value={controlValue(values[control.key], control.default)}
                onChange={(event) => onChange(control.key, event.target.value)}
              >
                {control.options.map((option) => {
                  const value = controlValue(option.value, '');
                  return (
                    <option key={value} value={value}>
                      {option.label ?? value}
                    </option>
                  );
                })}
              </select>
            ) : (
              <input
                id={`control-${control.key}`}
                type="text"
                value={
                  typeof values[control.key] === 'string'
                    ? controlValue(values[control.key], '')
                    : ''
                }
                onChange={(event) => onChange(control.key, event.target.value)}
              />
            )}
          </label>
        ))
      )}
      {inspectable.length > 0 ? (
        <details>
          <summary>Unsupported controls</summary>
          <ul>
            {inspectable.map((control) => (
              <li key={control.key}>
                {control.key}: {JSON.stringify(control.raw)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
