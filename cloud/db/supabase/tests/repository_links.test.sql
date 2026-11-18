-- Repository links: only an owner links or unlinks a project, staff alone
-- read a link, and a CI job publishes only from a tag of the very repository
-- (by id and owner id) that an owner still in the edition linked.
begin;
select plan(52);

select tests.create_user('teacher@example.com', 'Teacher', 'teacher');
update public.app_user set role = 'teacher' where user_id = tests.uid('teacher@example.com');
select tests.create_user('other@example.com', 'Other', 'other');
update public.app_user set role = 'teacher' where user_id = tests.uid('other@example.com');
select tests.create_user('ta@example.com', 'Assistant', 'ta');
select tests.create_user('student@example.com', 'Student', 'student');

-- Two editions of one course, owned by two teachers. A, B and C are in the
-- first; D, in the second, will link the same repository as A.
select tests.authenticate(tests.uid('teacher@example.com'));
select app.create_course('T-LINK', 'Links');
select app.create_edition((select course_id from public.course where code = 'T-LINK'), '2026');
select app.enrol(tests.edition('T-LINK', '2026'), 'ta@example.com', 'assistant');
select app.enrol(tests.edition('T-LINK', '2026'), 'student@example.com');
insert into public.project (edition_id, slug, title, kind)
values (tests.edition('T-LINK', '2026'), 'link-a', 'A', 'rust-cargo'),
       (tests.edition('T-LINK', '2026'), 'link-b', 'B', 'rust-cargo'),
       (tests.edition('T-LINK', '2026'), 'link-c', 'C', 'rust-cargo');
select app.create_edition((select course_id from public.course where code = 'T-LINK'), '2027');
select app.enrol(tests.edition('T-LINK', '2027'), 'other@example.com', 'owner');
select tests.authenticate(tests.uid('other@example.com'));
insert into public.project (edition_id, slug, title, kind)
values (tests.edition('T-LINK', '2027'), 'link-d', 'D', 'rust-cargo');
-- The teacher leaves the 2027 edition to its owner, so that they are an
-- owner of another edition there and nothing more.
select app.unenrol(tests.edition('T-LINK', '2027'), 'teacher@example.com');

-- Nobody but an owner of the project's edition links one.
select tests.authenticate(tests.uid('student@example.com'));
select throws_ok($$ select app.link_repository(tests.project('link-a'), '101', '9', 'course/repo') $$,
  '42501', null, 'a student cannot link a repository to a project');
select tests.authenticate(tests.uid('ta@example.com'));
select throws_ok($$ select app.link_repository(tests.project('link-a'), '101', '9', 'course/repo') $$,
  '42501', null, 'nor can an assistant, who may publish by hand but holds no publishing credential');
select tests.authenticate(tests.uid('other@example.com'));
select throws_ok($$ select app.link_repository(tests.project('link-a'), '101', '9', 'course/repo') $$,
  '42501', null, 'nor an owner of another edition of the same course');
select tests.clear_auth();
set local role anon;
select throws_ok($$ select app.link_repository(gen_random_uuid(), '101', '9', 'course/repo') $$,
  '42501', null, 'nor anyone signed out');
select tests.clear_auth();
select is((select count(*) from public.repository_link), 0::bigint, 'and none of them left a link behind');

-- An owner links; the ids must be GitHub's numbers.
select tests.authenticate(tests.uid('teacher@example.com'));
select throws_ok($$ select app.link_repository(tests.project('link-a'), 'course/repo', '9', 'course/repo') $$,
  '23514', null, 'a repository id that is not GitHub''s number is refused');
select throws_ok($$ select app.link_repository(tests.project('link-a'), '101', 'course', 'course/repo') $$,
  '23514', null, 'and so is an owner given by name');
select isnt(app.link_repository(tests.project('link-a'), '101', '9', 'course/repo'), null,
  'an owner links a repository to their project');
select app.link_repository(tests.project('link-b'), '202', '9', 'course/other');
select tests.authenticate(tests.uid('other@example.com'));
select app.link_repository(tests.project('link-d'), '101', '9', 'course/repo');

-- Linking again replaces: a project has one source.
select tests.authenticate(tests.uid('teacher@example.com'));
select app.link_repository(tests.project('link-b'), '303', '9', 'course/third');
select app.link_repository(tests.project('link-b'), '202', '9', 'course/other');
select results_eq(
  $$ select repository_id from public.repository_link where project_id = tests.project('link-b') $$,
  $$ values ('202') $$,
  'linking a linked project again replaces its link instead of adding one');
