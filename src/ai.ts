import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

interface Bookmark {
  page: number;
  label: string;
  category: 'sections' | 'images' | 'tables' | 'references';
}

export const analyzeDocument = async (filePath: string): Promise<Bookmark[]> => {
  try {
    let text = '';
    
    try {
      const { stdout } = await execAsync(`pdftotext "${filePath}" -`);
      text = stdout;
    } catch (error) {
      console.log('pdftotext not available, using basic extraction');
      const buffer = fs.readFileSync(filePath);
      text = buffer.toString('utf8', 0, Math.min(buffer.length, 50000));
    }

    if (!text || text.length < 100) {
      console.log('Could not extract text, using mock bookmarks');
      return generateMockBookmarks();
    }

    console.log(`Extracted ${text.length} characters from PDF`);
    console.log('First 500 chars of extracted text:', text.substring(0, 500));

    const prompt = `You are analyzing a PDF document. This could be a resume, report, research paper, manual, or any type of document.

Extract bookmarks that should be created for this document. Look for major sections like:
- Main sections (Introduction, Summary, Chapters, Experience, Education, Skills, etc.)
- Images/Figures (Charts, Diagrams, Photos, etc.)
- Tables (Data tables, Financial tables, etc.)
- References (Bibliography, Citations, Appendix, etc.)

Based on the content below, generate bookmarks in JSON format. Each bookmark should have:
- page: the page number (estimate based on content position, start from 1)
- label: a clear descriptive label
- category: one of ["sections", "images", "tables", "references"]

Return ONLY a JSON array, no other text or explanation.

Document content:
${text.substring(0, 10000)}

Return format example:
[
  {"page": 1, "label": "Executive Summary", "category": "sections"},
  {"page": 3, "label": "Work Experience", "category": "sections"},
  {"page": 5, "label": "Skills Chart", "category": "images"}
]`;

    // New SDK call
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

const responseText = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';

if (!responseText) {
  console.log('No response from AI, using mock bookmarks');
  return generateMockBookmarks();
}

console.log('AI Response:', responseText);

const cleanedText = responseText
  .replace(/```json\n?/g, '')
  .replace(/```\n?/g, '')
  .trim();
const bookmarks: Bookmark[] = JSON.parse(cleanedText);
    return bookmarks;
  } catch (error) {
    console.error('AI analysis error:', error);
    return generateMockBookmarks();
  }
};

const generateMockBookmarks = (): Bookmark[] => {
  const templates = [
    { label: 'Introduction', category: 'sections' as const },
    { label: 'Main Content', category: 'sections' as const },
    { label: 'Charts and Graphs', category: 'images' as const },
    { label: 'Data Tables', category: 'tables' as const },
    { label: 'References', category: 'references' as const },
  ];

  return templates.map((template, idx) => ({
    page: (idx + 1) * 5,
    label: template.label,
    category: template.category,
  }));
};