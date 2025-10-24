import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { body, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { connectDb } from './db.js';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'secret_dev_change_me';

// Firebase Admin initialization
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) : (process.env.FIREBASE_SERVICE_ACCOUNT_PATH ? require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH) : null);
let firebaseStorage = null;
if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'greivance-app2.firebasestorage.app'
  });
  firebaseStorage = admin.storage();
} else {
  console.warn('Firebase service account not configured. File uploads will fail.');
}

const app = express();
app.use(cors({
  origin: true, // Allow all origins
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With']
}));
// If running behind a proxy (Render, Heroku, etc) enable trust proxy so req.protocol
// reflects the external protocol (https). We still defensively prefer X-Forwarded-Proto
// when constructing URLs below.
app.set('trust proxy', true);
// Increase JSON/urlencoded body size limit to allow larger payloads if needed.
// Multipart uploads should use /api/surveys/upload (multer) and not hit these parsers.
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Ensure uploads dir exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Serve uploaded files statically at /uploads/<filename>
app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
}, express.static(uploadsDir));

// Multer setup for file uploads - using memory storage for Firebase upload
const storage = multer.memoryStorage();
// Allow up to 20 files total (images + ownerImages + documents). Per-field maxCounts are set on upload.fields.
const upload = multer({ storage, limits: { files: 20, fileSize: 10 * 1024 * 1024 } });

// Helper to upload file to Firebase Storage
async function uploadToFirebase(file, folder = 'uploads') {
  if (!firebaseStorage) throw new Error('Firebase not initialized');
  const bucket = firebaseStorage.bucket();
  const fileName = Date.now() + '_' + Math.round(Math.random() * 1e9) + '_' + file.originalname;
  const fileRef = bucket.file(`${folder}/${fileName}`);
  await fileRef.save(file.buffer, {
    metadata: {
      contentType: file.mimetype,
    },
  });
  try {
    await fileRef.makePublic();
    console.log(`Made file public: ${fileRef.name}`);
  } catch (error) {
    console.error(`Failed to make file public: ${fileRef.name}`, error);
  }
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${folder}/${fileName}`;
  console.log(`Uploaded file to Firebase: ${publicUrl}`);
  return publicUrl;
}

// Helper to normalize URLs (fix double Firebase URLs)
function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return url;
  // Handle double Firebase URLs
  const firebasePattern = /https:\/\/storage\.googleapis\.com\/[^\/]+\/uploads\/https:\/\/storage\.googleapis\.com\//;
  const match = url.match(firebasePattern);
  if (match) {
    const start = match.index + match[0].length;
    const corrected = 'https://storage.googleapis.com/' + url.substring(start);
    console.log(`Backend normalized double URL: ${url} -> ${corrected}`);
    return corrected;
  }
  return url;
}

// Ensure Citizens table exists
async function ensureCitizensTable() {
  try {
    const sql = await connectDb();
    // Check if table exists
    const tableCheck = await sql.query`SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Citizens'`;
    if (tableCheck.recordset.length > 0) {
      console.log('Citizens table already exists');
      return;
    }
    // Create table if it doesn't exist
    await sql.query`
      CREATE TABLE Citizens (
        id INT IDENTITY(1,1) PRIMARY KEY,
        name NVARCHAR(255) NOT NULL,
        email NVARCHAR(255) UNIQUE NOT NULL,
        password NVARCHAR(255) NOT NULL,
        ward NVARCHAR(50),
        isAdmin BIT DEFAULT 0,
        createdAt DATETIME DEFAULT GETDATE()
      )
    `;
    console.log('Created Citizens table');
  } catch (err) {
    console.error('ensureCitizensTable error:', err.message);
  }
}

// On startup ensure Citizens table has isAdmin column
async function ensureIsAdminColumn() {
  try {
    const sql = await connectDb();
    const colCheck = await sql.query`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Citizens' AND COLUMN_NAME = 'isAdmin'`;
    if (colCheck.recordset.length === 0) {
      await sql.query`ALTER TABLE Citizens ADD isAdmin BIT DEFAULT 0`;
      console.log('Added isAdmin column to Citizens');
    }
    // Ensure fixed admin exists and is admin
    const adminEmail = 'admin@survey.com';
    const adminPassword = 'admin2026';
    const adminName = 'Admin';
    const adminWard = 'admin';
    const check = await sql.query`SELECT * FROM Citizens WHERE email = ${adminEmail}`;
    if (check.recordset.length === 0) {
      // Hash the fixed admin password before inserting
      const salt = await bcrypt.genSalt(10);
      const hashedAdmin = await bcrypt.hash(adminPassword, salt);
      await sql.query`INSERT INTO Citizens (name, email, password, ward, isAdmin) VALUES (${adminName}, ${adminEmail}, ${hashedAdmin}, ${adminWard}, 1)`;
      console.log('Created fixed admin user');
    } else {
      // If user exists but not admin, set isAdmin. Also ensure password is hashed: if stored password equals plaintext adminPassword, replace with hashed.
      if (!check.recordset[0].isAdmin) {
        await sql.query`UPDATE Citizens SET isAdmin = 1 WHERE email = ${adminEmail}`;
        console.log('Updated existing user to admin');
      }
      const currentPassword = check.recordset[0].password;
      // If the stored password appears to be the plaintext admin password (exact match), replace it with a hashed one.
      if (currentPassword === adminPassword) {
        const salt2 = await bcrypt.genSalt(10);
        const hashedAdmin2 = await bcrypt.hash(adminPassword, salt2);
        await sql.query`UPDATE Citizens SET password = ${hashedAdmin2} WHERE email = ${adminEmail}`;
        console.log('Replaced plaintext admin password with hashed password');
      }
    }
  } catch (err) {
    console.error('ensureIsAdminColumn error:', err.message);
  }
}

