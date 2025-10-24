import dotenv from 'dotenv';
import sql from 'mssql';
import { connectDb } from './db.js';

dotenv.config();

async function updateDatabaseUrls() {
  try {
    const pool = await connectDb();

    // Get all surveys with images
    const result = await pool.query`SELECT id, images, owner1_image, owner2_image, owner3_image, owner4_image, owner5_image FROM Surveys WHERE images IS NOT NULL AND images != ''`;

    console.log(`Found ${result.recordset.length} surveys to update`);

    for (const survey of result.recordset) {
      const updates = [];

      // Update main images
      if (survey.images) {
        const imageUrls = survey.images.split(',').map(filename =>
          filename.trim() ? `https://storage.googleapis.com/greivance-app2.firebasestorage.app/uploads/${filename.trim()}` : ''
        ).filter(url => url).join(',');
        updates.push(`images = '${imageUrls}'`);
      }

      // Update owner images
      for (let i = 1; i <= 5; i++) {
        const field = `owner${i}_image`;
        if (survey[field]) {
          updates.push(`${field} = 'https://storage.googleapis.com/greivance-app2.firebasestorage.app/uploads/${survey[field]}'`);
        }
      }

      if (updates.length > 0) {
        const query = `UPDATE Surveys SET ${updates.join(', ')} WHERE id = ${survey.id}`;
        await pool.query(query);
        console.log(`Updated survey ${survey.id}`);
      }
    }

    console.log('Database update completed');
    process.exit(0);
  } catch (error) {
    console.error('Error updating database:', error);
    process.exit(1);
  }
}

updateDatabaseUrls();