-- TEST PROJECT ONLY (goionmhlyaxtikapljes). Do NOT run on live: live already has these names.
-- The portal now calls the live connected-account RPC names. Test only has the old ones, so
-- these thin wrappers let the same frontend run against test when supabase-client.js is
-- switched back. They are invoker-rights and just forward to the existing test functions.

create or replace function public.student_create_link_token(p_token uuid, p_password text)
returns text language sql as $$ select public.create_link_token(p_token, p_password) $$;

create or replace function public.student_link_social(p_link_token text, p_provider text)
returns void language sql as $$ select public.link_social(p_link_token, p_provider) $$;

create or replace function public.student_unlink_social(p_token uuid, p_password text, p_provider text)
returns void language sql as $$ select public.unlink_social(p_token, p_password, p_provider) $$;

create or replace function public.student_list_social_links(p_token uuid)
returns text[] language sql as $$ select public.list_social_links(p_token) $$;

revoke all on function public.student_create_link_token(uuid, text) from public;
revoke all on function public.student_link_social(text, text) from public;
revoke all on function public.student_unlink_social(uuid, text, text) from public;
revoke all on function public.student_list_social_links(uuid) from public;
grant execute on function public.student_create_link_token(uuid, text) to anon, authenticated;
grant execute on function public.student_link_social(text, text) to authenticated;
grant execute on function public.student_unlink_social(uuid, text, text) to anon, authenticated;
grant execute on function public.student_list_social_links(uuid) to anon, authenticated;