// Ensure Surveys table exists
async function ensureSurveysTable() {
  try {
    const sql = await connectDb();
    // Check if table exists
    const tableCheck = await sql.query`SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Surveys'`;
    if (tableCheck.recordset.length > 0) {
      console.log('Surveys table already exists');
      return;
    }
    // Create table if it doesn't exist
    await sql.query`
      CREATE TABLE Surveys (
        id INT IDENTITY(1,1) PRIMARY KEY,
        citizenEmail NVARCHAR(255) NOT NULL,
        mobile NVARCHAR(20),
        name NVARCHAR(255) NOT NULL,
        ward NVARCHAR(50),
        propertyType NVARCHAR(100),
        ownershipType NVARCHAR(255) DEFAULT 'Single Owner',
        numberOfFloors INT,
        plotArea FLOAT,
        builtUpArea FLOAT,
        geoLat FLOAT,
        geoLng FLOAT,
        images NVARCHAR(MAX), -- comma separated filenames or base64 markers for simplicity
        road NVARCHAR(255),
        document1 NVARCHAR(255),
        document2 NVARCHAR(255),
        document3 NVARCHAR(255),
        document4 NVARCHAR(255),
        document5 NVARCHAR(255),
        document6 NVARCHAR(255),
        document7 NVARCHAR(255),
        document8 NVARCHAR(255),
        document9 NVARCHAR(255),
        document10 NVARCHAR(255),
        owner1_image NVARCHAR(255),
        owner2_image NVARCHAR(255),
        owner3_image NVARCHAR(255),
        owner4_image NVARCHAR(255),
        owner5_image NVARCHAR(255),
        owner6_image NVARCHAR(255),
        owner7_image NVARCHAR(255),
        owner8_image NVARCHAR(255),
        owner9_image NVARCHAR(255),
        owner10_image NVARCHAR(255),
        owner1_details NVARCHAR(MAX),
        owner2_details NVARCHAR(MAX),
        owner3_details NVARCHAR(MAX),
        owner4_details NVARCHAR(MAX),
        owner5_details NVARCHAR(MAX),
        owner6_details NVARCHAR(MAX),
        owner7_details NVARCHAR(MAX),
        owner8_details NVARCHAR(MAX),
        owner9_details NVARCHAR(MAX),
        owner10_details NVARCHAR(MAX),
        owner1_aadhaar_doc NVARCHAR(255),
        owner2_aadhaar_doc NVARCHAR(255),
        owner3_aadhaar_doc NVARCHAR(255),
        owner4_aadhaar_doc NVARCHAR(255),
        owner5_aadhaar_doc NVARCHAR(255),
        owner6_aadhaar_doc NVARCHAR(255),
        owner7_aadhaar_doc NVARCHAR(255),
        owner8_aadhaar_doc NVARCHAR(255),
        owner9_aadhaar_doc NVARCHAR(255),
        owner10_aadhaar_doc NVARCHAR(255),
        owner1_pan_doc NVARCHAR(255),
        owner2_pan_doc NVARCHAR(255),
        owner3_pan_doc NVARCHAR(255),
        owner4_pan_doc NVARCHAR(255),
        owner5_pan_doc NVARCHAR(255),
        owner6_pan_doc NVARCHAR(255),
        owner7_pan_doc NVARCHAR(255),
        owner8_pan_doc NVARCHAR(255),
        owner9_pan_doc NVARCHAR(255),
        owner10_pan_doc NVARCHAR(255),
        owner1_other_doc NVARCHAR(255),
        owner2_other_doc NVARCHAR(255),
        owner3_other_doc NVARCHAR(255),
        owner4_other_doc NVARCHAR(255),
        owner5_other_doc NVARCHAR(255),
        owner6_other_doc NVARCHAR(255),
        owner7_other_doc NVARCHAR(255),
        owner8_other_doc NVARCHAR(255),
        owner9_other_doc NVARCHAR(255),
        owner10_other_doc NVARCHAR(255),
        propertySituation NVARCHAR(100) DEFAULT '',
        createdAt DATETIME DEFAULT GETDATE(),
        status NVARCHAR(50) DEFAULT 'Pending'
      )
    `;
    console.log('Created Surveys table');
  } catch (err) {
    console.error('ensureSurveysTable error:', err.message);
  }
}

