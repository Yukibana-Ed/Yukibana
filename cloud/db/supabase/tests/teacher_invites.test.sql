-- Teacher invites: only an admin creates, lists or removes one, and each gives everyone who accepts it at least teacher rights, until removed.
begin;
select plan(43);

select tests.create_user('ada@example.com', 'Ada', 'ada');
select app.bootstrap_admin('ada@example.com');
select tests.create_user('grace@example.com', 'Grace', 'grace');
select tests.create_user('linus@example.com', 'Linus', 'linus');
select tests.create_user('mallory@example.com', 'Mallory', 'mallory');
select tests.create_user('tim@example.com', 'Tim', 'tim');
select tests.create_user('joan@example.com', 'Joan', 'joan');
select tests.set_platform_role('tim@example.com', 'teacher');

-- Only an admin creates one.
select tests.authenticate(tests.uid('mallory@example.com'));
select throws_ok($$ select app.create_teacher_invite('me') $$, '42501', null, 'a plain user cannot create an invite');
select tests.authenticate(tests.uid('tim@example.com'));
select throws_ok($$ select app.create_teacher_invite('a colleague') $$, '42501', null, 'nor can a teacher, who would otherwise create teachers');
select tests.clear_auth();
set local role anon;
select throws_ok($$ select app.create_teacher_invite('x') $$, '42501', null, 'nor anyone signed out');
select throws_ok($$ select app.redeem_teacher_invite(sha256('x'::bytea)) $$, '42501', null, 'and nobody signed out can accept one');
select throws_ok($$ select app.teacher_invite_exists(sha256('x'::bytea)) $$, '42501', null, 'or ask whether one exists');
select tests.clear_auth();

-- An admin creates three; each secret is returned once.
select tests.authenticate(tests.uid('ada@example.com'));
select set_config('tests.first', app.create_teacher_invite('  Prof. Grace, OS course '), true);
select set_config('tests.second', app.create_teacher_invite(''), true);
select set_config('tests.third', app.create_teacher_invite('to be removed'), true);
select matches(current_setting('tests.first'), '^yk_invite_[0-9a-f]{64}$', 'a secret is 256 random bits after a prefix that names it');
select isnt(current_setting('tests.first'), current_setting('tests.second'), 'two invites have two secrets');
select results_eq(
  $$ select label from public.teacher_invite order by label $$,
  $$ values (''), ('Prof. Grace, OS course'), ('to be removed') $$,
  'an admin lists the unused invites, labels trimmed');
select throws_ok($$ select secret_hash from public.teacher_invite $$, '42501', null, 'but cannot read their hashes, which could be matched against a link');
select is(
  (select count(*) from public.audit_log where action = 'create_teacher_invite' and actor = tests.uid('ada@example.com')),
  3::bigint,
  'creating an invite is audited with the admin as actor');

-- Nobody else sees them, and nobody writes the table directly.
select tests.authenticate(tests.uid('tim@example.com'));
select is_empty($$ select 1 from public.teacher_invite $$, 'a teacher sees no invites');
select tests.authenticate(tests.uid('mallory@example.com'));
select is_empty($$ select 1 from public.teacher_invite $$, 'nor does a plain user');
select throws_ok(
  $$ insert into public.teacher_invite (secret_hash, created_by) values (sha256('mine'::bytea), tests.uid('mallory@example.com')) $$,
  '42501', null, 'a user cannot insert an invite of their own');
select throws_ok($$ update public.teacher_invite set label = 'mine' $$, '42501', null, 'nor change one');
select throws_ok($$ update public.teacher_invite set uses = 0 $$, '42501', null, 'nor reset how often one was used');
select throws_ok($$ delete from public.teacher_invite $$, '42501', null, 'nor delete one');
select throws_ok(
  $$ select app.revoke_teacher_invite((select invite_id from public.teacher_invite limit 1)) $$,
  '42501', null, 'nor remove one through the function');

-- A made-up secret names no invite.
select ok(not app.teacher_invite_exists(sha256('yk_invite_wrong'::bytea)), 'a made-up secret names no invite');
select throws_ok($$ select app.redeem_teacher_invite(sha256('yk_invite_wrong'::bytea)) $$, 'P0002', null, 'and accepting it is refused');
select ok(app.teacher_invite_exists(sha256(convert_to(current_setting('tests.first'), 'UTF8'))), 'a real secret names its invite');

