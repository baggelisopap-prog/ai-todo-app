# AI To-Do App — Progress Tracker

> **Προσωπικό αρχείο** για να ξέρω πού είμαι και τι μένει.
> Updated: μετά το Voice MVP

---

## Τι έχω χτίσει μέχρι τώρα

AI-powered to-do app που:
- Δέχεται **φυσική γλώσσα κειμένου** (ελληνικά/αγγλικά)
- Δέχεται **φωνητικά μηνύματα** (multimodal Gemini)
- Εξάγει tasks με AI (Gemini 2.5 Flash)
- Αποθηκεύει σε Airtable
- Web app με πλήρες React frontend
- Approval flow (pending → approved → completed → rejected)
- Inline editing όλων των fields
- Filters & sorting

**Στόχος**: AI Architect career path. Project ως learning + portfolio + προσωπική χρήση.

---

## Αρχιτεκτονική

```
┌─────────────────────────────────────────┐
│   FRONTEND (React + Vite + Tailwind)    │  ✅
│   localhost:5173                        │
└──────────────────┬──────────────────────┘
                   ↕ HTTP (fetch)
┌─────────────────────────────────────────┐
│   API LAYER (FastAPI)                   │  ✅
│   localhost:8000                        │
│   5 endpoints                           │
└──────────────────┬──────────────────────┘
                   ↕
┌─────────────────────────────────────────┐
│   SERVICE LAYER (services.py)           │  ✅
│   Business logic - TaskService          │
│   - extract_and_save_from_text          │
│   - extract_and_save_from_audio (NEW)   │
└──────┬──────────────────────────┬───────┘
       ↕                          ↕
┌──────────────────┐   ┌──────────────────────┐
│  AI ENGINE       │   │  REPOSITORY          │
│  - text          │   │  Airtable             │
│  - audio (NEW)   │   │                      │
└──────────────────┘   └──────────────────────┘
```

---

## Backend Endpoints

| Endpoint | Method | Σκοπός |
|---|---|---|
| `/health` | GET | Health check |
| `/extract` | POST | Text → tasks |
| `/extract-voice` | POST | Audio → tasks (NEW) |
| `/tasks` | GET | List all tasks |
| `/tasks/{id}` | PATCH | Update task |

---

## Airtable Schema (13 columns)

| Στήλη | Τύπος |
|---|---|
| task_name | Single line text |
| description | Long text |
| category | Single select (Business/Personal/Unknown) |
| priority | Single select (P1/P2/P3) |
| due_date | Date |
| due_time | Single line text |
| checklist | Long text (JSON) |
| approval_status | Checkbox |
| is_completed | Checkbox |
| is_rejected | Checkbox (NEW) |
| created_time | Created time (auto) |
| ai_suggested_category | Single select |
| ai_suggested_priority | Single select |

---

## Phases — Status

### ✅ Phase 0 — Hardening
- Retry με exponential backoff
- Error handling
- Pydantic validation

### ✅ Phase 1 — Backend MVP
- Pydantic schemas
- AI extraction (text)
- Repository layer
- Service layer
- FastAPI με 4 endpoints
- CORS

### ✅ Phase 2 — Frontend MVP
- **F1**: Setup + API client
- **F2**: TaskCard + TaskList με badges
- **F3**: FilterBar (categories, sort, show completed)
- **F4**: NewTaskInput (textarea + Ctrl+Enter)
- **F5**: Approve/Complete/Uncomplete + Toast
- **F6**: Expandable cards with inline editing
- **Single-mode TaskCard refactor** (no view/edit toggle, direct edit)
- **Reject button + soft delete**
- Reject available σε όλα τα states (not just pending)

### ✅ Phase 3 — Voice MVP
- **V1**: Backend `/extract-voice` endpoint με multimodal Gemini
- **V2**: Frontend voice button (round, 3 states, MediaRecorder API)
- **Δοκιμασμένο και working** (όταν mic δουλεύει 😄)

### ⏳ Phase 4 — Deployment (ΕΠΟΜΕΝΟ)
- [ ] SSH setup στο Oracle server
- [ ] Backend deployment (uvicorn + nginx + systemd)
- [ ] Frontend build + deploy
- [ ] Subdomain + DNS
- [ ] HTTPS με Let's Encrypt
- [ ] Basic Auth
- [ ] Environment variables στο server
- [ ] Git setup
- [ ] (Optional) CI/CD με GitHub Actions

### ⏳ Phase 5 — Polish & Iteration
- [ ] F7: Polish session (χρώματα, γραμματοσειρές, mobile)
- [ ] AI prompt iteration με βάση failed extractions
- [ ] Voice V3: Upload audio file (πέρα από recording)
- [ ] Καλύτερο error messages (π.χ. "click 🔒 to allow mic")

### ⏳ Phase 6 — Advanced features (backlog)
- [ ] Image input (POST /extract-image)
- [ ] Calendar view με date filters
- [ ] Date filters (Today/Tomorrow/This week/Overdue)
- [ ] Interactive checklist checkboxes
- [ ] Settings panel (preferences)
- [ ] AI learning loop (use rejected data για prompt improvement)

### ⏳ Phase 7 — Multi-user (αν αποφασίσεις)
- [ ] Migration σε Supabase
- [ ] Full authentication
- [ ] Data isolation
- [ ] Onboarding

---

## Τι θα κάνουμε στο deployment session

**Session 1: Backend deployment**
1. SSH στο Oracle server
2. Update Linux packages
3. Install Python 3.11+
4. Clone project (git setup)
5. Setup venv
6. .env με production secrets
7. Test που τρέχει
8. Setup systemd service για uvicorn
9. Test ότι ξεκινάει auto

