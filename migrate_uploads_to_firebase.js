import admin from 'firebase-admin';// The migration script has been removed from the active repository location

import fs from 'fs';// to avoid accidental execution. A backup of the original migration script is

import path from 'path';// available at `backup/migrate_uploads_to_firebase.js`.

import dotenv from 'dotenv';

// If you want to run a migration in the future:

dotenv.config();// 1) Review and copy the file from backup/ to backend/migrate_uploads_to_firebase.js

// 2) Ensure you have a Firebase service account and set FIREBASE_SERVICE_ACCOUNT

// Firebase Admin initialization//    or FIREBASE_SERVICE_ACCOUNT_JSON in the environment.

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) : (process.env.FIREBASE_SERVICE_ACCOUNT_PATH ? require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH) : null);// 3) Run: node backend/migrate_uploads_to_firebase.js

let firebaseStorage = null;

if (serviceAccount) {console.log('Migration script removed. See backup/migrate_uploads_to_firebase.js for the original.');

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'greivance-app2.firebasestorage.app'
  });
  firebaseStorage = admin.storage();
} else {
  console.error('Firebase service account not configured.');
  process.exit(1);
}

// Helper to upload file to Firebase Storage
async function uploadToFirebase(filePath, folder = 'uploads') {
  if (!firebaseStorage) throw new Error('Firebase not initialized');
  const bucket = firebaseStorage.bucket();
  const fileName = path.basename(filePath);
  const fileRef = bucket.file(`${folder}/${fileName}`);
  await fileRef.save(fs.readFileSync(filePath), {
    metadata: {
      contentType: getContentType(fileName),
    },
  });
  await fileRef.makePublic();
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${folder}/${fileName}`;
  return publicUrl;
}

function getContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return types[ext] || 'application/octet-stream';
}

// Migration function
async function migrateUploads() {
  const uploadsDir = './uploads';
  if (!fs.existsSync(uploadsDir)) {
    console.log('Uploads directory does not exist');
    return;
  }

  const files = fs.readdirSync(uploadsDir);
  console.log(`Found ${files.length} files to migrate`);

  for (const file of files) {
    const filePath = path.join(uploadsDir, file);
    if (fs.statSync(filePath).isFile()) {
      try {
        console.log(`Uploading ${file}...`);
        const url = await uploadToFirebase(filePath);
        console.log(`Uploaded ${file} to ${url}`);
      } catch (error) {
        console.error(`Failed to upload ${file}:`, error);
      }
    }
  }

  console.log('Migration completed');
}

// Run migration
migrateUploads().catch(console.error);