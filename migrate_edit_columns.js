// Migration script to add edit tracking columns to Surveys table
import { connectDb } from './db.js';

async function migrate() {
  try {
    console.log('Starting migration: Adding edit tracking columns...');
    const pool = await connectDb();
    
    // Check if isEdited column exists
    const checkIsEdited = await pool.request().query(`
      SELECT * FROM sys.columns 
      WHERE object_id = OBJECT_ID(N'[dbo].[Surveys]') AND name = 'isEdited'
    `);
    
    if (checkIsEdited.recordset.length === 0) {
      console.log('Adding isEdited column...');
      await pool.request().query(`
        ALTER TABLE Surveys ADD isEdited BIT DEFAULT 0 NOT NULL
      `);
      console.log('✓ Added isEdited column');
    } else {
      console.log('✓ isEdited column already exists');
    }
    
    // Check if editedAt column exists
    const checkEditedAt = await pool.request().query(`
      SELECT * FROM sys.columns 
      WHERE object_id = OBJECT_ID(N'[dbo].[Surveys]') AND name = 'editedAt'
    `);
    
    if (checkEditedAt.recordset.length === 0) {
      console.log('Adding editedAt column...');
      await pool.request().query(`
        ALTER TABLE Surveys ADD editedAt DATETIME NULL
      `);
      console.log('✓ Added editedAt column');
    } else {
      console.log('✓ editedAt column already exists');
    }
    
    // Update existing records
    console.log('Updating existing records...');
    const result = await pool.request().query(`
      UPDATE Surveys SET isEdited = 0 WHERE isEdited IS NULL
    `);
    console.log(`✓ Updated ${result.rowsAffected[0]} existing records`);
    
    console.log('\n✅ Migration complete! Edit tracking columns are ready.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error(err);
    process.exit(1);
  }
}

migrate();
