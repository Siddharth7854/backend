// Script to check actual timestamp values in database
import { connectDb } from './db.js';

async function checkTimestamps() {
  try {
    console.log('Fetching latest survey timestamps...\n');
    const pool = await connectDb();
    
    const result = await pool.request().query(`
      SELECT TOP 5 
        id, 
        name, 
        createdAt,
        GETDATE() as ServerCurrentTime,
        DATEDIFF(HOUR, createdAt, GETDATE()) as HoursDifference
      FROM Surveys 
      ORDER BY id DESC
    `);
    
    console.log('Latest surveys:');
    console.log('================');
    result.recordset.forEach(row => {
      console.log(`\nID: ${row.id}`);
      console.log(`Name: ${row.name}`);
      console.log(`Created At: ${row.createdAt}`);
      console.log(`Server Time: ${row.ServerCurrentTime}`);
      console.log(`Hours Ago: ${row.HoursDifference} hours`);
    });
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkTimestamps();
