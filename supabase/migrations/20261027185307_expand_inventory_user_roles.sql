alter table inventory.users
drop constraint if exists users_role_check;

alter table inventory.users
add constraint users_role_check
check (role in ('Admin', 'Supervisor', 'Operator', 'Receiving', 'Issue', 'Inspection', 'Viewer'));
