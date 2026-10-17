-- For a small, quiescent drill dataset. Prints table/count/content hash, never rows.
-- Large production databases need per-table streaming checks instead of string_agg.
SELECT format(
  'SELECT %L || ''|'' || count(*) || ''|'' || md5(coalesce(string_agg(md5(row_to_json(t)::text), '''' ORDER BY md5(row_to_json(t)::text)), '''')) FROM %I.%I AS t;',
  tablename, schemaname, tablename
)
FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
\gexec
