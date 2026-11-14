-- Who sees a person's name and picture: whom they chose, for each separately, and nobody else, admins included.
begin;
select plan(28);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
select tests.set_platform_role('teacher@example.com', 'teacher');
select tests.create_user('student@example.com', 'Sam Student', 'sam');
select tests.create_user('stranger@example.com', 'Stranger', 'stranger');
select tests.create_user('ada@example.com', 'Ada', 'ada');
select app.bootstrap_admin('ada@example.com');

select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-VIS', 'Visibility');
select app.create_edition((select course_id from public.course where code = 'T-VIS'), '2026');
select app.enrol(tests.edition('T-VIS', '2026'), 'student@example.com');
select tests.authenticate(tests.uid('student@example.com'));
select app.set_profile_picture('00000000-0000-4000-8000-0000000000a1');

-- The name is never read from the table, by anyone, their own included.
select throws_ok($$ select full_name from public.app_user $$, '42501', null, 'nobody reads names from the profile table');
select throws_ok($$ update public.app_user set full_name = 'X' where user_id = tests.uid('student@example.com') $$, '42501', null, 'nor writes one there, unchecked and unaudited');
select throws_ok($$ update public.app_user set name_audience = 'public' where user_id = tests.uid('student@example.com') $$, '42501', null, 'nor an audience');

-- By default, today's rule: themselves and the people in their courses.
select is(app.visible_name(tests.uid('student@example.com')), 'Sam Student', 'a person sees their own name');
select tests.authenticate(tests.uid('teacher@example.com'));
select is(app.visible_name(tests.uid('student@example.com')), 'Sam Student', 'their teacher sees it by default');
select isnt_empty($$ select 1 from public.profile_picture where user_id = tests.uid('student@example.com') $$, 'and their picture');
select tests.authenticate(tests.uid('stranger@example.com'));
select is(app.visible_name(tests.uid('student@example.com')), null, 'a stranger does not see the name by default');
select is_empty($$ select 1 from public.profile_picture where user_id = tests.uid('student@example.com') $$, 'nor the picture');

-- Only me: nobody else, not their teacher, not an admin.
select tests.authenticate(tests.uid('student@example.com'));
select lives_ok($$ select app.set_profile('  Samantha  ', 'private', 'private') $$, 'a person makes their name and picture their own');
select is(app.visible_name(tests.uid('student@example.com')), 'Samantha', 'and still sees their name, trimmed');
select isnt_empty($$ select 1 from public.profile_picture where user_id = tests.uid('student@example.com') $$, 'and their picture');
select tests.authenticate(tests.uid('teacher@example.com'));
select is(app.visible_name(tests.uid('student@example.com')), null, 'their teacher no longer sees the name');
select is_empty($$ select 1 from public.profile_picture where user_id = tests.uid('student@example.com') $$, 'nor the picture');
select isnt_empty($$ select 1 from public.enrollment where email = 'student@example.com' $$, 'but still has them on the roster, by address');
select tests.authenticate(tests.uid('ada@example.com'));
select is(app.visible_name(tests.uid('student@example.com')), null, 'an admin does not see a private name either');
select is_empty($$ select 1 from public.profile_picture where user_id = tests.uid('student@example.com') $$, 'nor a private picture');

-- Each setting on its own: a public name with a private picture.
select tests.authenticate(tests.uid('student@example.com'));
select app.set_profile('Samantha', 'public', 'private');
select tests.authenticate(tests.uid('stranger@example.com'));
select is(app.visible_name(tests.uid('student@example.com')), 'Samantha', 'anyone signed in sees a public name');
select is_empty($$ select 1 from public.profile_picture where user_id = tests.uid('student@example.com') $$, 'and still not the picture kept private');

-- And the other way round: a private name with a public picture.
select tests.authenticate(tests.uid('student@example.com'));
select app.set_profile('Samantha', 'private', 'public');
select tests.authenticate(tests.uid('stranger@example.com'));
select is(app.visible_name(tests.uid('student@example.com')), null, 'a private name stays private beside a public picture');
select isnt_empty($$ select 1 from public.profile_picture where user_id = tests.uid('student@example.com') $$, 'which a stranger does see');

-- Nobody signed out sees anything, whatever was chosen.
select tests.clear_auth();
set local role anon;
select throws_ok($$ select app.visible_name(tests.uid('student@example.com')) $$, '42501', null, 'nobody signed out can ask for a name');
select throws_ok($$ select app.set_profile('x', 'public', 'public') $$, '42501', null, 'or set one');
select tests.clear_auth();

-- A person sets only their own profile, and within bounds.
select tests.authenticate(tests.uid('stranger@example.com'));
select app.set_profile('', 'courses', 'courses');
select tests.authenticate(tests.uid('student@example.com'));
select is(app.visible_name(tests.uid('student@example.com')), 'Samantha', 'someone else saving their own profile changes nobody else''s');
select throws_ok($$ select app.set_profile(repeat('x', 101), 'public', 'public') $$, '23514', null, 'a name is at most 100 characters');
select tests.authenticate(tests.uid('stranger@example.com'));
select is(app.visible_name(tests.uid('stranger@example.com')), null, 'an empty name is no name');
select tests.clear_auth();
select is(
  (select count(*) from public.audit_log where action = 'set_profile' and actor = tests.uid('student@example.com')),
  3::bigint,
  'saving a profile is audited');

-- A name the person set survives their next login, which used to write the provider's over it.
update auth.users set raw_user_meta_data = '{"full_name": "Provider Name", "user_name": "sam"}' where id = tests.uid('student@example.com');
select is((select full_name from public.app_user where user_id = tests.uid('student@example.com')), 'Samantha', 'a login keeps the name the person chose');
update auth.users set raw_user_meta_data = '{"full_name": "Provider Name", "user_name": "stranger"}' where id = tests.uid('stranger@example.com');
select is((select full_name from public.app_user where user_id = tests.uid('stranger@example.com')), 'Provider Name', 'and fills in a name only where there is none');

select * from finish();
rollback;