select tests.clear_auth();
select is(
  (select count(*) from public.audit_log where action = 'link_repository' and actor = tests.uid('teacher@example.com')),
  4::bigint,
  'every link is audited with the owner who made it');
select is(
  (select subject->'replaced'->>'repository_id' from public.audit_log
   where action = 'link_repository' and subject->>'repository_id' = '202' and subject->>'replaced' is not null),
  '303',
  'and a replaced link is named in the audit row of the one that replaced it');

-- Reading: staff of the edition, nobody else.
select tests.authenticate(tests.uid('student@example.com'));
select is_empty($$ select 1 from public.repository_link $$, 'a student reads no link');
select tests.authenticate(tests.uid('other@example.com'));
select results_eq($$ select repository from public.repository_link $$, $$ values ('course/repo') $$,
  'an owner of another edition reads only their own project''s link, not this edition''s');
select tests.authenticate(tests.uid('ta@example.com'));
select is((select count(*) from public.repository_link), 2::bigint, 'an assistant reads the links of their edition');

-- Nobody writes the table but the functions.
select throws_ok(
  $$ insert into public.repository_link (project_id, repository_id, owner_id, repository, linked_by)
     values (tests.project('link-c'), '404', '9', 'mine/repo', tests.uid('ta@example.com')) $$,
  '42501', null, 'an assistant cannot insert a link directly');
select tests.authenticate(tests.uid('teacher@example.com'));
select throws_ok(
  $$ insert into public.repository_link (project_id, repository_id, owner_id, repository, linked_by)
     values (tests.project('link-c'), '404', '9', 'mine/repo', tests.uid('teacher@example.com')) $$,
  '42501', null, 'nor can an owner, whose link would skip the audit and GitHub''s proof');
select throws_ok($$ update public.repository_link set owner_id = '8' $$, '42501', null, 'nor change a link''s owner id');
select throws_ok($$ delete from public.repository_link $$, '42501', null, 'nor delete one');

-- Unlinking: owners only.
select tests.authenticate(tests.uid('student@example.com'));
select throws_ok($$ select app.unlink_repository(tests.project('link-a')) $$, '42501', null, 'a student cannot unlink');
select tests.authenticate(tests.uid('ta@example.com'));
select throws_ok($$ select app.unlink_repository(tests.project('link-a')) $$, '42501', null, 'nor can an assistant');
select tests.authenticate(tests.uid('other@example.com'));
select throws_ok($$ select app.unlink_repository(tests.project('link-a')) $$, '42501', null, 'nor an owner of another edition');
select tests.authenticate(tests.uid('teacher@example.com'));
select throws_ok($$ select app.unlink_repository(tests.project('link-c')) $$, 'P0002', null, 'unlinking a project with no link says so');
select tests.clear_auth();
select is((select count(*) from public.repository_link), 3::bigint, 'and every link is still there');

-- What the roles may call at all.
select ok(not has_table_privilege('yukibana_publisher', 'public.repository_link', 'select'),
  'the publisher has no select on the links: a CI job asks its two functions and reads nothing');
select ok(not has_function_privilege('authenticated',
  'app.publish_release_with_repository(text, text, text, text, uuid, uuid, text, text, text, bigint, bytea, text, bigint, bytea)', 'execute'),
  'nobody signed in may publish as a repository');
select ok(not has_function_privilege('authenticated', 'app.ci_projects(text, text, text)', 'execute'),
  'nor ask which projects a repository publishes to');
select ok(not has_function_privilege('anon', 'app.ci_projects(text, text, text)', 'execute'),
  'and neither may anyone signed out');
select ok(not has_function_privilege('yukibana_publisher', 'app.link_repository(uuid, text, text, text)', 'execute'),
  'a CI job cannot link a repository');
select ok(not has_function_privilege('authenticated', 'app.link_owner_current(uuid, uuid)', 'execute'),
  'and the helper that checks the linking owner is nobody''s to call');

