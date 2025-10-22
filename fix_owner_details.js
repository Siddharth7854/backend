#!/usr/bin/env node
import { connectDb } from './db.js';

function tryNormalizeOwnerDetails(value) {
  if (!value) return null;
  // If value looks like a JSON string already, try parse
  try {
    if (typeof value === 'object') return value;
    const trimmed = String(value).trim();
    // If it's like '"[', it's probably a fragment; join strategy not needed here
    // Try to unescape and parse
    let candidate = trimmed;
    // Remove wrapping quotes
    while (candidate.length >= 2 && candidate.startsWith('"') && candidate.endsWith('"')) {
      candidate = candidate.slice(1, -1);
    }
    candidate = candidate.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    candidate = candidate.trim();
    return JSON.parse(candidate);
  } catch (e) {
    return null;
  }
}

async function run() {
  const pool = await connectDb();
  const res = await pool.request().query('SELECT id, owner1_details, owner2_details, owner3_details, owner4_details, owner5_details, owner6_details, owner7_details, owner8_details, owner9_details, owner10_details FROM Surveys');
  const rows = res.recordset || [];
  let fixed = 0;
  for (const r of rows) {
    // Build a combined string from fragmented ownerN columns if they look like char fragments
    const fragments = [r.owner1_details, r.owner2_details, r.owner3_details, r.owner4_details, r.owner5_details, r.owner6_details, r.owner7_details, r.owner8_details, r.owner9_details, r.owner10_details];
    const concatenated = fragments.filter(Boolean).join('');
    const parsed = tryNormalizeOwnerDetails(concatenated);
    if (parsed) {
      // Prepare masked fields if present (assume server mask rules not needed here)
      const ownerJson = JSON.stringify(parsed);
      // Update owner1_details with ownerJson and clear others
      const upd = await pool.request()
        .input('id', r.id)
        .input('owner1', ownerJson)
        .query(`UPDATE Surveys SET owner1_details = @owner1, owner2_details = '', owner3_details = '', owner4_details = '', owner5_details = '', owner6_details = '', owner7_details = '', owner8_details = '', owner9_details = '', owner10_details = '' WHERE id = @id`);
      fixed++;
      console.log(`Fixed row id=${r.id}`);
    }
  }
  console.log(`Done. Fixed ${fixed} rows.`);
  process.exit(0);
}

run().catch(err => {
  console.error('Error running fix:', err);
  process.exit(1);
});
