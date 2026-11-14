-- Profile pictures: a person sets and removes only their own, and only people who may see a profile see its picture.
begin;
select plan(20);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
select tests.set_platform_role('teacher@example.com', 'teacher');
select tests.create_user('student@example.com', 'Student', 'student');
select tests.create_user('stranger@example.com', 'Stranger', 'stranger');
select tests.create_user('ada@example.com', 'Ada', 'ada');
select app.bootstrap_admin('ada@example.com');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-PIC', 'Pictures');
select app.create_edition((select course_id from public.course where code = 'T-PIC'), '2026');
select app.enrol(tests.edition('T-PIC', '2026'), 'student@example.com');

-- Nobody signed out sets or removes one.
select tests.clear_auth();
set local role anon;
select throws_ok($$ select app.set_profile_picture(gen_random_uuid()) $$, '42501', null, 'nobody signed out can set a picture');
select throws_ok($$ select app.clear_profile_picture() $$, '42501', null, 'nor remove one');
select throws_ok($$ select 1 from public.profile_picture $$, '42501', null, 'nor read whose picture is which');
select tests.clear_auth();

-- A person sets their own; the first one replaces nothing.
select tests.authenticate(tests.uid('student@example.com'));
select is(app.set_profile_picture('00000000-0000-4000-8000-000000000001'), null, 'a first picture replaces nothing');
select is(
  app.set_profile_picture('00000000-0000-4000-8000-000000000002'),
  '00000000-0000-4000-8000-000000000001'::uuid,
  'a second one says which it replaced, so that its object can be deleted');
select results_eq(
  $$ select picture_id from public.profile_picture where user_id = tests.uid('student@example.com') $$,
  $$ values ('00000000-0000-4000-8000-000000000002'::uuid) $$,
  'and a person has one picture, the latest');
select tests.clear_auth();
select is(
  (select count(*) from public.audit_log where action = 'set_profile_picture' and actor = tests.uid('student@example.com')),
  2::bigint,
  'setting a picture is audited');

-- Nobody writes the table directly, or takes someone else's picture.
select tests.authenticate(tests.uid('stranger@example.com'));
select throws_ok(
  $$ insert into public.profile_picture (user_id, picture_id) values (tests.uid('stranger@example.com'), gen_random_uuid()) $$,
  '42501', null, 'a person cannot insert a picture row');
select throws_ok(
  $$ update public.profile_picture set user_id = tests.uid('stranger@example.com') $$,
  '42501', null, 'nor move someone''s picture to themselves');
select throws_ok($$ delete from public.profile_picture $$, '42501', null, 'nor delete someone''s picture');
select throws_ok(
  $$ select app.set_profile_picture('00000000-0000-4000-8000-000000000002') $$,
  '23505', null, 'nor claim the object of someone else''s picture as their own');

-- Only those who may see a profile see its picture.
select is_empty($$ select 1 from public.profile_picture where user_id = tests.uid('student@example.com') $$,
  'a stranger does not see the picture of a student they share no edition with');
select tests.authenticate(tests.uid('teacher@example.com'));
select isnt_empty($$ select 1 from public.profile_picture where user_id = tests.uid('student@example.com') $$,
  'the student''s teacher does');
select tests.authenticate(tests.uid('ada@example.com'));
select isnt_empty($$ select 1 from public.profile_picture where user_id = tests.uid('student@example.com') $$, 'and so does an admin');

-- Removing: only one's own, and removing nothing is fine.
select tests.authenticate(tests.uid('teacher@example.com'));
select is(app.clear_profile_picture(), null, 'a teacher with no picture removes nothing, and is not refused');
select tests.clear_auth();
select is((select count(*) from public.profile_picture), 1::bigint, 'and the student''s picture is still there');
select is(
  (select count(*) from public.audit_log where action = 'clear_profile_picture'),
  0::bigint,
  'removing nothing audits nothing');
select tests.authenticate(tests.uid('student@example.com'));
select is(app.clear_profile_picture(), '00000000-0000-4000-8000-000000000002'::uuid, 'the student removes theirs and is told which object to delete');
select is_empty($$ select 1 from public.profile_picture $$, 'after which they have none');

-- A deleted account takes its picture row with it.
select app.set_profile_picture(gen_random_uuid());
select tests.clear_auth();
delete from auth.users where id = tests.uid('student@example.com');
select is((select count(*) from public.profile_picture), 0::bigint, 'deleting an account deletes its picture row');

select * from finish();
rollback;
