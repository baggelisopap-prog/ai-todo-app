import { getInitials } from '../utils/profile';
import { personColor, personName } from '../utils/people';

const SIZE_CLASSES = {
  xs: 'w-5 h-5 text-[9px]',
  sm: 'w-6 h-6 text-[10px]',
  md: 'w-8 h-8 text-xs',
};

/**
 * One person, as a circle of initials.
 *
 * The same circle the top bar already draws for the signed-in user, reusing
 * getInitials so "ΒΟ" means the same two letters everywhere. What it adds is a
 * COLOUR PER PERSON, derived from the id (see utils/people.js): with one brand
 * colour for everybody, two colleagues on two rows are the same blue disc and
 * the initials are the only thing separating them — which is exactly the work
 * a glance down a list is trying to avoid.
 *
 * `member` is a row from GET /workspaces/{id}/members, or null. Null is a real
 * case and not an error: somebody was handed a task and has since left the
 * workspace, and the task still points at them. It draws a grey "?" with the
 * caller's `unknownLabel` rather than nothing, because a task that reads as
 * unassigned when it is not would send the work to the wrong person.
 */
function Avatar({ member, userId, size = 'sm', unknownLabel, className = '' }) {
  const id = member?.user_id || userId;
  const name = personName(member);
  const label = name || unknownLabel || '?';

  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      className={`${SIZE_CLASSES[size]} rounded-full text-white font-semibold flex items-center justify-center flex-shrink-0 select-none ${className}`}
      style={{ backgroundColor: name ? personColor(id) : 'var(--text-muted)' }}
    >
      {name ? getInitials(member.display_name, member.email) : '?'}
    </span>
  );
}

export default Avatar;
