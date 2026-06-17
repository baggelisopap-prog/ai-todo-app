
**Started:** May 13, 2026

## The Vision
An intelligent, frictionless data pipeline that converts messy, unstructured human inputs (voice transcripts, typos, chaotic text) into strictly validated, perfectly organized database records. The system acts as an invisible digital assistant, requiring zero manual data entry from the user.

## The Tech Stack
* **Language:** Python 3.12+
* **AI Engine:** Google Gemini 2.5 Flash (`google-genai` SDK)
* **Data Structuring & Validation:** Pydantic (Strict Type Safety & Logic Validation)
* **Future Database:** Airtable (Headless CMS)
* **Future Web API:** FastAPI
* **Environment Management:** `python-dotenv`

## Project Architecture
```text
/Ai_To_do_app/
├── .env              <-- API Keys (Ignored by version control)
├── venv/             <-- Isolated Python Environment 
├── models.py         <-- The Foundation: Pydantic schemas (Data Layer)
├── test_ai.py        <-- The Engine: AI extraction and retry logic (Logic Layer)
└── README.md         <-- Project documentation

* .\venv\Scripts\Activate.ps1  εντολή για κάθε φορά