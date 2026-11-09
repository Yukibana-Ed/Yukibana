/**
 * SPDX-License-Identifier: MIT
 */
import { nls } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import type { Project } from '@yukibana/client';
import { SubmissionResult, SubmissionTarget, SubmissionTargetAvailability } from '@yukibana/ide-submission-ext/lib/common/submission-target';
import { CanSubmitStatus, CloudAccount, CloudService } from '../common/cloud-protocol';
import { CloudAccountService, CloudAccountState } from './cloud-account-service';
import { LoginCommand, SwitchAccountCommand } from './command-contribution';
import { UpdateCheck } from './update/update-check';

/** `reason`, saying which account it applies to, since the registry decides by account. */
function asAccount(reason: string, account: CloudAccount): string {
    return nls.localize('yukibana/cloud/reasonAsAccount', '{0} (logged in as {1})', reason, CloudAccount.label(account));
}

/**
 * The cloud registry as a place to submit to: says whether the logged-in account may submit for a project now, and
 * why not, in the account's terms, and sends submissions there.
 */
@injectable()
export class CloudSubmissionTarget implements SubmissionTarget {
    /** The target's id among the submission targets. */
    readonly id = 'cloud';
    /** The target's name as the submit dialog shows it. */
    readonly label = 'Cloud';

    /** The backend that asks the registry and sends submissions. */
    @inject(CloudService) protected readonly service!: CloudService;
    /** The account this window uses. */
    @inject(CloudAccountService) protected readonly accounts!: CloudAccountService;
    /** Whether the folder is behind the teacher's newest release. */
    @inject(UpdateCheck) protected readonly updates!: UpdateCheck;

    /**
     * Returns whether the account the registry knows this IDE as may submit for `projectId` now.
     *
     * Logged out: unavailable, with a Log in action. Otherwise by the registry's answer: open or late is available, with a
     * note when an assignment update is waiting; not allowed offers Switch account and, when the account check says who
     * is logged in, names the account (and for staff their role); not yet open, closed, or a registry that could not be asked is unavailable with no action. A failed account check
     * (`error`) is not treated as logged out: the registry's answer decides.
     *
     * Rejects only when the backend cannot be reached.
     */
    async getAvailability(projectId: string): Promise<SubmissionTargetAvailability> {
        // The keystore may hold a session the registry no longer accepts, so ask the registry who this is
        const [state, { status, project }] = await Promise.all([this.accounts.refresh(), this.service.canSubmitProject(projectId)]);
        if (state.kind === 'logged-out') {
            return {
                available: false,
                reason: nls.localize('yukibana/cloud/submission/notLoggedIn', 'You are not logged in'),
                actions: [
                    {
                        label: nls.localize('yukibana/cloud/submission/login', 'Log in'),
                        command: LoginCommand.id,
                    },
                ],
            };
        }

        switch (status) {
            case CanSubmitStatus.OPEN:
                return this.withUpdateNote({ available: true });

            case CanSubmitStatus.LATE:
                return this.withUpdateNote({
                    available: true,
                    message: nls.localize('yukibana/cloud/submission/late', 'You are late but you can still submit. Hurry up'),
                });

            case CanSubmitStatus.NOT_ALLOWED:
                return {
                    available: false,
                    reason: this.notAllowedReason(state, project),
                    actions: [
                        {
                            label: nls.localize('yukibana/cloud/submission/switchAccount', 'Switch account'),
                            command: SwitchAccountCommand.id,
                        },
                    ],
                };

            case CanSubmitStatus.NOT_OPEN:
                return {
                    available: false,
                    reason: nls.localize('yukibana/cloud/submission/tooEarly', 'It is too early to submit. Try again later'),
                    actions: [],
                };

            case CanSubmitStatus.CLOSED:
                return {
                    available: false,
                    reason: nls.localize('yukibana/cloud/submission/tooLate', 'The assignment has been closed. You cannot submit anymore'),
                    actions: [],
                };

            default:
                return {
                    available: false,
                    reason: nls.localize('yukibana/cloud/submission/cannotSubmitUnknown', 'You cannot submit right now. Try again later'),
                    actions: [],
                };
        }
    }

    /**
     * Adds a line when the teacher published a version of the assignment the folder has not taken in: the submission
     * is graded against the release the folder is on, so this is the moment the update matters most.
     */
    protected async withUpdateNote(availability: { available: true; message?: string }): Promise<SubmissionTargetAvailability> {
        const state = await this.updates.refresh();
        if (state.available === undefined) {
            return availability;
        }
        const note = nls.localize(
            'yukibana/cloud/submission/updateWaiting',
            'Your teacher published a newer version of this assignment that your project does not have yet. You can submit anyway, or cancel and update first (see Assignment Update).',
        );
        return { available: true, message: availability.message === undefined ? note : `${availability.message}. ${note}` };
    }

    /** The registry decides by account and role, so say which ones it refused. */
    protected notAllowedReason(state: CloudAccountState, project?: Project): string {
        const notAllowed = nls.localize('yukibana/cloud/submission/notAllowed', 'You are not allowed to submit for this project');
        if (state.kind !== 'logged-in') {
            return notAllowed;
        }
        if (project && project.role !== 'student') {
            return nls.localize(
                'yukibana/cloud/submission/notAllowedStaff',
                '{0}: you are its {1} in {2} {3}, logged in as {4}. Only enrolled students can submit.',
                notAllowed,
                project.role,
                project.courseCode,
                project.editionLabel,
                CloudAccount.label(state.account),
            );
        }
        return asAccount(notAllowed, state.account);
    }

    /**
     * Sends submission `submissionId` for `projectId` and returns whether it went. Any failure's reason, a refusal or
     * not (a submission no longer prepared, a registry that could not be reached), is suffixed with the logged-in
     * account when the account check says one is.
     */
    async submit(projectId: string, submissionId: string): Promise<SubmissionResult> {
        const result = await this.service.submit(projectId, submissionId);
        if (result.ok) {
            return result;
        }
        const state = await this.accounts.refresh();
        return state.kind === 'logged-in' ? { ok: false, reason: asAccount(result.reason, state.account) } : result;
    }
}
