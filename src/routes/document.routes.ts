import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { upload } from '../config/multer';
import { uploadDocument, processDocument, listDocuments, downloadDocument } from '../controllers/document.controller';

const router = Router();

router.post('/upload', authenticate, upload.single('file'), uploadDocument);
router.post('/process/:documentId', authenticate, processDocument);
router.get('/documents', authenticate, listDocuments);
router.get('/download/:documentId', authenticate, downloadDocument);

export default router;