// Ensure Surveys table has propertySituation column
async function ensurePropertySituationColumn() {
  try {
    const sql = await connectDb();
    const colCheck = await sql.query`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Surveys' AND COLUMN_NAME = 'propertySituation'`;
    if (colCheck.recordset.length === 0) {
      await sql.query`ALTER TABLE Surveys ADD propertySituation NVARCHAR(100) DEFAULT ''`;
      console.log('Added propertySituation column to Surveys');
    }
  } catch (err) {
    console.error('ensurePropertySituationColumn error:', err.message);
  }
}

// Ensure Surveys table has owner document columns
async function ensureOwnerDocumentColumns() {
  try {
    const sql = await connectDb();
    const columnsToAdd = [
      'owner1_aadhaar_doc', 'owner2_aadhaar_doc', 'owner3_aadhaar_doc', 'owner4_aadhaar_doc', 'owner5_aadhaar_doc',
      'owner6_aadhaar_doc', 'owner7_aadhaar_doc', 'owner8_aadhaar_doc', 'owner9_aadhaar_doc', 'owner10_aadhaar_doc',
      'owner1_pan_doc', 'owner2_pan_doc', 'owner3_pan_doc', 'owner4_pan_doc', 'owner5_pan_doc',
      'owner6_pan_doc', 'owner7_pan_doc', 'owner8_pan_doc', 'owner9_pan_doc', 'owner10_pan_doc',
      'owner1_other_doc', 'owner2_other_doc', 'owner3_other_doc', 'owner4_other_doc', 'owner5_other_doc',
      'owner6_other_doc', 'owner7_other_doc', 'owner8_other_doc', 'owner9_other_doc', 'owner10_other_doc'
    ];

    for (const columnName of columnsToAdd) {
      const colCheck = await sql.query`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Surveys' AND COLUMN_NAME = ${columnName}`;
      if (colCheck.recordset.length === 0) {
        // Use string concatenation for DDL statements
        await sql.query(`ALTER TABLE Surveys ADD [${columnName}] NVARCHAR(255)`);
        console.log(`Added ${columnName} column to Surveys`);
      }
    }
  } catch (err) {
    console.error('ensureOwnerDocumentColumns error:', err.message);
  }
}

// Test route
app.get('/', (req, res) => {
  res.send('Property Survey Backend Running');
});

