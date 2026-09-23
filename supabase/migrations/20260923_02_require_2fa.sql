-- Layer 2: every data request must come from a session that passed two-step login (aal2).
-- Apply only AFTER the new frontend (with the 2FA screens) is deployed, otherwise staff are locked out.
create or replace function public.mfa_ok() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;
