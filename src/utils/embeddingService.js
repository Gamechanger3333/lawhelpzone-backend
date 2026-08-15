// backend/src/utils/embeddingService.js
//
// Semantic search building blocks for LawHelpZone's AI assistant.
// Same core idea as CodeBox's RAG engine (embed text -> compare by cosine
// similarity), but adapted to this project's shape:
//   - MongoDB/Mongoose instead of Postgres/Prisma — embeddings are stored
//     directly on the Case/User documents as a plain number array field,
//     since we don't have (and don't need, at this scale) a dedicated
//     vector database or a separate chunks table.
//   - "Ingestion" here means "generate an embedding when a case or lawyer
//     profile is created/updated" rather than "upload a ZIP" — the trigger
//     is different, but the underlying embedding + similarity math is the
//     same technique.

const OLLAMA_EMBED_URL = "http://localhost:11434/api/embed";
const EMBED_MODEL = "nomic-embed-text";

// Text -> vector. Used both when indexing (case/lawyer saved) and when
// answering a question (the user's query also needs to become a vector
// before it can be compared to anything).
export async function getEmbedding(text) {
  if (!text || !text.trim()) return null;

  try {
    const response = await fetch(OLLAMA_EMBED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: [text] }),
    });
    if (!response.ok) {
      console.error(`Embedding request failed: ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data.embeddings?.[0] || null;
  } catch (err) {
    // Ollama not running, network issue, etc. Embedding is an enhancement —
    // callers should treat a null return as "semantic search unavailable
    // for this item right now", not crash the case-save/profile-update flow.
    console.error("Embedding generation failed (is Ollama running?):", err.message);
    return null;
  }
}

// Cosine similarity — same formula as CodeBox's version. Measures how
// aligned two vectors are: 1 = same meaning, 0 = unrelated, -1 = opposite.
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return -1;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Brute-force top-K search over a list of {..., embedding} documents.
// Fine at this project's scale (hundreds–low thousands of cases/lawyers).
// Would need a real vector index (MongoDB Atlas Vector Search, or similar)
// if this ever needed to scale to tens of thousands of documents.
export function rankBySimilarity(queryEmbedding, documents, topK = 5) {
  if (!queryEmbedding) return [];

  return documents
    .filter((doc) => Array.isArray(doc.embedding) && doc.embedding.length > 0)
    .map((doc) => ({ ...doc, score: cosineSimilarity(queryEmbedding, doc.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}