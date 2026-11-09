/**
 * SPDX-License-Identifier: MIT
 */
import { ContributionProvider, ILogger, MaybePromise, MessageService, MessageType } from '@theia/core';
import { inject, injectable, named } from '@theia/core/shared/inversify';

/** The contribution-provider name middlewares are bound under: `bind(YukibanaMessageMiddlewareContribution).toService(…)`. */
export const YukibanaMessageMiddlewareContribution = Symbol('YukibanaMessageMiddlewareContribution');
/**
 * A rule about messages the IDE shows (`MessageService.info`, `warn`, `error`, `log`), from this extension or any other,
 * for a notification a student should not see or should not have to answer.
 *
 * `type`, `text` and `args` are what the message was sent with: `args` are the call's extra arguments, the actions'
 * labels and possibly a `MessageOptions` object first, or `undefined` or empty when there are none.
 */
export interface YukibanaMessageMiddlewareContribution {
    /** The order middlewares are asked in, highest first; equal priorities keep the order they were bound in. */
    readonly PRIORITY: number;
    /**
     * Returns `true` iff the message is not shown at all; the caller's promise then resolves `undefined`, as if the
     * message had been dismissed. Every middleware is asked this before any is asked {@link shouldAutoAction}.
     */
    // oxlint-disable-next-line typescript/no-explicit-any
    shouldIgnoreMessage(type: MessageType, text: string, args?: any[]): MaybePromise<boolean>;
    /**
     * Returns the action to choose for the student, so the message is not shown and the caller's promise resolves with
     * it, or `undefined` to leave the message to the next middleware. The first non-`undefined` answer wins.
     *
     * It should be one of the message's actions; that is not checked, and the caller receives whatever it is.
     */
    // oxlint-disable-next-line typescript/no-explicit-any
    shouldAutoAction(type: MessageType, text: string, args?: any[]): MaybePromise<string | undefined>;
}

/**
 * The IDE's `MessageService`, which asks the bound {@link YukibanaMessageMiddlewareContribution}s about each message
 * before showing it: one that ignores it hides it, one that chooses an action answers it; otherwise it is shown as
 * usual. What is hidden or answered is logged at debug level.
 */
@injectable()
export class YukibanaMessageService extends MessageService {
    /** Says, at debug level, which messages were ignored or answered. */
    @inject(ILogger) @named('yukibana:MessageService') protected readonly logger!: ILogger;
    /** The bound middlewares. */
    @inject(ContributionProvider) @named(YukibanaMessageMiddlewareContribution) protected readonly middlewareProvider!: ContributionProvider<YukibanaMessageMiddlewareContribution>;

    /** Returns the middlewares, highest {@link YukibanaMessageMiddlewareContribution.PRIORITY} first. */
    protected getMiddelwares(): YukibanaMessageMiddlewareContribution[] {
        const middlewares = this.middlewareProvider.getContributions();
        return middlewares.sort((a, b) => b.PRIORITY - a.PRIORITY);
    }

    /**
     * Returns `undefined` if a middleware ignores the message, the action the first middleware to choose one chose,
     * or else what showing the message returns: the action the student picked, or `undefined` if they dismissed it.
     *
     * A middleware that throws or rejects makes this reject, and the message is not shown.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected async processMessage(type: MessageType, text: string, args?: any[]): Promise<string | undefined> {
        const middlewares = this.getMiddelwares();
        const typeName = MessageType[type];

        for (const middleware of middlewares) {
            if (await middleware.shouldIgnoreMessage(type, text, args)) {
                this.logger.debug(`Ignoring message of type ${typeName} (args = ${!!args ? JSON.stringify(args) : args}): '${text}'`);
                return;
            }
        }

        for (const middleware of middlewares) {
            // Awaited, since the answer may be a promise: before November 2026 it was not, and a middleware answering
            // with a promise of `undefined` swallowed the message instead of leaving it to the others.
            const autoAction = await middleware.shouldAutoAction(type, text, args);
            if (autoAction !== undefined) {
                this.logger.debug(`Auto selecting action '${autoAction}' for message of type ${typeName} (args = ${!!args ? JSON.stringify(args) : args}): '${text}'`);
                return autoAction;
            }
        }

        return super.processMessage(type, text, args);
    }
}
