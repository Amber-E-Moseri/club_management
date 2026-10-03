-- Representative organisational data, inserted as an operator (superuser) into the LEGACY schema.
\set ON_ERROR_STOP on
do $$
declare coord uuid; adm uuid; l1 uuid; l2 uuid; m1 uuid; m2 uuid; m3 uuid; m4 uuid; pend uuid;
        c1 uuid; c2 uuid; ct uuid; mt uuid; tpl uuid; ev uuid; r uuid; dv uuid;
begin
  select id into coord from public.profiles where email like 'legacy.coord@%';
  select id into adm   from public.profiles where email like 'legacy.admin@%';
  select id into l1    from public.profiles where email like 'legacy.leader1@%';
  select id into l2    from public.profiles where email like 'legacy.leader2@%';
  select id into m1    from public.profiles where email like 'legacy.member1@%';
  select id into m2    from public.profiles where email like 'legacy.member2@%';
  select id into m3    from public.profiles where email like 'legacy.member3@%';
  select id into m4    from public.profiles where email like 'legacy.member4@%';
  select id into pend  from public.profiles where email like 'legacy.pending@%';

  insert into public.cells (name, leader_id) values ('Legacy Cell A', l1) returning id into c1;
  insert into public.cells (name, leader_id) values ('Legacy Cell B', l2) returning id into c2;
  update public.profiles set cell_id = c1 where id in (m1, m2);
  update public.profiles set cell_id = c2 where id in (m3, m4);

  insert into public.contacts (cell_id, contact_name, contact_phone, tag, follow_up_status, logged_by, notes)
    values (c1, 'Visitor One', '555-0101', 'Interested', 'Will Follow Up', l1, 'met at fair') returning id into ct;
  insert into public.contacts (cell_id, contact_name, tag, follow_up_status, logged_by) values (c1, 'Visitor Two', 'First Timer', 'Contacted', l1);
  insert into public.contacts (cell_id, contact_name, tag, follow_up_status, logged_by) values (c2, 'Visitor Three', 'New Convert', 'Following Up', l2);
  insert into public.contact_tags (contact_id, tag_name, tagged_by) values (ct, 'Interested', l1);
  insert into public.contact_follow_ups (contact_id, assigned_to, assigned_by) values (ct, m1, l1);
  insert into public.contact_audit_log (contact_id, action, changed_by) values (ct, 'created', l1);

  insert into public.meetings (title, date, time, visibility, created_by) values ('Sunday Service', '2030-01-06', '10:00', 'public', adm) returning id into mt;
  insert into public.meetings (title, date, time, visibility, created_by) values ('Leaders Sync', '2030-01-07', '19:00', 'leaders', coord);
  insert into public.meeting_attendances (meeting_id, user_id, user_name, attended) values (mt, m1, 'Member 1', true), (mt, m2, 'Member 2', null);

  insert into public.email_preferences (member_id, weekly_digest, opt_out_all) values (m1, true, false), (m2, false, true), (m3, false, false);
  insert into public.email_log (member_id, recipient_email, subject, template_type, status) values
    (m1, 'legacy.member1@test.invalid', 'Welcome', 'generic', 'sent'), (m2, 'legacy.member2@test.invalid', 'Digest', 'weekly_digest', 'failed');
  insert into public.scheduled_emails (recipient_email, subject, html_content, scheduled_for) values ('legacy.member3@test.invalid', 'Later', '<p>x</p>', '2031-01-01T00:00:00Z');
  insert into public.push_subscriptions (member_id, endpoint, auth, p256dh) values (m1, 'https://push.example/legacy', 'a', 'p');

  insert into public.testimonies (author_id, author_name, title, body, visibility, status) values
    (m1, 'Member 1', 'Healed', 'a long enough testimony body', 'members', 'approved'),
    (m2, 'Member 2', 'Pending one', 'another long testimony body', 'members', 'pending'),
    (m3, 'Member 3', 'Private note', 'my private testimony body', 'private', 'approved');
  insert into public.events (title, date, category, created_by) values ('Retreat', '2030-02-01', 'Fellowship', adm) returning id into ev;
  insert into public.event_rsvps (event_id, user_id) values (ev, m1), (ev, m3);
  insert into public.announcements (title, body, author_id, author_name) values ('Hello', 'Welcome all', adm, 'Admin');
  insert into public.habit_templates (name, created_by) values ('Pray', adm) returning id into tpl;
  insert into public.habit_entries (template_id, user_id, entry_date, status) values (tpl, m1, '2030-01-01', 'done');
  insert into public.books_of_month (title, author, drive_url, active_from, active_until, created_by) values ('Book', 'Author', 'https://drive.example/x', '2030-01-01', '2030-01-31', adm);
  insert into public.monthly_devotionals (month, year, title, book_title, total_days, total_pages, created_by) values (1, 2030, 'Jan', 'B', 31, 100, adm) returning id into dv;
  insert into public.devotional_views (member_id, devotional_id, day_of_month, viewed_date) values (m1, dv, 1, '2030-01-01');
  insert into public.admin_roles (name, created_by) values ('Mail sender', coord) returning id into r;
  insert into public.admin_role_permissions (role_id, permission_key) values (r, 'notifications.send');
  insert into public.admin_role_assignments (role_id, user_id, assigned_by) values (r, m4, coord);
end $$;
