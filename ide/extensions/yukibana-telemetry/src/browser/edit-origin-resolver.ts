/**
 * SPDX-License-Identifier: MIT
 */
import { ILogger } from '@theia/core';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { EditOrigin } from '@yukibana/telemetry-protocol';

export interface EditReason {
    metadata?: {
        source?: string;
        kind?: string;
        name?: string;
        detailedSource?: string;
    };
}

@injectable()
export class EditOriginResolver {
    @inject(ILogger) @named('yukibana:EditOriginResolver') protected readonly logger!: ILogger;

    /** Returns what made a change, from the reason Monaco gives for it; `unknown` when it says nothing we recognise. */
    // Adapted from https://github.com/hexlet-codebattle/codebattle/blob/f030dcca05eb81c87a2bfbc78ec174907969504c/frontend/src/features/game/editor/telemetry.ts
    originOfChange(detailedReason: EditReason): EditOrigin {
        const { source, kind, detailedSource } = detailedReason.metadata ?? {};
        if (source === 'suggest' || source === 'snippet') {
            return 'completion';
        }
        if (source === 'cursor') {
            if (kind === 'type' || kind === 'compositionType' || kind === 'compositionEnd') {
                return 'type';
            }
            if (kind === 'executeCommand' || kind === 'executeCommands') {
                if (detailedSource === 'deleteLeft' || detailedSource === 'deleteWordLeft' || detailedSource === 'deleteRight' || detailedSource === 'deleteWordRight') {
                    return 'delete';
                }
                if (detailedSource === 'editor.contrib.dragAndDrop') {
                    return 'drag-drop';
                }
                void this.logger.debug(`Unknown command for ${JSON.stringify(detailedReason)}`);
                return 'command';
            }
            if (kind === 'cut') {
                return 'cut';
            }
            if (kind === 'paste') {
                return 'paste';
            }
        }
        void this.logger.debug(`Unknown change origin for ${JSON.stringify(detailedReason)}`);
        return 'unknown';
    }
}
