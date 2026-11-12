-- Optional: semantic retrieval with pgvector.
-- Enable only if you configure an embedding provider in the backend (not wired by default).
create extension if not exists vector;
alter table linguistic_knowledge add column if not exists embedding vector(1536);
create index if not exists idx_knowledge_embedding on linguistic_knowledge using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Similarity search helper used by a future SupabaseKnowledgeStore.searchSemantic().
create or replace function match_knowledge(query_embedding vector(1536), match_count int default 8, p_source_language text default null, p_target_language text default 'dua')
returns table (id uuid, similarity float)
language sql stable as $$
  select k.id, 1 - (k.embedding <=> query_embedding) as similarity
  from linguistic_knowledge k
  where k.embedding is not null
    and k.target_language = p_target_language
    and (p_source_language is null or k.source_language = p_source_language)
    and k.validation_status <> 'rejected'
  order by k.embedding <=> query_embedding
  limit match_count;
$$;
