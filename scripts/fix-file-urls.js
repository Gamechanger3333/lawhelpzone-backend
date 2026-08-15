// backend/scripts/fix-file-urls.js
//
// Migration: fixes Message.fileUrl (and Case attachment URLs, if any) that
// were saved pointing at the hardcoded production URL
// (https://lawhelpzone-backend-production.up.railway.app) instead of
// wherever the file actually physically lives. This was caused by a bug
// in POST /api/upload's baseUrl fallback — now fixed in server.js, but
// records saved BEFORE that fix still have the wrong URL baked in.
//
// What this does, per affected record:
//   1. Extract the filename from the old fileUrl (the part after /uploads/)
//   2. Check whether that file actually exists in this machine's uploads/ folder
//   3. If yes  -> rewrite fileUrl to point at the local backend
//   4. If no   -> the file was never on this machine (e.g. it's genuinely a
//                 production-only upload) — leave it alone and report it,
//                 rather than guessing
//
// Run with: node scripts/fix-file-urls.js
// Safe to re-run.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Message from '../src/models/Message.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '../uploads');
const OLD_HOST_PATTERN = /^https?:\/\/lawhelpzone-backend-production\.up\.railway\.app/;
const NEW_BASE_URL = process.env.BACKEND_URL || 'http://localhost:5000';

function extractFilename(fileUrl) {
  const match = fileUrl.match(/\/uploads\/([^/?]+)/);
  return match ? match[1] : null;
}

async function main() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI, { dbName: 'lawhelpzone' });
  console.log('✅ Connected\n');

  const affected = await Message.find({
    fileUrl: { $regex: OLD_HOST_PATTERN },
  }).select('_id fileUrl');

  console.log(`Found ${affected.length} message(s) with a production-pointing fileUrl.\n`);

  let fixed = 0, missing = 0, malformed = 0;

  for (const msg of affected) {
    const filename = extractFilename(msg.fileUrl);
    if (!filename) {
      malformed++;
      console.log(`  ⚠️  Could not parse filename from: ${msg.fileUrl}`);
      continue;
    }

    const localPath = path.join(uploadsDir, filename);
    if (fs.existsSync(localPath)) {
      const newUrl = `${NEW_BASE_URL}/uploads/${filename}`;
      await Message.findByIdAndUpdate(msg._id, { fileUrl: newUrl });
      fixed++;
    } else {
      missing++;
      console.log(`  ⚠️  File not found locally, leaving as-is: ${filename}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`✅ Fixed (file exists locally, URL rewritten): ${fixed}`);
  console.log(`⚠️  Left alone (file not found on this machine): ${missing}`);
  console.log(`⚠️  Malformed URL (couldn't parse): ${malformed}`);

  if (missing > 0) {
    console.log(
      `\nNote: the ${missing} left-alone message(s) reference files that don't exist on this ` +
      `machine — they were likely uploaded on production, not locally. Their audio/attachment ` +
      `will still fail to play locally; that's expected and not something this script can fix.`
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});