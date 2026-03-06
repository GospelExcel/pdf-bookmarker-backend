import { Request } from 'express';

export interface AuthRequest extends Request {
  userId?: number;
}

export interface Bookmark {
  page: number;
  label: string;
  category: 'sections' | 'images' | 'tables' | 'references';
}
