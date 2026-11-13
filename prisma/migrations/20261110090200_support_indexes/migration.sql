-- At most one not-CLOSED case per member; openForMember catches P2002 for the race.
CREATE UNIQUE INDEX "support_conversations_one_open_per_member_key" ON "support_conversations" ("member_id") WHERE "status" <> 'CLOSED';

-- Approximate nearest-neighbor search for the RAG vector path (was sequential scan).
CREATE INDEX "support_knowledge_chunks_embedding_idx" ON "support_knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