-- A teacher or an admin already has what an invite gives: accepting succeeds and changes nothing, and nobody is demoted.
select tests.authenticate(tests.uid('tim@example.com'));
select lives_ok($$ select app.redeem_teacher_invite(sha256(convert_to(current_setting('tests.first'), 'UTF8'))) $$, 'a teacher who accepts an invite is not refused');
select is(app.platform_role()::text, 'teacher', 'and stays a teacher');
select tests.authenticate(tests.uid('ada@example.com'));
select lives_ok($$ select app.redeem_teacher_invite(sha256(convert_to(current_setting('tests.first'), 'UTF8'))) $$, 'nor is an admin');
select tests.clear_auth();
select is((select role::text from public.app_user where user_id = tests.uid('ada@example.com')), 'admin', 'who is not demoted to teacher');
select is((select uses from public.teacher_invite where label = 'Prof. Grace, OS course'), 0::bigint, 'neither counts as a use');
select is((select count(*) from public.audit_log where action = 'redeem_teacher_invite'), 0::bigint, 'nor is audited, since nothing changed');

-- A plain user accepts: they become a teacher, the invite counts the use, and it is audited.
select tests.authenticate(tests.uid('grace@example.com'));
select lives_ok($$ select app.redeem_teacher_invite(sha256(convert_to(current_setting('tests.first'), 'UTF8'))) $$, 'a plain user accepts an invite');
select ok(app.is_teacher(), 'and is a teacher from then on, so may create courses');
select tests.clear_auth();
select is(
  (select subject ->> 'label' from public.audit_log where action = 'redeem_teacher_invite' and actor = tests.uid('grace@example.com')),
  'Prof. Grace, OS course',
  'accepting is audited with who accepted which invite');

-- Reusable: the next person with the same link becomes a teacher too, and the link stays.
select tests.authenticate(tests.uid('linus@example.com'));
select ok(app.teacher_invite_exists(sha256(convert_to(current_setting('tests.first'), 'UTF8'))), 'an accepted invite still exists');
select lives_ok($$ select app.redeem_teacher_invite(sha256(convert_to(current_setting('tests.first'), 'UTF8'))) $$, 'a second person uses the same link');
select is(app.platform_role()::text, 'teacher', 'and becomes a teacher as well');
select tests.authenticate(tests.uid('grace@example.com'));
select lives_ok($$ select app.redeem_teacher_invite(sha256(convert_to(current_setting('tests.first'), 'UTF8'))) $$, 'accepting a second time is harmless');
select tests.clear_auth();
select is((select uses from public.teacher_invite where label = 'Prof. Grace, OS course'), 2::bigint, 'the invite counts the two teachers it made, once each');

-- Removed: an admin removes invites one by one, a removed link is dead for everyone, and the teachers it made stay teachers.
select tests.authenticate(tests.uid('ada@example.com'));
select lives_ok(
  $$ select app.revoke_teacher_invite((select invite_id from public.teacher_invite where label = 'to be removed')) $$,
  'an admin removes an invite');
select throws_ok(
  $$ select app.revoke_teacher_invite((select invite_id from public.teacher_invite where label = 'to be removed')) $$,
  'P0002', null, 'removing it again says it is gone');
select lives_ok(
  $$ select app.revoke_teacher_invite((select invite_id from public.teacher_invite where label = 'Prof. Grace, OS course')) $$,
  'an admin removes an invite that was used');
select tests.clear_auth();
select is(
  (select (subject ->> 'uses')::int from public.audit_log where action = 'revoke_teacher_invite' and subject ->> 'label' = 'Prof. Grace, OS course'),
  2,
  'the removal is audited with how often the invite was used');
select tests.authenticate(tests.uid('joan@example.com'));
select throws_ok($$ select app.redeem_teacher_invite(sha256(convert_to(current_setting('tests.third'), 'UTF8'))) $$, 'P0002', null, 'a removed link cannot be accepted');
select throws_ok($$ select app.redeem_teacher_invite(sha256(convert_to(current_setting('tests.first'), 'UTF8'))) $$, 'P0002', null, 'nor can a used one once removed');
select is(app.platform_role()::text, 'user', 'and the person who tried stays a plain user');
select tests.authenticate(tests.uid('tim@example.com'));
select throws_ok($$ select app.redeem_teacher_invite(sha256(convert_to(current_setting('tests.first'), 'UTF8'))) $$, 'P0002', null, 'a teacher is told a removed link is dead, too');
select tests.authenticate(tests.uid('linus@example.com'));
select ok(app.is_teacher(), 'the teachers a removed link made stay teachers');

select * from finish();
rollback;
