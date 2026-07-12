// Known event types with keywords (Greek + English)
// The FIRST value in each list is the canonical display label
const KNOWN_TYPES = {
  'Τηλέφωνο': ['τηλέφωνο', 'τηλεφώνημα', 'κλήση', 'κάλεσε', 'πάρουν', 'call', 'phone', 'ring'],
  'Ραντεβού': ['ραντεβού', 'απολογία', 'appointment', 'booking'],
  'Meeting': ['meeting', 'συνάντηση', 'συνέλευση', 'sync'],
  'Ψώνια': ['ψώνια', 'αγορά', 'shopping', 'σουπερμάρκετ', 'σουπερ', 'market', 'grocery', 'groceries'],
  'Δουλειά': ['δουλειά', 'work', 'βάρδια', 'γραφείο', 'σημείο', 'shift', 'office'],
  'Γιατρός': ['γιατρός', 'doctor', 'νοσοκομείο', 'οδοντίατρος', 'dentist', 'hospital'],
  'Ταξίδι': ['ταξίδι', 'trip', 'πτήση', 'flight', 'αεροδρόμιο', 'airport'],
  'Γυμναστήριο': ['γυμναστήριο', 'gym', 'προπόνηση', 'workout', 'training', 'τρέξιμο', 'run', 'running'],
  'Email': ['email', 'mail', 'ηλεκτρονικό'],
  'Πληρωμή': ['πληρωμή', 'πλήρωσε', 'payment', 'pay', 'λογαριασμός', 'bill'],
  'Φαγητό': ['φαγητό', 'δείπνο', 'γεύμα', 'meal', 'lunch', 'dinner', 'breakfast', 'μεσημεριανό'],
  'Διάβασμα': ['διάβασμα', 'read', 'μελέτη', 'study', 'reading'],
};

// Greek + English stop words for the fallback first-word logic
const STOP_WORDS = new Set([
  // Greek prepositions/articles/particles
  'στο', 'στα', 'στην', 'στον', 'στους', 'στις', 'σε',
  'να', 'θα', 'δεν', 'μη', 'μην', 'ας',
  'ένα', 'μία', 'ένας', 'μια',
  'το', 'τα', 'την', 'τον', 'τους', 'τις', 'της', 'του',
  'με', 'και', 'ή', 'για',
  'από', 'προς', 'μέχρι',
  'όταν', 'όπου', 'όπως',
  // English
  'the', 'a', 'an', 'to', 'in', 'on', 'at',
  'and', 'or', 'for', 'with', 'by',
  'is', 'was', 'be', 'my', 'your',
  'do', 'does', 'go', 'get',
]);

function normalize(str) {
  // Lowercase and strip Greek accents
  return str
    .toLowerCase()
    .replace(/[ὰάά]/g, 'α')
    .replace(/[ὲέέ]/g, 'ε')
    .replace(/[ὴήή]/g, 'η')
    .replace(/[ὶίίϊΐ]/g, 'ι')
    .replace(/[ὸόό]/g, 'ο')
    .replace(/[ὺύύϋΰ]/g, 'υ')
    .replace(/[ὼώώ]/g, 'ω');
}

function stripPunctuation(word) {
  return word.replace(/[^\wͰ-Ͽἀ-῿]/g, '');
}

/**
 * Determines a short label for a task, suitable for tight display cells.
 * Priority:
 *   1. Match against known event type keywords (Greek + English, case + accent insensitive).
 *   2. Fall back to the first meaningful word of the title (skips stop words).
 *   3. Fall back to the first word.
 *   4. Fall back to empty string.
 */
export function getEventLabel(title) {
  if (!title || typeof title !== 'string') return '';

  const words = title.split(/\s+/).map(stripPunctuation).filter(Boolean);
  if (words.length === 0) return '';

  const normalizedWords = words.map(normalize);

  // Step 1: Check for known event type keywords anywhere in the title
  for (const [label, keywords] of Object.entries(KNOWN_TYPES)) {
    const normalizedKeywords = keywords.map(normalize);
    for (const nw of normalizedWords) {
      for (const nk of normalizedKeywords) {
        if (nw === nk || nw.startsWith(nk)) {
          return label;
        }
      }
    }
  }

  // Step 2: First meaningful word (skip stop words)
  for (let i = 0; i < words.length; i++) {
    const normalized = normalizedWords[i];
    if (!STOP_WORDS.has(normalized) && !/^\d+$/.test(words[i])) {
      return words[i];
    }
  }

  // Step 3: Fallback — first word regardless
  return words[0];
}
