# AI To-Do App — Progress Tracker

> **Προσωπικό αρχείο** για να ξέρω πού είμαι και τι μένει.

---

## Τι χτίζω

AI-powered to-do app που:
- Δέχεται φυσική γλώσσα (ελληνικά/αγγλικά, text αρχικά, voice/φωτογραφίες αργότερα)
- Εξάγει tasks με AI (Gemini 2.5 Flash)
- Τα αποθηκεύει σε βάση
- Με σύστημα έγκρισης (AI προτείνει → εγώ διορθώνω/εγκρίνω)
- Με swipeable κάρτες Business/Personal στο frontend

**Στόχος μου**: AI Architect career path. Το project είναι για μάθηση + portfolio + προσωπική χρήση.

---

## Στόχος αρχιτεκτονικής

```
┌─────────────────────┐
│   FRONTEND (React)  │  ← Δεν έχει χτιστεί
└──────────┬──────────┘
           ↕ HTTP
┌─────────────────────┐
│   BACKEND (FastAPI) │  ← Δεν έχει χτιστεί
└──────────┬──────────┘
           ↕ Python calls
┌─────────────────────┐
│  EXTRACTION ENGINE  │  ✅ Έτοιμο
│  (test_ai.py)       │
└──────────┬──────────┘
           ↕
┌─────────────────────┐
│  REPOSITORY LAYER   │  ✅ Έτοιμο
│  (repository.py)    │
└──────────┬──────────┘
           ↕
┌─────────────────────┐
│  DATABASE (Airtable)│  ✅ Έτοιμο
└─────────────────────┘
```

---

## Αρχεία που έχω

| Αρχείο | Σκοπός | Status |
|---|---|---|
| `.env` | API keys (Google, Airtable) | ✅ Setup |
| `models.py` | Pydantic schemas (SingleTask, TaskList, TaskRecord) | ✅ Έτοιμο |
| `test_ai.py` | AI extraction + save στο Airtable | ✅ Έτοιμο |
| `repository.py` | Airtable integration layer | ✅ Έτοιμο |
| `main.py` | FastAPI app | ⏳ Δεν υπάρχει |
| `frontend/` | React app | ⏳ Δεν υπάρχει |

---

## Τι κάνει κάθε αρχείο

### `models.py`
Το **συμβόλαιο των δεδομένων**. Ορίζει πώς μοιάζει ένα task.

- `SingleTask`: τι παράγει το AI (7 πεδία)
- `TaskList`: wrapper για πολλά tasks
- `TaskRecord`: τι αποθηκεύεται στη βάση (12 πεδία total, κληρονομεί από SingleTask)
- Validators που εξασφαλίζουν σωστή μορφή ημερομηνιών/ωρών

### `test_ai.py`
Το **extraction engine**. Καλεί το AI και σώζει στη βάση.

- Παίρνει string από τον χρήστη
- Καλεί Gemini με system prompt που περιλαμβάνει σημερινή ημερομηνία (Europe/Athens)
- Διατηρεί τη γλώσσα του χρήστη (ελληνικά/αγγλικά)
- Retry logic (3 προσπάθειες με exponential backoff)
- Validation με Pydantic
- Καλεί το repository για να σώσει κάθε task

### `repository.py`
Ο **μεσάζοντας** με τη βάση. Όλη η λογική Airtable ζει εδώ.

- `save_task()`: POST νέο task
- `get_all_tasks()`: GET όλα τα tasks
- `get_task(id)`: GET συγκεκριμένο
- `update_task(id, updates)`: PATCH

Σημαντικό: ο υπόλοιπος κώδικας **δεν ξέρει για Airtable**. Αν αύριο αλλάξω σε Supabase, αλλάζει μόνο αυτό το αρχείο.

---

## Airtable schema

12 στήλες, snake_case:

| Στήλη | Τύπος | Από ποιον γεμίζει |
|---|---|---|
| task_name | Single line text | AI |
| description | Long text | AI |
| category | Single select (Business/Personal/Unknown) | AI |
| priority | Single select (P1/P2/P3) | AI |
| due_date | Date | AI |
| due_time | Single line text | AI |
| checklist | Long text (JSON) | AI |
| approval_status | Checkbox | Κώδικας (default False) |
| is_completed | Checkbox | Κώδικας (default False) |
| created_time | Created time | Airtable auto |
| ai_suggested_category | Single select | Κώδικας (snapshot) |
| ai_suggested_priority | Single select | Κώδικας (snapshot) |

---

## Σχεδιαστικές αποφάσεις που έχω πάρει

- ✅ **Κατηγορίες**: Business / Personal / Unknown
- ✅ **Priorities**: P1 / P2 / P3
- ✅ **Swipeable κάρτες** στο frontend (Business / Personal / All)
- ✅ **In-place approval**: τα tasks εμφανίζονται flagged στην κύρια λίστα, ο χρήστης πατά "Approve & Complete"
- ✅ **AI snapshots**: κρατάω αρχικές προτάσεις του AI για future learning loop
- ✅ **Repository Pattern**: για ευκολία μελλοντικής μετάβασης σε Supabase
- ✅ **Airtable τώρα, Supabase αργότερα** (όταν θέλω να βγει online)
- ✅ **Web app (React) πρώτα, mobile native αργότερα** (αν χρειαστεί)
- ✅ **Glώssa**: AI διατηρεί τη γλώσσα του χρήστη

---

## Phase 0 — Hardening ✅ ΤΕΛΕΙΩΣΕ

- [x] Retry logic με exponential backoff
- [x] Error handling για API, network, validation
- [x] Fail-fast αν λείπει API key
- [x] Pydantic validation με logging
- [x] Sanity constraints στα πεδία

