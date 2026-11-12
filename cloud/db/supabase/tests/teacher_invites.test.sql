-- Invite links that make a teacher: only an admin makes, sees or removes
-- one, it works once, for a plain user only, and not after it expires.
begin;
select plan(33);

select tests.create_user('ada@example.com', 'Ada', 'ada');
select app.bootstrap_admin('ada@example.com');
select tests.create_user('grace@example.com', 'Grace', 'grace');
select tests.create_user('linus@example.com', 'Linus', 'linus');
select tests.create_user('mallory@example.com', 'Mallory', 'mallory');
select tests.create_user('tim@example.com', 'Tim', 'tim');
select tests.authenticate(tests.uid('ada@example.com'));
select app.set_platform_role(tests.uid('tim@example.com'), 'teacher');

-- Only an admin makes one.
select tests.authenticate(tests.uid('mallory@example.com'));
select throws_ok($$ select app.create_teacher_invite('me') $$, '42501', null, 'a plain user cannot make an invite');
select tests.authenticate(tests.uid('tim@example.com'));
select throws_ok($$ select app.create_teacher_invite('a colleague') $$, '42501', null, 'nor can a teacher, who could otherwise make teachers');
select tests.clear_auth();
set local role anon;
select throws_ok($$ select app.create_teacher_invite('x') $$, '42501', null, 'nor anyone signed out');
select throws_ok($$ select app.redeem_teacher_invite(sha256('x'::bytea)) $$, '42501', null, 'and nobody signed out may accept one');
select tests.clear_auth();

-- The admin makes two; the secrets come back once, as `yk_invite_` and 64 hex digits.
select tests.authenticate(tests.uid('ada@example.com'));
select set_config('tests.first', app.create_teacher_invite('  Prof. Grace, OS course '), true);
select set_config('tests.second', app.create_teacher_invite(''), true);
select set_config('tests.third', app.create_teacher_invite('to be removed'), true);
select matches(current_setting('tests.first'), '^yk_invite_[0-9a-f]{64}$', 'an invite''s secret is 256 random bits with a prefix that names it');
select isnt(current_setting('tests.first'), current_setting('tests.second'), 'and two invites have two secrets');
select results_eq(
  $$ select label from public.teacher_invite order by label $$,
  $$ values (''), ('Prof. Grace, OS course'), ('to be removed') $$,
  'an admin lists the unused invites, with the label trimmed');
select throws_ok($$ select secret_hash from public.teacher_invite $$, '42501', null, 'but not their hashes, the one column that could be matched against a link');
select is(
  (select count(*) from public.audit_log where action = 'create_teacher_invite' and actor = tests.uid('ada@example.com')),
  3::bigint,
  'making an invite is audited with the admin as actor');

-- Nobody else sees them, and nobody writes the table directly.
select tests.authenticate(tests.uid('tim@example.com'));
select is_empty($$ select 1 from public.teacher_invite $$, 'a teacher sees no invites');
select tests.authenticate(tests.uid('mallory@example.com'));
select is_empty($$ select 1 from public.teacher_invite $$, 'nor does a plain user');
select throws_ok(
  $$ insert into public.teacher_invite (secret_hash, created_by, expires_at) values (sha256('mine'::bytea), tests.uid('mallory@example.com'), now() + interval '1 day') $$,
  '42501', null, 'a user cannot insert an invite of their own');
select throws_ok($$ update public.teacher_invite set expires_at = now() + interval '1 year' $$, '42501', null, 'nor extend one');
select throws_ok($$ delete from public.teacher_invite $$, '42501', null, 'nor delete one');
select throws_ok(
  $$ select app.revoke_teacher_invite((select invite_id from public.teacher_invite limit 1)) $$,
  '42501', null, 'nor remove one through the function');

-- Accepting: a wrong secret is unknown and changes nothing.
select is(app.teacher_invite_status(sha256('yk_invite_wrong'::bytea)), 'unknown', 'a link with a made-up secret is unknown');
select throws_ok($$ select app.redeem_teacher_invite(sha256('yk_invite_wrong'::bytea)) $$, 'P0002', null, 'and accepting it is refused');
select is(app.teacher_invite_status(sha256(convert_to(current_setting('tests.first'), 'UTF8'))), 'open', 'a real link is open');

-- A teacher or an admin is refused, and the invite stays for its person.
select tests.authenticate(tests.uid('tim@example.com'));
select throws_ok($$ select app.redeem_teacher_invite(sha256(convert_to(current_setting('tests.first'), 'UTF8'))) $$, '42501', null, 'a teacher who opens an invite does not spend it');
select tests.authenticate(tests.uid('ada@example.com'));
select throws_ok($$ select app.redeem_teacher_invite(sha256(convert_to(current_setting('tests.first'), 'UTF8'))) $$, '42501', null, 'an admin who opens one is not lowered to teacher');
select tests.clear_auth();
select is((select role::text from public.app_user where user_id = tests.uid('ada@example.com')), 'admin', 'and stays an admin');
select is((select count(*) from public.teacher_invite), 3::bigint, 'and every invite is still there');

-- A plain user accepts: they become a teacher, the invite is gone, and it is audited.
select tests.authenticate(tests.uid('grace@example.com'));
select lives_ok($$ select app.redeem_teacher_invite(sha256(convert_to(current_setting('tests.first'), 'UTF8'))) $$, 'a plain user accepts an invite');
select ok(app.is_teacher(), 'and is a teacher from then on, so may create courses');
select tests.clear_auth();
select is(
  (select subject ->> 'label' from public.audit_log where action = 'redeem_teacher_invite' and actor = tests.uid('grace@example.com')),
  'Prof. Grace, OS course',
  'accepting is audited with who accepted which invite');

-- Single use: the next person with the same link gets nothing.
select tests.authenticate(tests.uid('linus@example.com'));
select is(app.teacher_invite_status(sha256(convert_to(current_setting('tests.first'), 'UTF8'))), 'unknown', 'a used link is no longer known');
select throws_ok($$ select app.redeem_teacher_invite(sha256(convert_to(current_setting('tests.first'), 'UTF8'))) $$, 'P0002', null, 'a second person cannot use the same link');
select is(app.platform_role()::text, 'user', 'and stays a plain user');

-- Expired: refused, but still listed for the admin to see and remove.
select tests.clear_auth();
update public.teacher_invite set created_at = now() - interval '15 days', expires_at = now() - interval '1 day'
where secret_hash = sha256(convert_to(current_setting('tests.second'), 'UTF8'));
select tests.authenticate(tests.uid('linus@example.com'));
select is(app.teacher_invite_status(sha256(convert_to(current_setting('tests.second'), 'UTF8'))), 'expired', 'an invite past its two weeks is expired');
select throws_ok($$ select app.redeem_teacher_invite(sha256(convert_to(current_setting('tests.second'), 'UTF8'))) $$, '42501', null, 'and cannot be accepted');

-- Removed: an admin removes one by one, and a removed link is dead.
select tests.authenticate(tests.uid('ada@example.com'));
select lives_ok(
  $$ select app.revoke_teacher_invite((select invite_id from public.teacher_invite where label = 'to be removed')) $$,
  'an admin removes an unused invite');
select throws_ok(
  $$ select app.revoke_teacher_invite((select invite_id from public.teacher_invite where label = 'to be removed')) $$,
  'P0002', null, 'removing it again says it is gone');
select tests.authenticate(tests.uid('linus@example.com'));
select throws_ok($$ select app.redeem_teacher_invite(sha256(convert_to(current_setting('tests.third'), 'UTF8'))) $$, 'P0002', null, 'a removed link cannot be accepted');

select * from finish();
rollback;
