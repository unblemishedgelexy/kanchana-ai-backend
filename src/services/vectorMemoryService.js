import { Pinecone } from "@pinecone-database/pinecone";
import { PINECONE_API_KEY, PINECONE_INDEX } from "../config.js";
import { createEmbedding } from "./geminiService.js";

const isConfigured = Boolean(PINECONE_API_KEY && PINECONE_INDEX);

let pineconeIndex = null;
if (isConfigured) {
  const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
  pineconeIndex = pinecone.Index(PINECONE_INDEX);
}

const getNamespace = (userId) => `kanchana-user-${String(userId)}`;

export const upsertMessageVector = async ({ userId, messageId, mode, text }) => {
  if (!isConfigured || !text) {
    return;
  }

  const vector = await createEmbedding(text);
  if (!Array.isArray(vector) || !vector.length) {
    return;
  }

  await pineconeIndex.namespace(getNamespace(userId)).upsert([
    {
      id: String(messageId),
      values: vector,
      metadata: {
        mode: String(mode || ""),
        ts: Date.now(),
      },
    },
  ]);
};

export const queryRelevantMessageIds = async ({ userId, mode, text, topK = 4 }) => {
  if (!isConfigured || !text) {
    return [];
  }

  const vector = await createEmbedding(text);
  if (!Array.isArray(vector) || !vector.length) {
    return [];
  }

  const result = await pineconeIndex.namespace(getNamespace(userId)).query({
    vector,
    topK,
    includeValues: false,
    includeMetadata: true,
    filter: mode ? { mode: { $eq: mode } } : undefined,
  });

  return (result?.matches || []).map((item) => String(item.id || "")).filter(Boolean);
};

export const vectorMemoryEnabled = isConfigured;
