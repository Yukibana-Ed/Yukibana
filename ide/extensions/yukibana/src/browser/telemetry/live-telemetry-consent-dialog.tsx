/**
 * SPDX-License-Identifier: MIT
 */
import { nls } from '@theia/core';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import React from 'react';

export const LIVE_TELEMETRY_CONSENT_CONTENT_CLASS = 'yukibana-liveTelemetryConsentDialog';

export class LiveTelemetryConsentDialog extends ReactDialog<boolean> {
    constructor() {
        super({
            title: nls.localize('yukibana/telemetry/live/consent', 'Live telemetry consent'),
        });
        this.appendCloseButton(nls.localize('yukibana/telemetry/live/close', 'Close the assignment'));
        this.appendAcceptButton(nls.localize('yukibana/telemetry/live/accept', 'Accept'));
    }

    protected render(): React.ReactNode {
        return <div className={LIVE_TELEMETRY_CONSENT_CONTENT_CLASS}>{this.renderDisclaimer()}</div>;
    }

    protected renderDisclaimer(): React.ReactNode {
        const title = nls.localize('yukibana/telemetry/live/title', 'Live telemetry is enabled for this assignment');
        const subTitle = nls.localize('yukibana/telemetry/live/subtitle', 'What does this mean?');
        const detailsIntro = nls.localize('yukibana/telemetry/live/details', 'Your teacher will be able to:');
        const detailsLiveStats = nls.localize(
            'yukibana/telemetry/live/detailsLiveStats',
            'see live statistics about what you are doing (typing speed, test results, problems, etc.)',
        );
        const detailsRemote = nls.localize(
            'yukibana/telemetry/live/detailsRemoteView',
            'remotely view the files you are editing (you will be notified whenever the teacher is actively watching)',
        );
        return (
            <>
                <h3>{title}</h3>
                <h4>{subTitle}</h4>
                <p>{detailsIntro}</p>
                <ul>
                    <li>{detailsLiveStats}</li>
                    <li>{detailsRemote}</li>
                </ul>
            </>
        );
    }

    get value(): boolean {
        return true;
    }
}
