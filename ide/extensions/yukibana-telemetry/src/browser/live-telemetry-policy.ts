/**
 * SPDX-License-Identifier: MIT
 */
import { inject, injectable } from '@theia/core/shared/inversify';
import { ConfigProvider } from '@yukibana/ide-ext/lib/browser/config/config-provider';

@injectable()
export class LiveTelemetryPolicy {
    @inject(ConfigProvider) protected readonly config!: ConfigProvider;
}
