export function aiContext(type, item) {
  return {
    name: item.name,
    status: item.status || null,
    target: item.target || null,
    evidence: (type === 'flow' ? item.steps : item.evidence).map((e, i) => ({
      id: i + 1,
      file: e.file,
      line: e.line,
      label: e.label,
      detail: e.detail,
    })),
    notes: item.checks || item.notes || [],
  }
}
