select 'rows:' || relname || '=' || (xpath('/row/c/text()', query_to_xml(format('select count(*) c from public.%I', relname), false, true, '')))[1]::text
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and relname not in ('zz_probe') order by relname;
select 'md5:profiles=' || md5(string_agg(id::text||role||status||coalesce(cell_id::text,'')||coalesce(full_name,''), ',' order by id)) from public.profiles;
select 'md5:contacts=' || md5(string_agg(id::text||contact_name||coalesce(contact_phone,'')||coalesce(notes,''), ',' order by id)) from public.contacts;
select 'md5:email_preferences=' || md5(string_agg(member_id::text||weekly_digest||opt_out_all, ',' order by member_id)) from public.email_preferences;
select 'md5:meeting_attendances=' || md5(string_agg(meeting_id::text||user_id::text||coalesce(attended::text,'n'), ',' order by meeting_id,user_id)) from public.meeting_attendances;
select 'md5:testimonies=' || md5(string_agg(id::text||title||status||visibility, ',' order by id)) from public.testimonies;
select 'md5:email_log=' || md5(string_agg(id::text||status, ',' order by id)) from public.email_log;
select 'auth.users=' || count(*) from auth.users;