// Citizen signup
app.post('/api/signup',
  // validation
  body('name').isLength({ min: 2 }),
  body('email').isEmail(),
  body('password').isLength({ min: 6 }),
  body('ward').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { name, email, password, ward } = req.body;
    try {
      const sql = await connectDb();
      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashed = await bcrypt.hash(password, salt);
      await sql.query`
        INSERT INTO Citizens (name, email, password, ward)
        VALUES (${name}, ${email}, ${hashed}, ${ward})
      `;
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Citizen login
app.post('/api/login', async (req, res) => {
  const { email, password, role } = req.body;
  try {
    const sql = await connectDb();
    // Lookup user by email
    const result = await sql.query`SELECT * FROM Citizens WHERE email = ${email}`;
    if (result.recordset.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
    const user = result.recordset[0];
    console.log(`Login request received for email='${email}', role='${role}'`);
    // Defensive: if stored password is missing/null/empty, reject immediately
    if (!user.password || typeof user.password !== 'string' || user.password.length === 0) {
      console.warn(`Rejecting login for ${email} because stored password is empty or missing.`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    // Compare hashed password
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    // Normalize incoming role and stored isAdmin to avoid mismatches
    const wantedAdmin = String(role || '').toLowerCase() === 'admin';
    // stored isAdmin may be boolean, number (0/1) or string; normalize to boolean
    const storedIsAdmin = (user.isAdmin === true) || (user.isAdmin === 1) || (user.isAdmin === '1') || (String(user.isAdmin).toLowerCase() === 'true');
    console.log(`Login attempt for ${email} role='${role}' wantedAdmin=${wantedAdmin} storedIsAdmin=${storedIsAdmin}`);
    if (wantedAdmin && !storedIsAdmin) return res.status(401).json({ error: 'Not an admin user' });
    // Success - issue a JWT containing isAdmin and user email
    delete user.password;
    const token = jwt.sign({ email: user.email, isAdmin: !!user.isAdmin }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ success: true, user, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin auth middleware
function adminAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth) return res.status(401).json({ error: 'Missing authorization header' });
  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return res.status(401).json({ error: 'Invalid authorization format' });
  const token = parts[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || !decoded.isAdmin) return res.status(403).json({ error: 'Admin access required' });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Ensure fixed admin user exists
// (Removed /api/fix-admin endpoint - admin creation is handled at startup migration)

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
// Run schema migration and admin creation, then start server
(async () => {
  await ensureCitizensTable();
  await ensureIsAdminColumn();
  await ensureSurveysTable();
  await ensurePropertySituationColumn();
  await ensureOwnerDocumentColumns();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT} (listening on 0.0.0.0)`);
  });
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Stop the other process or set PORT in .env to a free port.`);
    } else {
      console.error('Server error:', err && err.message ? err.message : err);
    }
    process.exit(1);
  });
  // Graceful shutdown handlers
  process.on('SIGINT', () => {
    console.log('SIGINT received — shutting down server');
    server.close(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    console.log('SIGTERM received — shutting down server');
    server.close(() => process.exit(0));
  });
})();

// Debug endpoint to check admin status and schema
app.get('/api/debug-admin-status', async (req, res) => {
  try {
    const sql = await connectDb();
    // Check if isAdmin column exists
    const colCheck = await sql.query`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Citizens' AND COLUMN_NAME = 'isAdmin'
    `;
    const hasIsAdmin = colCheck.recordset.length > 0;
    // Check for admin user
    const admin = await sql.query`SELECT * FROM Citizens WHERE email = 'admin@survey.com'`;
    res.json({ hasIsAdmin, adminExists: admin.recordset.length > 0, admin: admin.recordset[0] || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new survey
// Legacy JSON-based survey creation is still available; prefer multipart upload for images
app.post('/api/surveys',
  body('email').isEmail(),
  body('name').isLength({ min: 2 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    try {
      const { email, name, mobile, ward, propertyType, numberOfFloors, plotArea, builtUpArea, geoLat, geoLng, images, propertySituation } = req.body;
      const sql = await connectDb();
      const imagesStr = Array.isArray(images) ? images.join(',') : (images || '');
      await sql.query`
        INSERT INTO Surveys (citizenEmail, name, mobile, ward, propertyType, numberOfFloors, plotArea, builtUpArea, geoLat, geoLng, images, propertySituation)
        VALUES (${email}, ${name}, ${mobile}, ${ward}, ${propertyType}, ${numberOfFloors}, ${plotArea}, ${builtUpArea}, ${geoLat}, ${geoLng}, ${imagesStr}, ${propertySituation || ''})
      `;
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Multipart upload with files
app.post('/api/surveys/upload', upload.fields([{ name: 'images', maxCount: 5 }, { name: 'ownerImages', maxCount: 5 }, { name: 'documents', maxCount: 10 }, { name: 'ownerAadhaarDocs', maxCount: 10 }, { name: 'ownerPanDocs', maxCount: 10 }, { name: 'ownerOtherDocs', maxCount: 10 }]), async (req, res) => {
  try {
    // fields are in req.body
    const { email, name, mobile, ward, road, propertyType, ownershipType, numberOfFloors, plotArea, builtUpArea, geoLat, geoLng, propertySituation } = req.body;
  // ownerDetails may be sent as a JSON string (from multipart form) or as an array/object
    let ownerDetailsRaw = req.body.ownerDetails || req.body.ownerDetailsRaw || req.body.owner_details;
    let ownerDetails = [];
    if (typeof ownerDetailsRaw === 'string' && ownerDetailsRaw.trim().length > 0) {
      try {
        ownerDetails = JSON.parse(ownerDetailsRaw);
      } catch (err) {
        // If parsing fails, fall back to empty array
        ownerDetails = [];
      }
    } else if (Array.isArray(ownerDetailsRaw)) {
      ownerDetails = ownerDetailsRaw;
    } else if (typeof ownerDetailsRaw === 'object' && ownerDetailsRaw !== null) {
      // in some clients ownerDetails may be an object with numeric keys
      // convert to array sorted by numeric keys
      const keys = Object.keys(ownerDetailsRaw).sort((a, b) => Number(a) - Number(b));
      ownerDetails = keys.map(k => ownerDetailsRaw[k]);
    }

    // Some clients (PowerShell multipart or odd encoders) may double-encode the JSON or send it as an array of characters.
    // Normalize common cases:
    if (typeof ownerDetails === 'string') {
      try {
        const second = JSON.parse(ownerDetails);
        ownerDetails = second;
      } catch (e) {
        // leave as-is
      }
    }
    // If ownerDetails is an array of strings (PowerShell/multipart quirk), try joining and parsing
    if (Array.isArray(ownerDetails) && ownerDetails.length > 0 && ownerDetails.every(x => typeof x === 'string')) {
      const rawJoined = ownerDetails.join('');
      // Aggressively clean and unescape the joined string before parsing
      let cleaned = rawJoined;
      // Remove wrapping quotes repeatedly
      while (cleaned.length >= 2 && cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.slice(1, -1);
      }
      // Unescape common sequences produced by some clients
      cleaned = cleaned.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      cleaned = cleaned.trim();
      try {
        const parsed = JSON.parse(cleaned);
        ownerDetails = parsed;
        console.log('Normalized ownerDetails from joined array (aggressive path)');
      } catch (e) {
        // fallback: try joining with commas
        try {
          const joined2 = ownerDetails.join(',');
          const parsed2 = JSON.parse(joined2);
          ownerDetails = parsed2;
          console.log('Normalized ownerDetails by joining with commas');
        } catch (err) {
          console.log('Failed to normalize ownerDetails; storing raw array');
        }
      }
    }

    // Server-side validation for Aadhaar and PAN
    const validationErrors = [];
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
    const aadharRegex = /^[0-9]{12}$/;
    if (Array.isArray(ownerDetails)) {
      ownerDetails.forEach((od, idx) => {
        if (od && typeof od === 'object') {
          const a = od.aadhar ? String(od.aadhar).trim() : '';
          const p = od.pan ? String(od.pan).trim() : '';
          if (a && !aadharRegex.test(a)) validationErrors.push({ owner: idx + 1, field: 'aadhar', error: 'Aadhaar must be 12 digits' });
          if (p && !panRegex.test(p)) validationErrors.push({ owner: idx + 1, field: 'pan', error: 'PAN must be in format AAAAA9999A' });
        }
      });
    }
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: validationErrors });
    }

    // Mask sensitive identifiers before saving to DB. For stronger protection, encrypt at rest using a server-side key
    // (e.g., use Node's crypto with process.env.DATA_ENCRYPTION_KEY) and store ciphertext instead.
    function maskAadhaar(a) {
      const s = String(a || '');
      if (s.length <= 4) return '*'.repeat(s.length);
      return '*'.repeat(Math.max(0, s.length - 4)) + s.slice(-4);
    }
    function maskPan(p) {
      const s = String(p || '');
      if (s.length <= 2) return '*'.repeat(s.length);
      // keep first 3 and last 1 for limited usability
      const first = s.slice(0, 3);
      const last = s.slice(-1);
      return first + '*'.repeat(Math.max(0, s.length - 4)) + last;
    }
    if (Array.isArray(ownerDetails)) {
      ownerDetails = ownerDetails.map(od => {
        if (od && typeof od === 'object') {
          const copy = { ...od };
          if (copy.aadhar) copy.aadhar = maskAadhaar(copy.aadhar);
          if (copy.pan) copy.pan = maskPan(copy.pan.toUpperCase());
          return copy;
        }
        return od;
      });
    }
    const files = req.files || {};
    const images = files.images || [];
    const ownerImages = files.ownerImages || [];
    const documents = files.documents || [];
    const ownerAadhaarDocs = files.ownerAadhaarDocs || [];
    const ownerPanDocs = files.ownerPanDocs || [];
    const ownerOtherDocs = files.ownerOtherDocs || [];

    // Upload all files to Firebase and collect URLs
    const imageUrls = await Promise.all(images.map(file => uploadToFirebase(file, 'survey-images')));
    const ownerImageUrls = await Promise.all(ownerImages.map(file => uploadToFirebase(file, 'owner-images')));
    const documentUrls = await Promise.all(documents.map(file => uploadToFirebase(file, 'documents')));
    const ownerAadhaarDocUrls = await Promise.all(ownerAadhaarDocs.map(file => uploadToFirebase(file, 'owner-aadhaar-docs')));
    const ownerPanDocUrls = await Promise.all(ownerPanDocs.map(file => uploadToFirebase(file, 'owner-pan-docs')));
    const ownerOtherDocUrls = await Promise.all(ownerOtherDocs.map(file => uploadToFirebase(file, 'owner-other-docs')));

    if (!email || !name) return res.status(400).json({ error: 'Missing required fields' });
    if (imageUrls.length < 2) return res.status(400).json({ error: 'At least 2 property images required' });
    let filenames = imageUrls.join(',');
    let document1 = documentUrls[0] || '';
    let document2 = documentUrls[1] || '';
    let document3 = documentUrls[2] || '';
    let document4 = documentUrls[3] || '';
    let document5 = documentUrls[4] || '';
    let document6 = documentUrls[5] || '';
    let document7 = documentUrls[6] || '';
    let document8 = documentUrls[7] || '';
    let document9 = documentUrls[8] || '';
    let document10 = documentUrls[9] || '';
    let owner1Image = ownerImageUrls[0] || '';
    let owner2Image = ownerImageUrls[1] || '';
    let owner3Image = ownerImageUrls[2] || '';
    let owner4Image = ownerImageUrls[3] || '';
    let owner5Image = ownerImageUrls[4] || '';
    let owner6Image = ownerImageUrls[5] || '';
    let owner7Image = ownerImageUrls[6] || '';
    let owner8Image = ownerImageUrls[7] || '';
    let owner9Image = ownerImageUrls[8] || '';
    let owner10Image = ownerImageUrls[9] || '';
    let ownerAadhaarDoc1 = ownerAadhaarDocUrls[0] || '';
    let ownerAadhaarDoc2 = ownerAadhaarDocUrls[1] || '';
    let ownerAadhaarDoc3 = ownerAadhaarDocUrls[2] || '';
    let ownerAadhaarDoc4 = ownerAadhaarDocUrls[3] || '';
    let ownerAadhaarDoc5 = ownerAadhaarDocUrls[4] || '';
    let ownerAadhaarDoc6 = ownerAadhaarDocUrls[5] || '';
    let ownerAadhaarDoc7 = ownerAadhaarDocUrls[6] || '';
    let ownerAadhaarDoc8 = ownerAadhaarDocUrls[7] || '';
    let ownerAadhaarDoc9 = ownerAadhaarDocUrls[8] || '';
    let ownerAadhaarDoc10 = ownerAadhaarDocUrls[9] || '';
    let ownerPanDoc1 = ownerPanDocUrls[0] || '';
    let ownerPanDoc2 = ownerPanDocUrls[1] || '';
    let ownerPanDoc3 = ownerPanDocUrls[2] || '';
    let ownerPanDoc4 = ownerPanDocUrls[3] || '';
    let ownerPanDoc5 = ownerPanDocUrls[4] || '';
    let ownerPanDoc6 = ownerPanDocUrls[5] || '';
    let ownerPanDoc7 = ownerPanDocUrls[6] || '';
    let ownerPanDoc8 = ownerPanDocUrls[7] || '';
    let ownerPanDoc9 = ownerPanDocUrls[8] || '';
    let ownerPanDoc10 = ownerPanDocUrls[9] || '';
    let ownerOtherDoc1 = ownerOtherDocUrls[0] || '';
    let ownerOtherDoc2 = ownerOtherDocUrls[1] || '';
    let ownerOtherDoc3 = ownerOtherDocUrls[2] || '';
    let ownerOtherDoc4 = ownerOtherDocUrls[3] || '';
    let ownerOtherDoc5 = ownerOtherDocUrls[4] || '';
    let ownerOtherDoc6 = ownerOtherDocUrls[5] || '';
    let ownerOtherDoc7 = ownerOtherDocUrls[6] || '';
    let ownerOtherDoc8 = ownerOtherDocUrls[7] || '';
    let ownerOtherDoc9 = ownerOtherDocUrls[8] || '';
    let ownerOtherDoc10 = ownerOtherDocUrls[9] || '';
    let owner1Details = ownerDetails[0] ? JSON.stringify(ownerDetails[0]) : '';
    let owner2Details = ownerDetails[1] ? JSON.stringify(ownerDetails[1]) : '';
    let owner3Details = ownerDetails[2] ? JSON.stringify(ownerDetails[2]) : '';
    let owner4Details = ownerDetails[3] ? JSON.stringify(ownerDetails[3]) : '';
    let owner5Details = ownerDetails[4] ? JSON.stringify(ownerDetails[4]) : '';
    let owner6Details = ownerDetails[5] ? JSON.stringify(ownerDetails[5]) : '';
    let owner7Details = ownerDetails[6] ? JSON.stringify(ownerDetails[6]) : '';
    let owner8Details = ownerDetails[7] ? JSON.stringify(ownerDetails[7]) : '';
    let owner9Details = ownerDetails[8] ? JSON.stringify(ownerDetails[8]) : '';
    let owner10Details = ownerDetails[9] ? JSON.stringify(ownerDetails[9]) : '';
    const sql = await connectDb();
    await sql.query`
      INSERT INTO Surveys (citizenEmail, name, mobile, ward, road, propertyType, ownershipType, numberOfFloors, plotArea, builtUpArea, geoLat, geoLng, images, document1, document2, document3, document4, document5, document6, document7, document8, document9, document10, owner1_image, owner2_image, owner3_image, owner4_image, owner5_image, owner6_image, owner7_image, owner8_image, owner9_image, owner10_image, owner1_details, owner2_details, owner3_details, owner4_details, owner5_details, owner6_details, owner7_details, owner8_details, owner9_details, owner10_details, owner1_aadhaar_doc, owner2_aadhaar_doc, owner3_aadhaar_doc, owner4_aadhaar_doc, owner5_aadhaar_doc, owner6_aadhaar_doc, owner7_aadhaar_doc, owner8_aadhaar_doc, owner9_aadhaar_doc, owner10_aadhaar_doc, owner1_pan_doc, owner2_pan_doc, owner3_pan_doc, owner4_pan_doc, owner5_pan_doc, owner6_pan_doc, owner7_pan_doc, owner8_pan_doc, owner9_pan_doc, owner10_pan_doc, owner1_other_doc, owner2_other_doc, owner3_other_doc, owner4_other_doc, owner5_other_doc, owner6_other_doc, owner7_other_doc, owner8_other_doc, owner9_other_doc, owner10_other_doc, propertySituation)
      VALUES (${email}, ${name}, ${mobile}, ${ward}, ${road}, ${propertyType}, ${ownershipType}, ${numberOfFloors}, ${plotArea}, ${builtUpArea}, ${geoLat}, ${geoLng}, ${filenames}, ${document1}, ${document2}, ${document3}, ${document4}, ${document5}, ${document6}, ${document7}, ${document8}, ${document9}, ${document10}, ${owner1Image}, ${owner2Image}, ${owner3Image}, ${owner4Image}, ${owner5Image}, ${owner6Image}, ${owner7Image}, ${owner8Image}, ${owner9Image}, ${owner10Image}, ${owner1Details}, ${owner2Details}, ${owner3Details}, ${owner4Details}, ${owner5Details}, ${owner6Details}, ${owner7Details}, ${owner8Details}, ${owner9Details}, ${owner10Details}, ${ownerAadhaarDoc1}, ${ownerAadhaarDoc2}, ${ownerAadhaarDoc3}, ${ownerAadhaarDoc4}, ${ownerAadhaarDoc5}, ${ownerAadhaarDoc6}, ${ownerAadhaarDoc7}, ${ownerAadhaarDoc8}, ${ownerAadhaarDoc9}, ${ownerAadhaarDoc10}, ${ownerPanDoc1}, ${ownerPanDoc2}, ${ownerPanDoc3}, ${ownerPanDoc4}, ${ownerPanDoc5}, ${ownerPanDoc6}, ${ownerPanDoc7}, ${ownerPanDoc8}, ${ownerPanDoc9}, ${ownerPanDoc10}, ${ownerOtherDoc1}, ${ownerOtherDoc2}, ${ownerOtherDoc3}, ${ownerOtherDoc4}, ${ownerOtherDoc5}, ${ownerOtherDoc6}, ${ownerOtherDoc7}, ${ownerOtherDoc8}, ${ownerOtherDoc9}, ${ownerOtherDoc10}, ${propertySituation || ''})
    `;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin moderation endpoints
app.post('/api/surveys/:id/approve', adminAuth, async (req, res) => {
  const id = req.params.id;
  try {
    const sql = await connectDb();
    await sql.query`UPDATE Surveys SET status = 'Approved' WHERE id = ${id}`;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/surveys/:id/reject', adminAuth, async (req, res) => {
  const id = req.params.id;
  try {
    const sql = await connectDb();
    await sql.query`UPDATE Surveys SET status = 'Rejected' WHERE id = ${id}`;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List surveys (all or by citizen email)
app.get('/api/surveys', async (req, res) => {
  try {
    const sql = await connectDb();
    const email = req.query.email;
    let result;
    if (email) {
      result = await sql.query`SELECT * FROM Surveys WHERE citizenEmail = ${email}`;
    } else {
      result = await sql.query`SELECT * FROM Surveys ORDER BY createdAt DESC`;
    }
    // Build full image URLs for uploaded filenames so the frontend can load thumbnails
  // Prefer forwarded proto when behind proxies (Render sets X-Forwarded-Proto)
  const proto = (req.get('X-Forwarded-Proto') || req.protocol) + '';
  const baseUrl = proto + '://' + req.get('host');
    const surveys = result.recordset.map(r => {
      const imagesField = r.images || '';
      const imagesArr = typeof imagesField === 'string'
        ? imagesField.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : (Array.isArray(imagesField) ? imagesField : []);
      const imageUrls = imagesArr.map(f => {
        if (!f) return f;
        const trimmed = String(f).trim();
        if (trimmed.startsWith('http')) return normalizeUrl(trimmed);
        return `${baseUrl}/uploads/${encodeURIComponent(trimmed)}`;
      });
      console.log(`Survey ${r.id} images:`, imagesArr);
      console.log(`Survey ${r.id} imageUrls:`, imageUrls);
      const documentsField = [r.document1, r.document2, r.document3, r.document4, r.document5, r.document6, r.document7, r.document8, r.document9, r.document10].filter(f => f && f.trim().length > 0);
      const documentUrls = documentsField.map(f => {
        if (!f) return f;
        const trimmed = String(f).trim();
        if (trimmed.startsWith('http')) return normalizeUrl(trimmed);
        return `${baseUrl}/uploads/${encodeURIComponent(trimmed)}`;
      });
      const ownerImagesField = [r.owner1_image, r.owner2_image, r.owner3_image, r.owner4_image, r.owner5_image, r.owner6_image, r.owner7_image, r.owner8_image, r.owner9_image, r.owner10_image].filter(f => f && f.trim().length > 0);
      const ownerImageUrls = ownerImagesField.map(f => {
        if (!f) return f;
        const trimmed = String(f).trim();
        if (trimmed.startsWith('http')) return normalizeUrl(trimmed);
        return `${baseUrl}/uploads/${encodeURIComponent(trimmed)}`;
      });
      const ownerDocumentsField = [r.owner1_document, r.owner2_document, r.owner3_document, r.owner4_document, r.owner5_document, r.owner6_document, r.owner7_document, r.owner8_document, r.owner9_document, r.owner10_document].filter(f => f && f.trim().length > 0);
      const ownerDocumentUrls = ownerDocumentsField.map(f => {
        if (!f) return f;
        const trimmed = String(f).trim();
        if (trimmed.startsWith('http')) return normalizeUrl(trimmed);
        return `${baseUrl}/uploads/${encodeURIComponent(trimmed)}`;
      });
      const ownerAadhaarDocsField = [r.owner1_aadhaar_doc, r.owner2_aadhaar_doc, r.owner3_aadhaar_doc, r.owner4_aadhaar_doc, r.owner5_aadhaar_doc, r.owner6_aadhaar_doc, r.owner7_aadhaar_doc, r.owner8_aadhaar_doc, r.owner9_aadhaar_doc, r.owner10_aadhaar_doc].filter(f => f && f.trim().length > 0);
      const ownerAadhaarDocUrls = ownerAadhaarDocsField.map(f => {
        if (!f) return f;
        const trimmed = String(f).trim();
        if (trimmed.startsWith('http')) return normalizeUrl(trimmed);
        return `${baseUrl}/uploads/${encodeURIComponent(trimmed)}`;
      });
      const ownerPanDocsField = [r.owner1_pan_doc, r.owner2_pan_doc, r.owner3_pan_doc, r.owner4_pan_doc, r.owner5_pan_doc, r.owner6_pan_doc, r.owner7_pan_doc, r.owner8_pan_doc, r.owner9_pan_doc, r.owner10_pan_doc].filter(f => f && f.trim().length > 0);
      const ownerPanDocUrls = ownerPanDocsField.map(f => {
        if (!f) return f;
        const trimmed = String(f).trim();
        if (trimmed.startsWith('http')) return normalizeUrl(trimmed);
        return `${baseUrl}/uploads/${encodeURIComponent(trimmed)}`;
      });
      const ownerOtherDocsField = [r.owner1_other_doc, r.owner2_other_doc, r.owner3_other_doc, r.owner4_other_doc, r.owner5_other_doc, r.owner6_other_doc, r.owner7_other_doc, r.owner8_other_doc, r.owner9_other_doc, r.owner10_other_doc].filter(f => f && f.trim().length > 0);
      const ownerOtherDocUrls = ownerOtherDocsField.map(f => {
        if (!f) return f;
        const trimmed = String(f).trim();
        if (trimmed.startsWith('http')) return normalizeUrl(trimmed);
        return `${baseUrl}/uploads/${encodeURIComponent(trimmed)}`;
      });
      const ownerDetailsArray = [r.owner1_details, r.owner2_details, r.owner3_details, r.owner4_details, r.owner5_details, r.owner6_details, r.owner7_details, r.owner8_details, r.owner9_details, r.owner10_details]
        .filter(d => d && d.trim().length > 0)
        .map(d => JSON.parse(d));
      return { ...r, images: imagesArr, imageUrls, documents: documentsField, documentUrls, ownerImages: ownerImagesField, ownerImageUrls, ownerDocuments: ownerDocumentsField, ownerDocumentUrls, ownerAadhaarDocs: ownerAadhaarDocsField, ownerAadhaarDocUrls, ownerPanDocs: ownerPanDocsField, ownerPanDocUrls, ownerOtherDocs: ownerOtherDocsField, ownerOtherDocUrls, ownerDetails: ownerDetailsArray, createdAt: r.createdAt ? (new Date(r.createdAt)).toISOString() : null };
    });
    res.json({ success: true, surveys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single survey by id with imageUrls and createdAt ISO
app.get('/api/surveys/:id', async (req, res) => {
  try {
    const sql = await connectDb();
    const id = req.params.id;
    const result = await sql.query`SELECT * FROM Surveys WHERE id = ${id}`;
    if (result.recordset.length === 0) return res.status(404).json({ error: 'Not found' });
    const r = result.recordset[0];
    const imagesField = r.images || '';
    const imagesArr = typeof imagesField === 'string'
      ? imagesField.split(',').map(s => s.trim()).filter(s => s.length > 0)
      : (Array.isArray(imagesField) ? imagesField : []);
  const proto = (req.get('X-Forwarded-Proto') || req.protocol) + '';
  const baseUrl = proto + '://' + req.get('host');
    const imageUrls = imagesArr.map(f => {
      if (!f) return f;
      const trimmed = String(f).trim();
      if (trimmed.startsWith('http')) return normalizeUrl(trimmed);
      return `${baseUrl}/uploads/${encodeURIComponent(trimmed)}`;
    });
    const documentsField = [r.document1, r.document2, r.document3, r.document4, r.document5, r.document6, r.document7, r.document8, r.document9, r.document10].filter(f => f && f.trim().length > 0);
    const documentUrls = documentsField.map(f => {
      if (!f) return f;
      const trimmed = String(f).trim();
      if (trimmed.startsWith('http')) return normalizeUrl(trimmed);
      return `${baseUrl}/uploads/${encodeURIComponent(trimmed)}`;
    });
    const ownerImagesField = [r.owner1_image, r.owner2_image, r.owner3_image, r.owner4_image, r.owner5_image, r.owner6_image, r.owner7_image, r.owner8_image, r.owner9_image, r.owner10_image].filter(f => f && f.trim().length > 0);
    const ownerImageUrls = ownerImagesField.map(f => {
      if (!f) return f;
      const trimmed = String(f).trim();
      if (trimmed.startsWith('http')) return normalizeUrl(trimmed);
      return `${baseUrl}/uploads/${encodeURIComponent(trimmed)}`;
    });
    const ownerDetailsArray = [r.owner1_details, r.owner2_details, r.owner3_details, r.owner4_details, r.owner5_details, r.owner6_details, r.owner7_details, r.owner8_details, r.owner9_details, r.owner10_details]
      .filter(d => d && d.trim().length > 0)
      .map(d => JSON.parse(d));
    const survey = { ...r, images: imagesArr, imageUrls, documents: documentsField, documentUrls, ownerImages: ownerImagesField, ownerImageUrls, ownerDetails: ownerDetailsArray, createdAt: r.createdAt ? (new Date(r.createdAt)).toISOString() : null };
    res.json({ success: true, survey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
