import { Pool } from 'pg';

const pool = new Pool({
  user: 'gospelexcel',  
  host: 'localhost',
  database: 'pdf_bookmarker',
  password: '',  
});

export default pool;