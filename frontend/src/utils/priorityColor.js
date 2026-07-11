export function priorityColor(priority) {
  switch (priority) {
    case 'P1':
      return 'var(--priority-p1)';
    case 'P2':
      return 'var(--priority-p2)';
    case 'P3':
      return 'var(--priority-p3)';
    default:
      return 'var(--text-muted)';
  }
}
