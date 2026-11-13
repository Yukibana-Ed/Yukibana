import { Disposable, DisposableCollection, ILogger } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { TestController, TestExecutionState, TestItem, TestRun, TestService } from '@theia/test/lib/browser/test-service';
import { LiveTelemetry, LiveTelemetryService } from '../../common/yukibana-telemetry';

/**
 * Watches test runs and reports to the teacher, once a run completes, how many
 * tests passed and failed in *that run*.
 *
 * Results are deliberately NOT accumulated across runs. If they were, a student
 * could pass test A with one version of the code, tweak it to pass test B,
 * and so on, and be reported as passing everything without any single version
 * of the code passing all tests. A test that was not executed in a run
 * (skipped, filtered out, cancelled) therefore counts as neither passed nor
 * failed for that run: total - passed - failed is the number of tests not run.
 *
 * Adapted from https://github.com/eclipse-theia/theia/blob/master/packages/test/src/browser/view/test-output-ui-model.ts
 */
@injectable()
export class TestWatcher implements FrontendApplicationContribution, Disposable {
    @inject(TestService) protected readonly tests!: TestService;
    @inject(ILogger) @named('yukibana:TestWatcher') protected readonly logger!: ILogger;
    @inject(LiveTelemetryService) protected readonly telemetry!: LiveTelemetryService;

    protected readonly controllerListeners = new Map<string, DisposableCollection>();
    protected readonly toDispose = new DisposableCollection();

    onStart(): void {
        this.tests.getControllers().forEach(controller => this.addController(controller));
        this.toDispose.push(
            this.tests.onControllersChanged(deltas => {
                deltas.added?.forEach(controller => this.addController(controller));
                deltas.removed?.forEach(controllerId => this.removeController(controllerId));
            }),
        );
    }

    onStop(): void {
        this.dispose();
    }

    dispose(): void {
        Array.from(this.controllerListeners.keys()).forEach(id => this.removeController(id));
        this.toDispose.dispose();
    }

    protected addController(controller: TestController): void {
        if (this.controllerListeners.has(controller.id)) {
            return;
        }
        const listeners = new DisposableCollection();
        listeners.push(
            controller.onRunsChanged(delta => {
                delta.added?.forEach(run => this.watchRun(controller, run, listeners));
            }),
        );
        this.controllerListeners.set(controller.id, listeners);
    }

    protected removeController(id: string): void {
        this.controllerListeners.get(id)?.dispose();
        this.controllerListeners.delete(id);
    }

    protected watchRun(controller: TestController, run: TestRun, listeners: DisposableCollection): void {
        let reported = false;
        const subscription = run.onDidChangeProperty(e => {
            if (e.isRunning === false && !reported) {
                reported = true;
                subscription.dispose();
                this.reportRun(controller, run);
            }
        });
        listeners.push(subscription);
    }

    protected reportRun(controller: TestController, run: TestRun): void {
        // Every leaf test known to the controller, plus any leaf seen in this run
        // (in case the controller's tree is resolved lazily). Keyed by id, so that
        // tests sharing a label cannot collide.
        const leaves = new Map<string, TestItem>();
        this.collectLeaves(controller.tests, leaves);
        this.collectLeaves(run.items, leaves);

        let passed = 0;
        let failed = 0;
        leaves.forEach(test => {
            const state = run.getTestState(test)?.state;
            if (state === TestExecutionState.Passed) {
                passed++;
            } else if (state === TestExecutionState.Failed || state === TestExecutionState.Errored) {
                failed++;
            }
        });

        const total = leaves.size;
        this.logger.info(`Test run completed (${controller.id}): ${passed} passed, ${failed} failed, ${total - passed - failed} not run, ${total} total`);
        this.telemetry.report({
            type: 'event',
            kind: 'test',
            data: {
                total,
                passed,
                failed,
            },
        } satisfies LiveTelemetry.Event);
    }

    protected collectLeaves(tests: readonly TestItem[], into: Map<string, TestItem>): void {
        for (const test of tests) {
            if (test.tests.length === 0) {
                into.set(test.id, test);
            } else {
                this.collectLeaves(test.tests, into);
            }
        }
    }
}
