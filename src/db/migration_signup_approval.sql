-- ============================================================
-- Migration: Member sign-up with approval workflow
-- Run in: Supabase > SQL Editor
-- ============================================================

-- 1. Add status column (existing members stay 'active')
alter table public.profiles
  add column if not exists status text not null default 'active'
  check (status in ('pending', 'active', 'rejected'));

-- 2. Add student_number column
alter table public.profiles
  add column if not exists student_number text;

-- 3. Update trigger so new self-registered accounts start as 'pending'
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, full_name, student_number, status)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'student_number',
    case
      when new.raw_user_meta_data->>'full_name' is not null and new.raw_user_meta_data->>'full_name' <> ''
      then 'pending'
      else 'active'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 4. Allow admins/coordinators/cell_leaders to update member status and info
drop policy if exists "leaders_manage_profiles" on public.profiles;
create policy "leaders_manage_profiles" on public.profiles
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and p.role in ('admin', 'coordinator', 'cell_leader')
    )
  );
