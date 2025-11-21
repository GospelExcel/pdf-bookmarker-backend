import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pool from './db';
import { uploadToS3, getDownloadUrl } from './s3';
import { analyzeDocument } from './ai';


const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Mock bookmark generation (our fake AI)
const generateMockBookmarks = (filename: string) => {
    const templates = [
    { label: "Executive Summary", category: "sections" },
    { label: "Introduction", category: "sections" },
    { label: "Main Content", category: "sections" },
    { label: "Methodology", category: "sections" },
    { label: "Charts and Graphs", category: "images" },
    { label: "Diagrams", category: "images" },
    { label: "Data Tables", category: "tables" },
    { label: "Financial Summary", category: "tables" },
    { label: "References", category: "references" },
    { label: "Appendix", category: "references" }
    ];

  const count = Math.floor(Math.random() * 8) + 3;
  const bookmarks = [];
  const usedIndices = new Set();

  for (let i = 0; i < count; i++) {
    let idx;
    do {
      idx = Math.floor(Math.random() * templates.length);
    } while (usedIndices.has(idx) && usedIndices.size < templates.length);

    usedIndices.add(idx);
    bookmarks.push({
      page: Math.floor(Math.random() * 100) + 1,
      label: templates[idx].label,
      category: templates[idx].category
    });
  }

  return bookmarks.sort((a, b) => a.page - b.page);
};

// Routes
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Backend is running!' });
});

app.post('/api/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Insert document into database
    const result = await pool.query(
      'INSERT INTO documents (filename, stored_filename, status) VALUES ($1, $2, $3) RETURNING *',
      [req.file.originalname, req.file.filename, 'processing']
    );

    const document = result.rows[0];

    // Upload to S3
    const s3Key = `uploads/${document.stored_filename}`;
    await uploadToS3(req.file.path, s3Key);

    const responseDoc = {
        id: document.id,
        filename: document.filename,
        storedFilename: document.stored_filename,
        date: new Date(document.date_uploaded).toLocaleDateString(),
        status: document.status
    };

    res.json({
        message: 'File uploaded successfully',
        document: responseDoc
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.post('/api/process/:documentId', async (req: Request, res: Response) => {
  try {
    const { documentId } = req.params;
    
    // Get document info from database
    const docResult = await pool.query(
      'SELECT stored_filename FROM documents WHERE id = $1',
      [documentId]
    );

    if (docResult.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const storedFilename = docResult.rows[0].stored_filename;
    const filePath = `uploads/${storedFilename}`;

    // Analyze with AI if file exists locally
    let bookmarks;
    if (fs.existsSync(filePath)) {
      console.log('Analyzing document with AI...');
      bookmarks = await analyzeDocument(filePath);
      
      // Clean up local file after processing
    //   fs.unlinkSync(filePath);
    } else {
      // File already cleaned up, use mock
      console.log('File not found locally, using mock bookmarks');
      bookmarks = generateMockBookmarks('');
    }

    // Insert bookmarks into database
    for (const bookmark of bookmarks) {
      await pool.query(
        'INSERT INTO bookmarks (document_id, page_number, label, category) VALUES ($1, $2, $3, $4)',
        [documentId, bookmark.page, bookmark.label, bookmark.category]
      );
    }

    // Update document status
    await pool.query(
      'UPDATE documents SET status = $1 WHERE id = $2',
      ['completed', documentId]
    );

    res.json({
      documentId: parseInt(documentId),
      status: 'completed',
      bookmarks
    });
  } catch (error) {
    console.error('Processing error:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
});

app.get('/api/documents', async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM documents ORDER BY date_uploaded DESC'
    );

    const documents = await Promise.all(
      result.rows.map(async (doc) => {
        const bookmarksResult = await pool.query(
          'SELECT * FROM bookmarks WHERE document_id = $1 ORDER BY page_number',
          [doc.id]
        );

        return {
          id: doc.id,
          filename: doc.filename,
          storedFilename: doc.stored_filename,
          date: new Date(doc.date_uploaded).toLocaleDateString(),
          status: doc.status,
          bookmarks: bookmarksResult.rows.map(b => ({
            page: b.page_number,
            label: b.label,
            category: b.category
          }))
        };
      })
    );

    res.json(documents);
  } catch (error) {
    console.error('Fetch documents error:', error);
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

app.get('/api/download/:documentId', async (req: Request, res: Response) => {
  try {
    const { documentId } = req.params;

    const result = await pool.query(
      'SELECT stored_filename FROM documents WHERE id = $1',
      [documentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const storedFilename = result.rows[0].stored_filename;
    const s3Key = `uploads/${storedFilename}`;
    const downloadUrl = await getDownloadUrl(s3Key);

    res.json({ downloadUrl });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});