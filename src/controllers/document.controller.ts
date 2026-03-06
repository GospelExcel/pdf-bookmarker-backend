import { Response } from 'express';
import fs from 'fs';
import pool from '../db';
import { uploadToS3, getDownloadUrl } from '../s3';
import { analyzeDocument } from '../ai';
import { AuthRequest } from '../types';

export const uploadDocument = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const result = await pool.query(
      'INSERT INTO documents (filename, stored_filename, status, user_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.file.originalname, req.file.filename, 'processing', req.userId]
    );

    const document = result.rows[0];

    const s3Key = `uploads/${document.stored_filename}`;
    await uploadToS3(req.file.path, s3Key);

    res.json({
      message: 'File uploaded successfully',
      document: {
        id: document.id,
        filename: document.filename,
        storedFilename: document.stored_filename,
        date: new Date(document.date_uploaded).toLocaleDateString(),
        status: document.status
      }
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed' });
  }
};

export const processDocument = async (req: AuthRequest, res: Response) => {
  try {
    const { documentId } = req.params;

    const docResult = await pool.query(
      'SELECT stored_filename FROM documents WHERE id = $1 AND user_id = $2',
      [documentId, req.userId]
    );

    if (docResult.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const storedFilename = docResult.rows[0].stored_filename;
    const filePath = `uploads/${storedFilename}`;

    let bookmarks;
    if (fs.existsSync(filePath)) {
      bookmarks = await analyzeDocument(filePath);
    } else {
      console.log('File not found locally, using AI with S3 fallback');
      bookmarks = await analyzeDocument(filePath);
    }

    for (const bookmark of bookmarks) {
      await pool.query(
        'INSERT INTO bookmarks (document_id, page_number, label, category) VALUES ($1, $2, $3, $4)',
        [documentId, bookmark.page, bookmark.label, bookmark.category]
      );
    }

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
};

export const listDocuments = async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT * FROM documents WHERE user_id = $1 ORDER BY date_uploaded DESC',
      [req.userId]
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
};

export const downloadDocument = async (req: AuthRequest, res: Response) => {
  try {
    const { documentId } = req.params;

    const result = await pool.query(
      'SELECT stored_filename FROM documents WHERE id = $1 AND user_id = $2',
      [documentId, req.userId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const storedFilename = result.rows[0].stored_filename;
    const s3Key = `uploads/${storedFilename}`;
    const downloadUrl = await getDownloadUrl(s3Key);

    res.json({ downloadUrl });
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
};
