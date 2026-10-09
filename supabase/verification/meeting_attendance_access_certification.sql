-- Meeting attendance RLS certification.
-- Run against a local replayed database after applying migration 026.
-- This script is intentionally transactional and rolls back all fixture data.

begin;

create extension if not exists pgcrypto;

create or replace function pg_temp.as_auth(user_id uuid)
returns void
language plpgsql
as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
end $$;

do $$
declare
  active_member_id uuid := gen_random_uuid();
  unrelated_member_id uuid := gen_random_uuid();
  pending_member_id uuid := gen_random_uuid();
  rejected_member_id uuid := gen_random_uuid();
  coordinator_id uuid := gen_random_uuid();
  leader_id uuid := gen_random_uuid();
  meeting_owner_id uuid := gen_random_uuid();
  test_cell_id uuid := gen_random_uuid();
  test_meeting_id uuid := gen_random_uuid();
  other_attendance_id uuid := gen_random_uuid();
  visible_count integer;
begin
  insert into auth.users (id, email, encrypted_password, aud, role, created_at, updated_at)
  values
    (active_member_id, 'attendance-active@example.invalid', 'x', 'authenticated', 'authenticated', now(), now()),
    (unrelated_member_id, 'attendance-unrelated@example.invalid', 'x', 'authenticated', 'authenticated', now(), now()),
    (pending_member_id, 'attendance-pending@example.invalid', 'x', 'authenticated', 'authenticated', now(), now()),
    (rejected_member_id, 'attendance-rejected@example.invalid', 'x', 'authenticated', 'authenticated', now(), now()),
    (coordinator_id, 'attendance-coordinator@example.invalid', 'x', 'authenticated', 'authenticated', now(), now()),
    (leader_id, 'attendance-leader@example.invalid', 'x', 'authenticated', 'authenticated', now(), now()),
    (meeting_owner_id, 'attendance-owner@example.invalid', 'x', 'authenticated', 'authenticated', now(), now());

  insert into public.profiles (id, email, full_name, role, status)
  values
    (active_member_id, 'attendance-active@example.invalid', 'Attendance Active', 'member', 'active'),
    (unrelated_member_id, 'attendance-unrelated@example.invalid', 'Attendance Unrelated', 'member', 'active'),
    (pending_member_id, 'attendance-pending@example.invalid', 'Attendance Pending', 'member', 'pending'),
    (rejected_member_id, 'attendance-rejected@example.invalid', 'Attendance Rejected', 'member', 'rejected'),
    (coordinator_id, 'attendance-coordinator@example.invalid', 'Attendance Coordinator', 'coordinator', 'active'),
    (leader_id, 'attendance-leader@example.invalid', 'Attendance Leader', 'cell_leader', 'active'),
    (meeting_owner_id, 'attendance-owner@example.invalid', 'Attendance Owner', 'member', 'active')
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    role = excluded.role,
    status = excluded.status;

  insert into public.cells (id, name, leader_id)
  values (test_cell_id, 'Attendance Test Cell', leader_id);

  update public.profiles set cell_id = test_cell_id where id in (leader_id, active_member_id);

  insert into public.meetings (id, title, date, time, visibility, cell_id, created_by)
  values (test_meeting_id, 'Attendance Test Meeting', current_date, '19:00', 'public', test_cell_id, meeting_owner_id);

  insert into public.meeting_attendances (id, meeting_id, user_id, user_name)
  values
    (gen_random_uuid(), test_meeting_id, active_member_id, 'Attendance Active'),
    (other_attendance_id, test_meeting_id, unrelated_member_id, 'Attendance Unrelated');

  perform pg_temp.as_auth(active_member_id);
  select count(*) into visible_count from public.meeting_attendances where meeting_id = test_meeting_id;
  if visible_count <> 1 then
    raise exception 'active member must see only their own attendance row';
  end if;

  if not exists (select 1 from public.meetings where id = test_meeting_id) then
    raise exception 'dashboard meeting query without attendance embedding must remain readable';
  end if;

  perform pg_temp.as_auth(unrelated_member_id);
  select count(*) into visible_count from public.meeting_attendances where meeting_id = test_meeting_id;
  if visible_count <> 1 then
    raise exception 'unrelated active member must see only their own attendance row';
  end if;

  perform pg_temp.as_auth(pending_member_id);
  select count(*) into visible_count from public.meeting_attendances where meeting_id = test_meeting_id;
  if visible_count <> 0 then
    raise exception 'pending member must not read attendance rows';
  end if;

  perform pg_temp.as_auth(rejected_member_id);
  select count(*) into visible_count from public.meeting_attendances where meeting_id = test_meeting_id;
  if visible_count <> 0 then
    raise exception 'rejected member must not read attendance rows';
  end if;

  perform pg_temp.as_auth(coordinator_id);
  select count(*) into visible_count from public.meeting_attendances where meeting_id = test_meeting_id;
  if visible_count <> 2 then
    raise exception 'coordinator must read attendance rows for export/management';
  end if;

  perform pg_temp.as_auth(leader_id);
  select count(*) into visible_count from public.meeting_attendances where meeting_id = test_meeting_id;
  if visible_count <> 2 then
    raise exception 'cell leader must read attendance rows for their cell meeting';
  end if;

  update public.meeting_attendances set attended = true where id = other_attendance_id;
  if not exists (select 1 from public.meeting_attendances where id = other_attendance_id and attended is true) then
    raise exception 'cell leader must mark attendance for their cell meeting';
  end if;

  perform pg_temp.as_auth(meeting_owner_id);
  select count(*) into visible_count from public.meeting_attendances where meeting_id = test_meeting_id;
  if visible_count <> 2 then
    raise exception 'meeting owner must read attendance rows for owned meeting';
  end if;
end $$;

rollback;
