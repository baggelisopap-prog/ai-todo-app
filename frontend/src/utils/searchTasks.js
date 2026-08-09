/**
 * Accent- and case-insensitive substring search over tasks already in memory.
 *
 * Until now the app had no text search at all. The only way to find a task by
 * name was to ask the AI agent, which spends a model call and a round trip on
 * what is a substring match — over tasks App.jsx is already holding.
 *
 * The folding is the part that matters for Greek. "Ραντεβού" typed without its
 * accent is "Ραντεβου", and a plain `includes` finds nothing; worse, Greek
 * lower-cases final sigma to ς, so "ΟΔΟΝΤΙΑΤΡΟΣ".toLowerCase() and the ς in
 * running text do not match either. NFD strips the diacritics and the sigma is
 * normalised by hand, because Unicode case folding will not do it for us.
 *
 * Deliberately NOT the agent's three-tier matching (agent_engine's exact →
 * word → stem ladder). That exists because the model gets one shot per round
 * and a near-miss costs a whole extra request. Here the user is typing: a
 * result that does not appear is corrected by the next keystroke, and a
 * stemmer would instead return surprising matches with no way to see why.
 */
export function foldForSearch(text) {
  return (text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining marks, i.e. every Greek accent
    .toLowerCase()
    .replace(/ς/g, 'σ');            // final sigma, which case folding leaves alone
}

export function matchesQuery(task, query) {
  const needle = foldForSearch(query).trim();
  if (!needle) return true;
  const haystack = foldForSearch(`${task.task_name || ''} ${task.description || ''}`);
  // Every whitespace-separated term must appear. "ραντεβου γιατρο" should find
  // a task containing both words in either order, which one long substring
  // would miss.
  return needle.split(/\s+/).every((term) => haystack.includes(term));
}

export function searchTasks(tasks, query) {
  if (!query || !query.trim()) return tasks;
  return tasks.filter((task) => matchesQuery(task, query));
}

export default searchTasks;
