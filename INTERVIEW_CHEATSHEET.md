# BookSmart AI - Interview Cheat Sheet

## One-Liner Pitch
"BookSmart AI is a full-stack app that uses Google's Gemini AI to automatically generate navigation bookmarks for PDF documents."

---

## PROCESS WALKTHROUGH (End-to-End)

### Step 1: User Uploads PDF
**Frontend** ([App.tsx:40-83](src/App.tsx#L40-L83))
```
User clicks upload → selects PDF → handleFileUpload() triggers
```

**What happens:**
1. File wrapped in FormData
2. POST request to `/api/upload`
3. UI shows "Uploading and analyzing..." spinner
4. On success, document added to local state with status "processing"

---

### Step 2: Backend Receives Upload
**Backend** ([server.ts:89-124](src/server.ts#L89-L124))

```
Request → Multer middleware → Save to disk → Upload to S3 → Save to DB
```

**Detailed flow:**
1. **Multer middleware** validates file is PDF, max 50MB
2. **Saves locally** to `uploads/` folder with unique timestamp filename
3. **Inserts DB record**: `documents` table (filename, stored_filename, status='processing')
4. **Uploads to S3**: `uploads/{stored_filename}`
5. **Returns** document object to frontend

**Key code:**
```typescript
// Multer saves file locally first
const storage = multer.diskStorage({...})

// Then we upload to S3
await uploadToS3(req.file.path, s3Key);

// Insert into PostgreSQL
await pool.query('INSERT INTO documents...')
```

---

### Step 3: AI Processing Triggered
**Frontend** ([App.tsx:58-75](src/App.tsx#L58-L75))
```
3-second delay → POST /api/process/:documentId
```

**Why the delay?** Gives user feedback that upload succeeded before processing begins. (In production, could use WebSockets or polling instead.)

---

### Step 4: Backend Processes Document
**Backend** ([server.ts:126-180](src/server.ts#L126-L180)) → ([ai.ts:18-89](src/ai.ts#L18-L89))

```
Get file path → Extract text → Send to Gemini AI → Parse response → Save bookmarks → Update status
```

**Detailed flow:**

1. **Fetch document** from DB by ID
2. **Check if file exists** locally (still in uploads/ folder)
3. **Extract text** from PDF:
   - Primary: `pdftotext` command (system utility)
   - Fallback: Raw buffer read (first 50KB)
4. **Send to Gemini AI** with structured prompt
5. **Parse JSON response** into bookmark array
6. **Insert bookmarks** into `bookmarks` table
7. **Update document** status to "completed"

**The AI Prompt** ([ai.ts:39-62](src/ai.ts#L39-L62)):
```
"You are analyzing a PDF document...
Extract bookmarks for major sections like:
- Main sections (Introduction, Summary, etc.)
- Images/Figures
- Tables
- References

Return ONLY a JSON array..."
```

**AI Response Format:**
```json
[
  {"page": 1, "label": "Executive Summary", "category": "sections"},
  {"page": 3, "label": "Work Experience", "category": "sections"},
  {"page": 5, "label": "Skills Chart", "category": "images"}
]
```

---

### Step 5: Frontend Updates UI
**Frontend** ([App.tsx:61-71](src/App.tsx#L61-L71))

```
Receive bookmarks → Update document in state → Status changes to "completed"
```

The table now shows:
- Status: "Completed" (green badge)
- Bookmarks: count of detected bookmarks
- "View Details" button enabled

---

### Step 6: User Views Details
**Frontend** ([App.tsx:276-368](src/App.tsx#L276-L368))

Clicking "View Details" shows:
- Document metadata (filename, date, status)
- Table of all bookmarks (page, label, category)
- Download button

---

### Step 7: User Downloads PDF
**Frontend** ([App.tsx:312-326](src/App.tsx#L312-L326)) → **Backend** ([server.ts:217-239](src/server.ts#L217-L239))

```
Click Download → GET /api/download/:id → Generate presigned URL → Open in new tab
```

**What's a presigned URL?**
- Temporary S3 access link (expires in 1 hour)
- User downloads directly from S3, not through our server
- Secure: no permanent public access to bucket

---

## DATABASE SCHEMA

```
┌─────────────────────────────────────────────────────────┐
│ documents                                               │
├─────────────────────────────────────────────────────────┤
│ id              SERIAL PRIMARY KEY                      │
│ filename        VARCHAR       (original name)           │
│ stored_filename VARCHAR       (unique name with timestamp)│
│ status          VARCHAR       ('processing'|'completed')│
│ date_uploaded   TIMESTAMP                               │
└─────────────────────────────────────────────────────────┘
                           │
                           │ 1:many
                           ▼
┌─────────────────────────────────────────────────────────┐
│ bookmarks                                               │
├─────────────────────────────────────────────────────────┤
│ id              SERIAL PRIMARY KEY                      │
│ document_id     INTEGER REFERENCES documents(id)        │
│ page_number     INTEGER                                 │
│ label           VARCHAR                                 │
│ category        VARCHAR       (sections|images|tables|references)│
└─────────────────────────────────────────────────────────┘
```

---

## QUICK ANSWERS TO COMMON QUESTIONS

### "Why use S3 instead of storing files in the database?"
- PDFs can be large (up to 50MB each)
- S3 is optimized for file storage, cheaper at scale
- Presigned URLs let users download directly from S3, reducing server load
- Separates concerns: DB for metadata, S3 for binary files

### "Why PostgreSQL?"
- Relational data (documents have many bookmarks)
- ACID compliance for data integrity
- Familiar, battle-tested, great tooling

### "How does the AI know what bookmarks to create?"
- Extract text from PDF using `pdftotext`
- Send first 10,000 characters to Gemini with a structured prompt
- AI identifies sections, figures, tables, references
- Returns JSON array that we parse and store

### "What happens if the AI fails?"
- Fallback to mock bookmarks ([ai.ts:85-88](src/ai.ts#L85-L88))
- App still works, just with generic bookmarks
- Graceful degradation pattern

### "Why Multer?"
- Standard Express middleware for handling multipart/form-data
- Handles file validation (type, size)
- Manages temp file storage before S3 upload

### "How do you handle large files?"
- Multer has 50MB limit configured
- Files saved to disk (not memory) to avoid RAM issues
- Only first 10KB of text sent to AI (enough for analysis)

---

## ARCHITECTURE DIAGRAM (draw if asked)

```
┌──────────────────────────────────────────────────────────────────┐
│                         USER BROWSER                              │
│                     React + TypeScript + Vite                     │
└──────────────────────────────┬───────────────────────────────────┘
                               │ HTTP/REST
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      EXPRESS.JS SERVER                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │
│  │   Multer    │  │   Routes    │  │    CORS     │               │
│  │ (file upload)│  │  /api/*    │  │ middleware  │               │
│  └─────────────┘  └─────────────┘  └─────────────┘               │
└───────┬─────────────────┬────────────────────┬───────────────────┘
        │                 │                    │
        ▼                 ▼                    ▼
┌───────────────┐  ┌───────────────┐    ┌───────────────┐
│    AWS S3     │  │  PostgreSQL   │    │  Gemini AI    │
│  (PDF files)  │  │  (metadata)   │    │  (analysis)   │
└───────────────┘  └───────────────┘    └───────────────┘
```

---

## FILE REFERENCE

| File | What to mention |
|------|-----------------|
| `server.ts` | "Main entry point, Express routes, Multer config" |
| `db.ts` | "PostgreSQL connection pool using pg library" |
| `s3.ts` | "AWS SDK v3, upload and presigned URL generation" |
| `ai.ts` | "Gemini integration, text extraction, prompt engineering" |
| `App.tsx` | "Single-page React app, all views in one component" |
| `api.ts` | "Axios wrapper for backend calls" |

---

## CONFIDENCE BOOSTERS

- "I built this to learn full-stack development with AI integration"
- "It demonstrates cloud services (S3), database design, and API development"
- "The AI prompt engineering was iterative - I refined it to get structured JSON output"
- "I chose these technologies because [PostgreSQL for relational data, S3 for scalable storage, Gemini for cost-effective AI]"
