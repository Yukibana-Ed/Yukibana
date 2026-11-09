/**
 * SPDX-License-Identifier: MIT
 */
import { Disposable, MaybePromise } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import * as monaco from '@theia/monaco-editor-core';
import { YukibanaConfig } from '../../common/yukibana-config';
import { ConfigProvider } from '../config/config-provider';

/** The name of one of `monaco.languages`' `register…Provider` functions, such as `registerCodeLensProvider`. */
export type RegisterFunctionName = Extract<keyof typeof monaco.languages, `register${string}Provider`>;

// oxlint-disable-next-line typescript/no-explicit-any
type RegisterFunction = (selector: unknown, provider: any, ...rest: unknown[]) => Disposable;

interface PendingRegistration {
    // oxlint-disable-next-line typescript/no-explicit-any
    args: [unknown, any, ...unknown[]];
    disposable: Disposable;
    disposed: boolean;
}

/**
 * Puts one kind of Monaco language provider behind a switch in the config: once {@link initialize} has run, every
 * provider registered through `monaco.languages[registerFunction]` answers only while {@link isEnabled} holds for the
 * config as it is at the time of the call, and answers `undefined` (Monaco's "nothing") otherwise. Turning the feature
 * on or off in `yukibana.json` therefore takes effect without registering anything again, but only from the next request
 * Monaco makes: nothing fires the provider's `onDidChange` on a config change, so what an editor already shows (code
 * lenses, for one) stays until Monaco asks again, and turning a feature back on shows nothing until then.
 *
 * It works by replacing the register function on the shared `monaco.languages` object, so a subclass is generic over
 * the kind of provider instead of being a copy per kind. Providers registered before the config is ready are queued
 * and registered when it is; a provider registered before {@link initialize} ran is not wrapped and always answers.
 */
@injectable()
export abstract class LanguageProviderToggleContribution implements FrontendApplicationContribution {
    /** The config {@link isEnabled} is asked about, and whose readiness ends the queue. */
    @inject(ConfigProvider) protected readonly configProvider: ConfigProvider;

    /** The register function this contribution replaces. */
    protected abstract readonly registerFunction: RegisterFunctionName;

    /** Returns `true` iff providers of this kind should answer under `config`. Called on every provider call, so cheap. */
    protected abstract isEnabled(config: YukibanaConfig): boolean;

    /**
     * Returns `true` iff the provider member named `key` is left as it is rather than switched off: symbols, events
     * (`onDid…`), Monaco's release callbacks (`free…`) and `dispose`, which must keep working while answers are off.
     */
    protected isPassthrough(key: string | symbol): boolean {
        return typeof key !== 'string' || key.startsWith('onDid') || key.startsWith('free') || key === 'dispose';
    }

    /** The registrations made before the config was ready, in order; empty once {@link flush} has run. */
    protected pending: PendingRegistration[] = [];

    /** Monaco's own register function, as it was when {@link initialize} ran; `undefined` before. */
    protected originalRegister: RegisterFunction;

    /** `monaco.languages`, typed so that a register function can be read and replaced by name. */
    private get languages(): Record<string, RegisterFunction> {
        return monaco.languages as unknown as Record<string, RegisterFunction>;
    }

    /**
     * Replaces the register function with one that queues, and registers the queue (wrapped) once the config is ready.
     *
     * A disposable returned for a queued registration works before and after the flush: disposed before, the
     * provider is never registered.
     *
     * - Requires: called once; Theia calls it once on the singleton. A second call throws, since it would capture the
     *   replacement as the original and every registration would then recurse.
     */
    initialize(): MaybePromise<void> {
        if (this.originalRegister !== undefined) {
            throw new Error(`${this.constructor.name}.initialize: ${this.registerFunction} is already replaced`);
        }
        this.originalRegister = this.languages[this.registerFunction];
        this.languages[this.registerFunction] = (...args) => {
            const entry: PendingRegistration = {
                args,
                disposable: Disposable.NULL,
                disposed: false,
            };
            this.pending.push(entry);
            return {
                dispose: () => {
                    entry.disposed = true;
                    entry.disposable.dispose();
                },
            };
        };
        this.configProvider.ready.then(() => this.flush());
    }

    /**
     * Returns `provider` behind a proxy whose methods, other than the {@link isPassthrough} ones, return `undefined`
     * while {@link isEnabled} is false. Values that are not functions, such as `triggerCharacters`, are read through.
     */
    protected wrap<P extends object>(provider: P): P {
        return new Proxy(provider, {
            get: (target, key) => {
                const value = Reflect.get(target, key, target);
                if (typeof value !== 'function' || this.isPassthrough(key)) {
                    return typeof value === 'function' ? value.bind(target) : value;
                }
                return (...args: unknown[]) => (this.isEnabled(this.configProvider.config) ? value.apply(target, args) : undefined);
            },
        });
    }

    /** Registers `provider`, wrapped, with Monaco's own register function, and returns what that returns. */
    protected registerProvider(selector: unknown, provider: object, ...rest: unknown[]): Disposable {
        return this.originalRegister.call(monaco.languages, selector, this.wrap(provider), ...rest);
    }

    /**
     * Makes the register function register wrapped providers directly, and registers every queued provider not
     * disposed meanwhile.
     */
    protected flush(): void {
        this.languages[this.registerFunction] = (selector, provider, ...rest) => this.registerProvider(selector, provider, ...rest);
        for (const entry of this.pending) {
            if (entry.disposed) {
                continue;
            }
            const [selector, provider, ...rest] = entry.args;
            entry.disposable = this.registerProvider(selector, provider, ...rest);
        }
        this.pending = [];
    }
}
