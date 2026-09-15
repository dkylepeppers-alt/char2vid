import type { CapabilityIssue } from '@char2vid/domain';

/** Text request fields are unresolved in the route registry; do not invent them. */
export function serializeTextRequest(): { issues: CapabilityIssue[] } {
  return {
    issues: [
      {
        code: 'unresolved_text_contract',
        field: 'operation',
        severity: 'blocking',
        message:
          'Text chat request fields are not inventoried; the adapter will not invent them.',
      },
    ],
  };
}
