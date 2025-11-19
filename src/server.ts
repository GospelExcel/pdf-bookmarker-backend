import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

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
    { label: "Medical Records – Radiology", category: "medical_radiology" },
    { label: "CT Scan Results", category: "medical_radiology" },
    { label: "MRI Report", category: "medical_radiology" },
    { label: "X-Ray Images", category: "medical_radiology" },
    { label: "Accident Photos", category: "photos" },
    { label: "Vehicle Damage Photos", category: "photos" },
    { label: "Scene Photos", category: "photos" },
    { label: "Repair Estimate", category: "estimate" },
    { label: "Initial Estimate", category: "estimate" },
    { label: "Supplemental Estimate", category: "estimate" },
    { label: "Police Report", category: "other" },
    { label: "Witness Statements", category: "other" }
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

app.post('/api/upload', upload.single('file'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const document = {
      id: Date.now(),
      filename: req.file.originalname,
      storedFilename: req.file.filename,
      date: new Date().toLocaleDateString(),
      status: 'processing'
    };

    // Simulate processing delay then generate bookmarks
    setTimeout(() => {
      console.log(`Processing complete for: ${document.filename}`);
    }, 3000);

    res.json({
      message: 'File uploaded successfully',
      document
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.post('/api/process/:documentId', (req: Request, res: Response) => {
  try {
    const { documentId } = req.params;
    const bookmarks = generateMockBookmarks('');

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

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});