**Session 2: Frontend deployment + Domain**
1. Build του React app (`npm run build`)
2. Install nginx
3. Configure nginx (serve frontend + reverse proxy backend)
4. Subdomain DNS setup
5. Let's Encrypt για HTTPS
6. CORS update (από localhost σε subdomain)
7. Test από κινητό σου

**Session 3 (optional): CI/CD**
1. GitHub repo (αν δεν υπάρχει)
2. GitHub Actions workflow
3. `git push` = automatic deploy

---

## Πώς τρέχω το app τοπικά

### Backend (Terminal 1)
```bash
.\venv\Scripts\activate
uvicorn main:app --reload
```
`http://localhost:8000/docs`

### Frontend (Terminal 2)
```bash
cd frontend
npm run dev
```
`http://localhost:5173`

---

## Σημαντικά πράγματα που έμαθα

### Voice/Multimodal AI
- Gemini Flash υποστηρίζει audio απευθείας (multimodal)
- 32 tokens per second audio
- Free tier επαρκεί υπεραρκετά (1.500 req/day)
- MediaRecorder API στο browser για recording
- Audio σε WebM/Opus format δουλεύει στο Gemini
- **Layer 0 debugging**: ελέγξε hardware/settings πριν υποθέσεις bug
  (το mic μπορεί να είναι σε σίγαση 😅)

### Αρχιτεκτονικά
- Pydantic για ΟΛΑ τα boundaries
- Repository Pattern για future migration
- Service Layer για business logic
- Shared system prompt μεταξύ text/audio extraction (DRY)
- Soft delete > hard delete (data preservation για AI learning)

### Workflow με Claude Code
- Specs μπορούν να είναι μεγαλύτερα (multi-file)
- "What stays the same" εξίσου σημαντικό με "what changes"
- Verification steps στο spec (build checks)
- Reporting back instructions
- Architect ρόλος = decisions, scope, reviews
- AI Code Generator ρόλος = implementation

### Στρατηγικά
- Feature creep είναι #1 αιτία project failure
- MVP first, polish later
- YAGNI
- Iterative design με βάση πραγματική χρήση
- Πιο πολλά χαρακτηριστικά != καλύτερο app

---

## Concept clarifications που πρέπει να θυμάμαι

- **LLMs είναι stateless**: δεν "μαθαίνουν" αυτόματα
- **AI learning** χρειάζεται explicit techniques (few-shot, pattern analysis, fine-tuning)
- **Collect data πρώτα**, decide strategy μετά
- **Modern deployment** = `git push` (CI/CD), όχι FTP
- **AI Architect ≠ Developer**: σχεδιάζεις και αποφασίζεις, δεν γράφεις
- **Sound vs Code bugs**: 90% είναι configuration, 10% είναι κώδικας

---

## Decision log (σημαντικές αποφάσεις)

| Decision | Επιλογή | Λόγος |
|---|---|---|
| Database | Airtable τώρα, Supabase αργότερα | MVP simplicity |
| Frontend framework | React + Vite + JS | Όχι TypeScript για αρχάριο |
| State management | Built-in useState | Όχι Redux/Zustand ακόμα |
| Styling | Tailwind CSS v4 | Modern, utility-first |
| Voice STT | Multimodal Gemini | Free tier, ένα service |
| Reject pattern | Soft delete | AI learning preservation |
| Edit pattern | Single mode (always editable) | Λιγότερα clicks |
| Auth | Basic Auth στο deploy | Single user, fast |
| Hosting | Oracle Cloud (έχω ήδη) | Free tier, full control |

---

## Επόμενα βήματα — με σειρά προτεραιότητας

### Άμεσα (αυτή ή επόμενη εβδομάδα)
1. **Deployment στο Oracle** (Session 1-2)
2. **Test στο κινητό σου** (πραγματική χρήση)
3. **Καταγραφή bugs/issues** από πραγματική χρήση

### Σύντομα (επόμενες 2 εβδομάδες)
4. **Polish session** βάσει feedback
5. **AI prompt iteration** αν χρειάζεται
6. **Voice V3**: Upload audio file

### Μεσοπρόθεσμα (επόμενος μήνας)
7. **Image input** (αν θες ακόμα)
8. **Calendar view** + date filters

### Μακροπρόθεσμα
9. CRM redesign (αν αποφασίσεις)
10. Multi-user (αν αποφασίσεις)

---

## Σημειώσεις debug (από εμπειρία)

- **Single select options** πρέπει να υπάρχουν στο Airtable εκ των προτέρων
- **Δύο servers** ταυτόχρονα (8000 + 5173)
- **Microphone σε σίγαση** → "0 tasks" voice extraction (1024 byte payload)
- **Browser permissions** για mic χρειάζονται για voice
- **Localhost εξαιρείται** από HTTPS requirement για microphone
- **MediaRecorder** δίνει διαφορετικά formats ανά browser (Gemini τα δέχεται όλα)

---

## Πραγματικότητα προόδου

**Πού είσαι**:
- Λειτουργικό MVP με voice ✅
- Δουλεύει στο localhost ✅
- Δεν είναι online ακόμα ❌
- Δεν χρησιμοποιείται καθημερινά ακόμα ❌

**Εκτιμώμενος χρόνος για κάθε επίπεδο**:

| Επίπεδο | Status | Χρόνος που μένει |
|---|---|---|
| 1: Functional MVP | 95% | 1 polish session |
| 2: Production single-user | 0% | 2-3 sessions deployment |
| 3: Multi-user product | 0% | 2-4 μήνες (αν θες) |

---

## Όταν επιστρέψω

Στείλε στο επόμενο chat:
- "γεια, επιστρέφω"
- Τι σημείωσες από πραγματική χρήση
- Τι σε ενοχλεί περισσότερο
- Πιο feature θες πρώτο

**Επόμενο session: Deployment**