-- Development/CI seed (supabase db reset). Production data is NOT touched by this file.
-- Default contact tags / follow-up statuses and one cell, matching the original schema.sql seeds.
insert into public.cells (name)
select 'Cell 1' where not exists (select 1 from public.cells);

insert into public.tags_settings (tag_name, color, sort_order)
select v.tag_name, v.color, v.sort_order
from (values ('Interested','#2196F3',1),('First Timer','#E31837',2),('Regular Visitor','#4CAF50',3),
             ('New Convert','#FF9800',4),('Church Member','#9C27B0',5)) as v(tag_name, color, sort_order)
where not exists (select 1 from public.tags_settings);

insert into public.status_settings (status_name, color, sort_order)
select v.status_name, v.color, v.sort_order
from (values ('Will Follow Up','#FF9800',1),('Contacted','#4CAF50',2),('Not Interested','#E31837',3),
             ('Following Up','#2196F3',4),('Joined Cell','#9C27B0',5)) as v(status_name, color, sort_order)
where not exists (select 1 from public.status_settings);
