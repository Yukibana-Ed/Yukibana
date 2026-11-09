/**
 * SPDX-License-Identifier: MIT
 */
import type { Accepted, Me, Project } from '@yukibana/client';

/** The path the frontend reaches the backend's {@link CloudAuth} at; each window's connection gets one of its own. */
export const cloudAuthPath = '/services/yukibana/cloud-auth';
/**
 * A path reserved for {@link AuthClient}. Nothing serves or connects to it: the client is the window's end of the
 * {@link cloudAuthPath} connection, not a service of its own.
 */
export const authClientPath = '/services/yukibana/auth-client';
/** The path the frontend reaches the backend's {@link CloudService} at, one service shared by every window. */
export const cloudServicePath = '/services/yukibana/cloud';
/** The injection key of {@link CloudAuth}: in the frontend, the proxy to this window's backend end. */
export const CloudAuth = Symbol('CloudAuth');
/** An injection key for {@link AuthClient}. Nothing binds it: the frontend injects the window's end as `AuthClientImpl`. */
export const AuthClient = Symbol('AuthClient');
/** The injection key of {@link CloudService}: the backend's one instance, and the frontend's proxy to it. */
export const CloudService = Symbol('CloudService');

/**
 * Logging in to and out of the cloud registry, served by the backend.
 *
 * There is one session for the whole IDE, kept in the system keystore: a login or logout in any window is one for
 * every window, and each is told through {@link AuthClient.notifyLoginChanged}.
 */
export interface CloudAuth {
    /**
     * Logs in through the system browser and returns how it went, settling once the login has ended either way.
     *
     * Opens the login page through this window's {@link AuthClient.openLoginUrl}. A login already under way, from any
     * window, is joined rather than started again: its page was opened in the window that started it. Never rejects
     * for a login that fails or is cancelled: that is `ok: false`, with the reason. Replaces any session already kept.
     */
    login(): Promise<LoginResult>;
    /**
     * Logs in again, ending the current session only once the new one is there, and returns how the login went.
     *
     * A login that fails or is cancelled leaves the person logged in as before. The old session is ended at the Auth
     * server without waiting, and a failure to end it is ignored.
     */
    switchAccount(): Promise<LoginResult>;
    /**
     * Forgets the session and asks the Auth server to end it; settles once both are done.
     *
     * The session is forgotten here even when the Auth server could not be reached (that is only logged). Rejects only
     * when the keystore fails.
     */
    logout(): Promise<void>;
    /**
     * Returns the account the registry knows the session as, or undefined when nobody is logged in.
     *
     * A session the registry or the Auth server refuses is forgotten, which counts as a logout (every window is told),
     * and answers undefined too: kept, it would stand in the way of logging in again. A refusal is the registry
     * answering 401, or the Auth server answering 4xx to a refresh. Rejects on any other failure (no answer, or an
     * answer other than a refusal, such as a 403, a 5xx or a malformed body), which says nothing about who is logged
     * in.
     */
    whoAmI(): Promise<CloudAccount | undefined>;
}

/** A window's end of {@link CloudAuth}, which the backend calls back. */
export interface AuthClient {
    /**
     * Opens `url`, the login page, outside the IDE.
     *
     * `code`, when there is one, is what the login page shows too, so the person can tell it is this login.
     */
    openLoginUrl(url: string, code?: string): void;
    /** Says that someone logged in or out, possibly from another window; it says nothing about who is logged in now. */
    notifyLoginChanged(): void;
}

/** The account a session is for, as the registry's `/api/me` answers. */
export type CloudAccount = Me;

/** How an account is named to the person. */
export namespace CloudAccount {
    /** What tells the account apart from any other, for messages: the email when there is one. */
    export function label(account: CloudAccount): string {
        return account.email ?? account.githubLogin ?? account.fullName ?? account.userId;
    }

    /** What the person is called, for the status bar: the display name when there is one. */
    export function displayName(account: CloudAccount): string {
        return account.fullName ?? label(account);
    }
}

/** How a login ended: with a session kept, or why there is none. */
export type LoginResult =
    | {
          /** `true` iff the login ended with a session, now kept. */
          readonly ok: true;
      }
    | {
          /** `true` iff the login ended with a session, now kept. */
          readonly ok: false;
          /** Why there is no new session, in a sentence: cancelled, timed out, refused. */
          readonly reason: string;
      };

/** A submission the registry stored, with its receipt, or why it was not sent or not stored. */
export type SubmissionResult =
    | ({
          /** `true` iff the registry stored the submission. */
          readonly ok: true;
      } & Accepted)
    | {
          /** `true` iff the registry stored the submission. */
          readonly ok: false;
          /** Why not, in a sentence: the submission is no longer prepared, or what the registry or the network said. */
          readonly reason: string;
      };