## Phase 1 — MVP Pipeline

- [x] Pydantic schemas (models.py)
- [x] System prompt με δυναμική ημερομηνία + timezone
- [x] Validators για due_date / due_time
- [x] Airtable schema setup
- [x] Repository layer (repository.py)
- [x] Σύνδεση test_ai.py με repository
- [x] **Πραγματικά tasks αποθηκεύονται στο Airtable** 🎉
- [ ] **FastAPI Wrapper** ← επόμενο
  - [ ] POST /extract endpoint
  - [ ] GET /tasks endpoint
  - [ ] PATCH /tasks/{id} endpoint
  - [ ] Auto-generated /docs page

## Phase 2 — Frontend

- [ ] React project setup
- [ ] Tailwind CSS
- [ ] Layout: 3 swipeable κάρτες (Business/Personal/All)
- [ ] Task display με flagged status
- [ ] Text input για νέα tasks
- [ ] Σύνδεση με FastAPI backend
- [ ] Approval flow (Approve & Complete / Change first)
- [ ] Styling & polish

## Phase 3 — Advanced

- [ ] Voice input
- [ ] Image input (φωτογραφίες post-it)
- [ ] AI Learning Logs (few-shot από διορθώσεις)
- [ ] Multi-platform routing (Google Calendar, email)
- [ ] User authentication
- [ ] Multi-user support

## Phase 4 — Deployment

- [ ] Μετάβαση σε Supabase
- [ ] Deploy backend σε cloud (Railway/Render)
- [ ] Deploy frontend
- [ ] Custom domain
- [ ] Public access

---

## Πώς τρέχω το project

```bash
# Activate venv
.\venv\Scripts\activate

# Run extraction + save
python test_ai.py
```

Το test_input είναι μέσα στο αρχείο `test_ai.py` (στο `__main__` block).

---

## Λογαριασμοί που χρησιμοποιώ

- **Google AI Studio**: για Gemini API key
- **Airtable**: βάση δεδομένων (base "To do ai app blueprint")
- **VS Code**: editor

---

## Σημαντικά πράγματα που έμαθα

### Τεχνικά
- **Pydantic** δεν είναι μόνο για AI — είναι για κάθε σύνορο δεδομένων (AI, database, HTTP, εξωτερικά APIs)
- **Schema 1 vs Schema 2**: το AI παράγει λιγότερα πεδία από όσα αποθηκεύεις
- **Repository Pattern**: ένας μεσάζοντας με τη βάση, αλλαγή βάσης = αλλαγή ενός αρχείου
- **DRY** (Don't Repeat Yourself): ένα block κώδικα κάνει μία δουλειά, χρησιμοποιείται από παντού
- **Fail fast and loud**: σιωπηρά errors είναι χειρότερα από θορυβώδη
- **`temperature=0.0` ≠ determinism**: μειώνει τη variance, δεν την εξαλείφει
- **Silent data corruption**: το χειρότερο είδος bug — fallbacks που κρύβουν προβλήματα

### Στρατηγικά
- **Πρώτα backend, μετά frontend**: το frontend καλεί το backend, όχι αντίστροφα
- **Premature optimization is the root of all evil**: μην βελτιστοποιείς πριν δεις πραγματικά προβλήματα
- **YAGNI** (You Aren't Gonna Need It): μην χτίζεις features που δεν χρειάζεσαι ακόμα
- **Observation > Assumption**: πρώτα μάζεψε δεδομένα, μετά αποφάσισε
- **Read the diff, don't just paste**: όταν παίρνεις κώδικα από AI, **διάβασέ τον** πριν τρέξεις
- **Schema drift**: όταν δύο μέρη του κώδικα έχουν διαφορετική αντίληψη για το ίδιο πράγμα

---

## Πιθανά μελλοντικά prompt improvements

(Backlog για όταν τρέξω voice/εικόνες με πραγματικά inputs)

- [ ] Καλύτερες οδηγίες για checklist vs ξεχωριστά tasks
- [ ] Description rules (πάντα ή μόνο όταν χρειάζεται)
- [ ] Voice transcript quirks (pauses, "ε...", επαναλήψεις)
- [ ] Image OCR context (typos, σπασμένα line breaks)
- [ ] Mixed language inputs ("ραντεβού στο doctor αύριο at 3pm")
- [ ] Priority logic refinement
- [ ] Επαναληπτικά tasks ("κάθε Δευτέρα στο γυμναστήριο")

---

## Σημειώσεις debug

- **Record IDs δεν φαίνονται στο grid view** του Airtable. Για να τα δω, ή κάνω expand σε record (URL δείχνει id), ή προσθέτω προσωρινό formula field `RECORD_ID()`.
- **Single select options πρέπει να υπάρχουν εκ των προτέρων** στο Airtable. Το token δεν μπορεί να δημιουργήσει νέες (security feature). Αν προσθέσω νέα κατηγορία/priority, πρέπει να την προσθέσω χειροκίνητα.

---

## Επόμενο βήμα τώρα

**FastAPI Wrapper**. Μετατροπή του τρέχοντος engine σε HTTP API.

Συγκεκριμένα:
1. Νέο αρχείο `main.py` με FastAPI app
2. POST /extract — δέχεται raw text, επιστρέφει saved tasks
3. GET /tasks — επιστρέφει όλα τα tasks
4. PATCH /tasks/{id} — ενημερώνει task (approval, complete)
5. Έλεγχος μέσω auto-generated /docs page

Αυτό προετοιμάζει το backend για το frontend που έρχεται.