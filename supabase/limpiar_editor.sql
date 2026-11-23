-- =====================================================================
-- OPCIONAL: borra lo que quedó del editor de documentos propio (ya no se usa).
-- Solo hace falta si la base llegó a tener esa versión. Borra para siempre los
-- documentos que se escribieron en ese editor (los links no se tocan).
-- Correrlo DESPUÉS de schema.sql, en el SQL Editor de Supabase.
-- =====================================================================
drop table if exists public.document_versions;
drop table if exists public.document_states;
delete from public.documents where kind <> 'link' or link_url is null;
alter table public.documents validate constraint documents_link_check;
alter table public.documents drop column if exists editable_by;
alter table public.documents drop column if exists google_id;
alter table public.documents drop column if exists google_url;
drop function if exists public.document_access(uuid);
drop function if exists public.can_edit_document(uuid);
drop function if exists public.can_view_document(uuid);
drop function if exists public.try_uuid(text);
