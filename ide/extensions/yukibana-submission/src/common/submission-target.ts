/**
 * SPDX-License-Identifier: MIT
 */
/** The key every {@link SubmissionTarget} is bound under, as a contribution; the submit command picks one by its `id`. */
export const SubmissionTarget = Symbol('SubmissionTarget');

/** Whether a submission reached its target. */
export type SubmissionResult =
    | {
          /** `true` iff the submission went. */
          readonly ok: true;
      }
    | {
          /** `true` iff the submission went. */
          readonly ok: false;
          /** Why it did not, in a localized sentence the student is shown after "Failed to submit:". */
          readonly reason: string;
      };

/** Whether a target can take a submission now, as the summary dialog shows it before the student sends. */
export type SubmissionTargetAvailability =
    | {
          /** `true` iff the target can take a submission. */
          readonly available: true;
          /** A localized note shown beside the go-ahead, such as an update that is waiting; absent when there is none. */
          readonly message?: string;
      }
    | {
          /** `true` iff the target can take a submission. */
          readonly available: false;
          /** Why it cannot, in a localized sentence. */
          readonly reason: string;
          /**
           * What the student can do about it, each shown as a button labelled `label`, possibly none. A `command` that
           * is a string is the id of a command run with no arguments, a function is called; the availability is asked
           * again after either completes. An action that rejects leaves the availability shown as it was, and its
           * rejection goes unhandled.
           *
           * `args` is not passed to the command: the summary dialog ignores it, so no action may rely on it.
           */
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          readonly actions: { label: string; command: string | (() => Promise<void>); args?: any[] }[];
      };

/** Somewhere a submission can go: the registry, or a file the student saves. */
export interface SubmissionTarget {
    /**
     * The name the workspace configuration's `submission.target` picks this target by.
     *
     * - Requires: unique among targets; not checked, and the first one bound with an id is the one used.
     */
    readonly id: string;
    /** The target's name for people; nothing shows it yet. */
    readonly label: string;
    /**
     * Returns whether a submission for `projectId` can be sent now. It is asked when the summary dialog opens, after
     * each action the student takes, and again just before sending, so it must be cheap enough to ask more than once.
     *
     * `projectId` is `''` when the workspace's `yukibana.json` names no project.
     *
     * May reject when availability cannot be determined: the summary dialog then shows the target as unavailable,
     * with a Retry, and a rejection just before sending fails the send with its message ("Failed to submit: ...").
     */
    getAvailability(projectId: string): Promise<SubmissionTargetAvailability>;
    /** Sends submission `submissionId`, as `SubmissionService.prepare` made it, for `projectId`, and returns whether it went. */
    submit(projectId: string, submissionId: string): Promise<SubmissionResult>;
}
