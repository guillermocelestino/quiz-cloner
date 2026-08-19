const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:5432/app_db' });

async function debugGeneration() {
  console.log('=== LATEST EXAM PREPS ===');
  const preps = await pool.query('SELECT * FROM exam_preps ORDER BY created_at DESC LIMIT 3');
  console.log(preps.rows);

  console.log('\n=== LATEST EXAMS ===');
  const exams = await pool.query('SELECT * FROM exams ORDER BY created_at DESC LIMIT 3');
  console.log(exams.rows);

  console.log('\n=== LATEST JOBS ===');
  const jobs = await pool.query('SELECT * FROM jobs ORDER BY created_at DESC LIMIT 5');
  console.log(jobs.rows);

  console.log('\n=== LATEST QUESTIONS ===');
  const questions = await pool.query('SELECT * FROM questions ORDER BY created_at DESC LIMIT 5');
  console.log(questions.rows);

  if (exams.rows.length > 0) {
    const latestExam = exams.rows[0];
    console.log('\n=== LATEST EXAM STATS / FAILURE REASON ===');
    console.log('Stats:', JSON.stringify(latestExam.stats, null, 2));
    console.log('Failure Reason:', latestExam.failure_reason);
  }

  await pool.end();
}

debugGeneration().catch(console.error);
