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
        const imageUrls = survey.images.split(',').map(filename => {
          const trimmed = filename.trim();
          if (trimmed.startsWith('http')) {
            // Check if it's a double URL and fix it
            const doubleUrlPattern = /https:\/\/storage\.googleapis\.com\/[^\/]+\/uploads\/(https:\/\/storage\.googleapis\.com\/.+)/;
            const match = trimmed.match(doubleUrlPattern);
            if (match) return match[1]; // Extract the correct URL
            return trimmed; // Already correct
          }
          return `https://storage.googleapis.com/greivance-app2.firebasestorage.app/uploads/${trimmed}`;
        }).filter(url => url).join(',');
        updates.push(`images = '${imageUrls}'`);
      }

      // Update owner images
      for (let i = 1; i <= 5; i++) {
        const field = `owner${i}_image`;
        if (survey[field]) {
          const trimmed = survey[field].trim();
          if (trimmed.startsWith('http')) {
            // Check if it's a double URL and fix it
            const doubleUrlPattern = /https:\/\/storage\.googleapis\.com\/[^\/]+\/uploads\/(https:\/\/storage\.googleapis\.com\/.+)/;
            const match = trimmed.match(doubleUrlPattern);
            if (match) {
              updates.push(`${field} = '${match[1]}'`); // Extract the correct URL
            }
            // If not double, leave as-is
          } else {
            updates.push(`${field} = 'https://storage.googleapis.com/greivance-app2.firebasestorage.app/uploads/${trimmed}'`);
          }
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