-- Publishing by link. As in projects.test.sql, the publisher acts and the
-- assertions come afterwards: it has usage on nothing a pgTAP assertion
-- needs. `try_publish` turns a refusal into its SQLSTATE and message.
create function tests.try_publish(repository_id text, owner_id text, ref text, project uuid, release uuid)
returns text
language plpgsql
as $$
begin
  return app.publish_release_with_repository($1, $2, $3, 'course/repo-renamed', $4, $5, 'v1', 'abc123',
    'starters/' || $5, 1, decode(repeat('aa', 32), 'hex'), 'teacher/' || $5, 1, decode(repeat('bb', 32), 'hex'))::text;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end
$$;
grant execute on function tests.try_publish(text, text, text, uuid, uuid) to yukibana_publisher;
create temporary table did (what text primary key, value text);
create temporary table ci as select ''::text as what, * from app.ci_projects('0', '0', '') limit 0;
grant select, insert on did, ci to yukibana_publisher;

select tests.as_publisher();
insert into did values ('moved', tests.try_publish('101', '8', 'refs/tags/v1', tests.project('link-a'), '00000000-0000-7000-8000-0000000001a1'));
insert into did values ('branch', tests.try_publish('101', '9', 'refs/heads/main', tests.project('link-a'), '00000000-0000-7000-8000-0000000001a2'));
insert into did values ('unlinked', tests.try_publish('101', '9', 'refs/tags/v1', tests.project('link-c'), '00000000-0000-7000-8000-0000000001a3'));
insert into did values ('elsewhere', tests.try_publish('101', '9', 'refs/tags/v1', tests.project('link-b'), '00000000-0000-7000-8000-0000000001a4'));
insert into did values ('own', tests.try_publish('101', '9', 'refs/tags/v1', tests.project('link-a'), '00000000-0000-7000-8000-0000000001a5'));
insert into did values ('again', tests.try_publish('101', '9', 'refs/tags/v1', tests.project('link-a'), '00000000-0000-7000-8000-0000000001a5'));
insert into did values ('second', tests.try_publish('101', '9', 'refs/tags/v1', tests.project('link-d'), '00000000-0000-7000-8000-0000000001a6'));
insert into ci select 'tag', * from app.ci_projects('101', '9', 'refs/tags/v1');
insert into ci select 'branch', * from app.ci_projects('101', '9', 'refs/heads/main');
insert into ci select 'moved', * from app.ci_projects('101', '8', 'refs/tags/v1');
insert into ci select 'nothing', * from app.ci_projects('999', '9', 'refs/tags/v1');
do $$
begin
  perform 1 from public.repository_link;
  insert into did values ('reads', 'allowed');
exception when insufficient_privilege then
  insert into did values ('reads', 'denied');
end
$$;
select tests.clear_auth();

-- Each refusal says why, and stores nothing.
select matches((select value from did where what = 'moved'), '^42501: .*moved to another owner',
  'a repository whose owner id is not the one it was linked with is refused as moved');
select matches((select value from did where what = 'branch'), '^42501: Only tags publish; this run is at refs/heads/main',
  'a branch ref is refused, naming the ref');
select matches((select value from did where what = 'unlinked'), '^42501: .*not linked',
  'a project linked to no repository is refused');
select matches((select value from did where what = 'elsewhere'), '^42501: .*not linked',
  'a repository linked to A cannot publish to B, which is linked to another repository');
select is((select value from did where what = 'reads'), 'denied', 'and the publisher reads no link');
select is(
  (select count(*) from public.project_release where release_id in ('00000000-0000-7000-8000-0000000001a1', '00000000-0000-7000-8000-0000000001a2',
     '00000000-0000-7000-8000-0000000001a3', '00000000-0000-7000-8000-0000000001a4')),
  0::bigint,
  'no refused publish stored a release');
select matches((select value from did where what = 'again'), '^23505:', 'a release id published twice is refused, not overwritten');

-- What a release by link records.
select is((select value from did where what = 'own'), '00000000-0000-7000-8000-0000000001a5',
  'a tag of the linked repository publishes, with the release id the job chose');
select results_eq(
  $$ select project_id, uploaded_by, published_from, token_id, commit_sha from public.project_release
     where release_id = '00000000-0000-7000-8000-0000000001a5' $$,
  $$ values (tests.project('link-a'), tests.uid('teacher@example.com'), 'course/repo-renamed', null::uuid, 'abc123') $$,
  'it is recorded as uploaded by the linking owner, from the repository''s current name');
