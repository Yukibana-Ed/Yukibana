/**
 * SPDX-License-Identifier: MIT
 */
import { AIIdeActivationServiceImpl } from '@theia/ai-ide/lib/browser/ai-ide-activation-service';
import { PREFERENCE_NAME_ENABLE_AI } from '@theia/ai-ide/lib/common/ai-ide-preferences';
import { MaybePromise } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ConfigProvider } from './config/config-provider';

/**
 * Theia's AI activation, with the project's say: AI features are on iff the student's preference turns them on and the
 * config's `features.ai` is true. Before the config is ready the preference alone decides, as `features.ai` defaults to
 * true.
 */
@injectable()
export class YukibanaAIIdeActivationService extends AIIdeActivationServiceImpl {
    /** The config whose `features.ai` can veto the preference. */
    @inject(ConfigProvider) protected readonly configProvider: ConfigProvider;

    /** Sets AI on iff `value`, the preference, is true and the current config allows it. */
    protected override updateEnableValue(value: boolean): void {
        super.updateEnableValue(value && this.configProvider.config.features.ai);
    }

    /** Applies the preference and the current config again; the preference reads as off until preferences are ready. */
    protected refreshValue(): void {
        this.updateEnableValue(this.preferenceService.get<boolean>(PREFERENCE_NAME_ENABLE_AI, false));
    }

    /** Does Theia's initialization, then once the config is ready applies it, and again on every config change. */
    override initialize(): MaybePromise<void> {
        super.initialize();
        this.configProvider.ready.then(() => {
            this.configProvider.onConfigChanged(() => this.refreshValue());
            this.refreshValue();
        });
    }
}