/** A starter unpacked, with the entries left out (each `path: reason`), or why nothing was unpacked. */
export type DownloadResult =
    | {
          /** `true` iff the starter was unpacked. */
          readonly ok: true;
          /** The entries not unpacked, each as `path: reason`; empty when everything was. */
          readonly leftOut: readonly string[];
      }
    | {
          /** `true` iff the starter was unpacked. */
          readonly ok: false;
          /** Why nothing was unpacked, in a sentence. */
          readonly reason: string;
      };

/**
 * Whether the caller may submit for a project now, as the IDE reads the registry's answer.
 *
 * Decided in this order: staff are `NOT_ALLOWED`; then a draft or a project not open yet is `NOT_OPEN`; one past
 * `closesAt` is `CLOSED`; one the registry says the caller may not submit to is `NOT_ALLOWED`; one past its deadline
 * is `LATE`; anything else is `OPEN`. A numeric enum: the values cross the RPC connection as numbers, so the members
 * keep their order.
 */
export enum CanSubmitStatus {
    /** The caller is staff of the project's edition, or the registry refuses them for another reason. */
    NOT_ALLOWED,
    /** The project is a draft, or its window has not opened yet. */
    NOT_OPEN,
    /** The caller may submit, on time. */
    OPEN,
    /** The caller may submit, but the deadline has passed and the submission reads as late. */
    LATE,
    /** The project's window has closed: nobody can submit any more. */
    CLOSED,
    /** The registry could not be asked, or refused to say: not logged in, no such project, no network. */
    UNKNOWN,
}

/** A project, or why there is none: the registry answers 404 both for no such project and for one the caller may not see. */
export type ProjectLookup =
    | {
          /** `found`: the registry answered with the project. */
          readonly kind: 'found';
          /** The project as the registry answered. */
          readonly project: Project;
      }
    | {
          /** `not-found`: the registry has no such project, or none the person may see. */
          readonly kind: 'not-found';
      }
    | {
          /** `not-logged-in`: no session is kept, or the registry or Auth server refused the one that was. */
          readonly kind: 'not-logged-in';
      };

/**
 * Projects the person can see, or why there are none to show.
 *
 * A student sees the published projects of their editions, staff all of their editions'; the registry decides which.
 */
export type ProjectListing =
    | {
          /** `found`: the registry answered with the list. */
          readonly kind: 'found';
          /** The projects the person can see, as the registry answered; empty when there are none. */
          readonly projects: readonly Project[];
      }
    | {
          /** `not-logged-in`: no session is kept, or the registry or Auth server refused the one that was. */
          readonly kind: 'not-logged-in';
      }
    | {
          /** `error`: any other failure: the registry could not be reached, or did not answer with a list. */
          readonly kind: 'error';
          /** Why there is no list, in a sentence. */
          readonly reason: string;
      };

/** Whether the caller may submit, with the project it was decided from when the registry answered. */
export interface SubmitAvailability {
    /** Whether the caller may submit now. */
    readonly status: CanSubmitStatus;
    /** The project as the registry answered; absent iff `status` is `UNKNOWN`. */
    readonly project?: Project;
}

/**
 * The cloud registry, as the logged-in person sees it, served by the backend: projects, starters and submissions.
 * Every call is made as whoever the IDE's one session is for, whichever window asks.
 */
export interface CloudService {
    /**
     * Sends submission `submissionId`, as the submission service prepared it, to the registry for `projectId`, with
     * the release its folder started from, and returns what the registry answered or why it was not sent.
     *
     * Never rejects: a submission no longer prepared, a refusal and a network failure are each `ok: false`.
     */
    submit(projectId: string, submissionId: string): Promise<SubmissionResult>;
    /**
     * Returns project `projectId` as the registry shows it to the logged-in person, or why there is none.
     *
     * `not-logged-in` when no session is kept or the registry or the Auth server refuses it. Rejects on any other
     * failure, such as a registry that cannot be reached.
     */
    getProjectInfo(projectId: string): Promise<ProjectLookup>;
    /** Returns the projects the logged-in person can see; a failure other than being logged out is an `error`. */
    listProjects(): Promise<ProjectListing>;
    /**
     * Unpacks the starter of `projectId` into `destinationURI`, creating it, and returns the entries left out, or why
     * nothing was unpacked.
     *
     * `destinationURI` is a `file:` URI. Fails, having written nothing, when `destinationURI` exists and is not an
     * empty folder, or when the download is not a whole `.tar.gz`; a write that fails partway removes what was
     * written. A starter that is one folder with a `yukibana.json` in it is unpacked without that folder, whatever its
     * name. Never rejects: every failure, the download's included, is `ok: false`.
     */
    downloadProject(projectId: string, destinationURI: string): Promise<DownloadResult>;
    /**
     * Returns whether the logged-in person may submit for `projectId` now (see {@link CanSubmitStatus}), with the
     * project it was decided from.
     *
     * Never rejects: any failure to ask the registry, being logged out included, is `UNKNOWN`, so a caller that must
     * tell logged out apart asks {@link CloudAuth.whoAmI}.
     */
    canSubmitProject(projectId: string): Promise<SubmitAvailability>;
}