select results_eq(
  $$ select actor, subject->>'repository_id', subject->>'ref', subject->>'commit_sha' from public.audit_log
     where action = 'publish_release' and subject->>'release_id' = '00000000-0000-7000-8000-0000000001a5' $$,
  $$ values (tests.uid('teacher@example.com'), '101', 'refs/tags/v1', 'abc123') $$,
  'and audited with the repository id, the ref and the commit');
select is((select value from did where what = 'second'), '00000000-0000-7000-8000-0000000001a6',
  'the same repository publishes to the other project linked to it');

-- What a job is told.
select results_eq(
  $$ select project_slug, project_title, edition_title, edition_label, owner_matches, ref_matches, owner_current from ci where what = 'tag' $$,
  $$ values ('link-a', 'A', 'Links', '2026', true, true, true), ('link-d', 'D', 'Links', '2027', true, true, true) $$,
  'a job at a tag learns every project linked to its repository, and that each may publish');
select results_eq(
  $$ select project_slug, ref_matches from ci where what = 'branch' $$,
  $$ values ('link-a', false), ('link-d', false) $$,
  'a job at a branch learns the same projects, each refused for its ref');
select results_eq(
  $$ select project_id, project_slug, project_title, edition_title, edition_label, owner_matches, ref_matches, owner_current from ci where what = 'moved' $$,
  $$ values (null::uuid, null::text, null::text, null::text, null::text, false, null::boolean, null::boolean) $$,
  'a job in a moved repository learns that it moved, in one row, and no project''s id, slug or title');
select is_empty($$ select 1 from ci where what = 'nothing' $$, 'a job in a repository linked to nothing learns nothing');

-- A link publishes only while its maker owns the edition. Changed and
-- removed as the suite's own role: how they stop being an owner is
-- another file's business.
update public.enrollment set role = 'assistant'
where edition_id = tests.edition('T-LINK', '2026') and user_id = tests.uid('teacher@example.com');
select tests.as_publisher();
insert into did values ('demoted', tests.try_publish('101', '9', 'refs/tags/v2', tests.project('link-a'), '00000000-0000-7000-8000-0000000001b1'));
insert into ci select 'demoted', * from app.ci_projects('101', '9', 'refs/tags/v2');
select tests.clear_auth();
delete from public.enrollment
where edition_id = tests.edition('T-LINK', '2026') and user_id = tests.uid('teacher@example.com');
select tests.as_publisher();
insert into did values ('removed', tests.try_publish('101', '9', 'refs/tags/v2', tests.project('link-a'), '00000000-0000-7000-8000-0000000001b2'));
select tests.clear_auth();

select matches((select value from did where what = 'demoted'), '^42501: The person who linked this repository is no longer an owner',
  'once the linking owner is made an assistant, the link no longer publishes');
select matches((select value from did where what = 'removed'), '^42501: The person who linked this repository is no longer an owner',
  'nor once they are removed from the edition');
select is(
  (select count(*) from public.project_release where release_id in ('00000000-0000-7000-8000-0000000001b1', '00000000-0000-7000-8000-0000000001b2')),
  0::bigint,
  'and neither attempt stored a release');
select results_eq(
  $$ select project_slug, owner_current from ci where what = 'demoted' $$,
  $$ values ('link-a', false), ('link-d', true) $$,
  'a job learns which link lost its owner, and the other still publishes');

-- Unlinking stops a repository publishing to that project.
select tests.authenticate(tests.uid('other@example.com'));
select lives_ok($$ select app.unlink_repository(tests.project('link-d')) $$, 'an owner unlinks their project');
select tests.clear_auth();
select is((select count(*) from public.audit_log where action = 'unlink_repository' and actor = tests.uid('other@example.com')), 1::bigint,
  'and the unlink is audited');
select tests.as_publisher();
insert into did values ('after_unlink', tests.try_publish('101', '9', 'refs/tags/v3', tests.project('link-d'), '00000000-0000-7000-8000-0000000001c1'));
select tests.clear_auth();
select matches((select value from did where what = 'after_unlink'), '^42501: .*not linked', 'after which its repository publishes there no more');
select is((select published_from from public.project_release where release_id = '00000000-0000-7000-8000-0000000001a6'), 'course/repo-renamed',
  'while the releases it made keep their source');

select * from finish();
rollback;
