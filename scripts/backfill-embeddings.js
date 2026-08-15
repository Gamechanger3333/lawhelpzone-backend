// backend/scripts/backfill-embeddings.js
//
// One-time migration: generates embeddings for cases and lawyer profiles
// that existed BEFORE semantic search was added. Without this, semanticSearchCases
// and semanticSearchLawyers would silently return nothing for any case/lawyer
// created before this feature shipped — new create/update events embed
// automatically (see caseRoutes.js, profileController.js), but nothing
// retroactively touches old rows.
//
// Run with: node scripts/backfill-embeddings.js
// Safe to re-run — only processes documents missing an embedding.

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Case from '../src/models/Case.js';
import User from '../src/models/User.js';
import { getEmbedding } from '../src/utils/embeddingService.js';

dotenv.config();

const BATCH_DELAY_MS = 50; // small pause between items — be gentle on local Ollama

async function backfillCases() {
  const cases = await Case.find({
    $or: [{ embedding: { $exists: false } }, { embedding: { $size: 0 } }],
  }).select('_id title description');

  console.log(`\n📁 Cases missing embeddings: ${cases.length}`);
  let done = 0, failed = 0;

  for (const c of cases) {
    const embedding = await getEmbedding(`${c.title}\n${c.description}`);
    if (embedding) {
      await Case.findByIdAndUpdate(c._id, { embedding });
      done++;
    } else {
      failed++;
      console.log(`  ⚠️  Failed to embed case ${c._id} ("${c.title.slice(0, 40)}...")`);
    }
    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  console.log(`✅ Cases embedded: ${done}, failed: ${failed}`);
}

async function backfillLawyerBios() {
  const lawyers = await User.find({
    role: 'lawyer',
    'lawyerProfile.bio': { $exists: true, $ne: '' },
    $or: [
      { 'lawyerProfile.bioEmbedding': { $exists: false } },
      { 'lawyerProfile.bioEmbedding': { $size: 0 } },
    ],
  }).select('_id name lawyerProfile.bio');

  console.log(`\n👩‍⚖️ Lawyer bios missing embeddings: ${lawyers.length}`);
  let done = 0, failed = 0;

  for (const lawyer of lawyers) {
    const embedding = await getEmbedding(lawyer.lawyerProfile.bio);
    if (embedding) {
      await User.findByIdAndUpdate(lawyer._id, { 'lawyerProfile.bioEmbedding': embedding });
      done++;
    } else {
      failed++;
      console.log(`  ⚠️  Failed to embed bio for ${lawyer.name}`);
    }
    await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
  }

  console.log(`✅ Lawyer bios embedded: ${done}, failed: ${failed}`);
}

async function main() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI, { dbName: 'lawhelpzone' });
  console.log('✅ Connected');

  console.log('\n⚠️  This calls the local Ollama embedding model once per');
  console.log('   document — make sure Ollama is running before continuing.');

  await backfillCases();
  await backfillLawyerBios();

  console.log('\n🎉 Backfill complete. Semantic search now covers all existing data.');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});