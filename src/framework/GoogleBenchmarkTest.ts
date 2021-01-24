import { AbstractTest, SharedWithTest } from '../AbstractTest';
import { Suite } from '../Suite';
import { AbstractRunnable } from '../AbstractRunnable';
import { TestEventBuilder } from '../TestEventBuilder';
import { TestRunState } from 'vscode';

export class GoogleBenchmarkTest extends AbstractTest {
  public constructor(
    shared: SharedWithTest,
    runnable: AbstractRunnable,
    parent: Suite,
    testNameAsId: string,
    private _failIfExceedsLimitNs: number | undefined,
  ) {
    super(
      shared,
      runnable,
      parent,
      testNameAsId,
      testNameAsId,
      undefined,
      undefined,
      false,
      undefined,
      [],
      undefined,
      undefined,
      undefined,
    );
  }

  public update(failIfExceedsLimitNs: number | undefined): boolean {
    const changed = false;
    if (failIfExceedsLimitNs !== this._failIfExceedsLimitNs) {
      this._failIfExceedsLimitNs = failIfExceedsLimitNs;
      // don have to mark it changed
    }
    return changed;
  }

  public compare(testNameAsId: string): boolean {
    return this.testNameAsId === testNameAsId;
  }

  public static readonly failureRe = /^((.+)[:\(]([0-9]+)\)?): ((Failure|EXPECT_CALL|error: )(.*))$/;

  private _getTimeUnitMultiplier(metric: Record<string, string | number>): [number, string] {
    if (metric['time_unit'] === 'ns') {
      return [1, 'ns'];
    } else if (metric['time_unit'] === 'ms') {
      return [1000000, 'ms'];
    } else if (metric['time_unit'] === 'us') {
      return [1000, 'μs'];
    } else {
      return [1, '?'];
    }
  }

  public parseAndProcessTestCase(
    output: string,
    _rngSeed: number | undefined,
    timeout: number | null,
    _stderr: string | undefined, //eslint-disable-line
  ): void {
    if (timeout !== null) {
      this.getTimeoutEvent(timeout);
      return;
    }

    try {
      const metric = JSON.parse(output);

      const eventBuilder = new TestEventBuilder(this);

      if (metric['error_occurred']) {
        eventBuilder.errored();
      }

      const metricType = ['cpu_time', 'cpu_coefficient', 'rms'];
      const key = metricType.find(m => metric[m]);
      const value: number | undefined = key ? metric[key] : undefined;

      if (value !== undefined) {
        const [timeUnitMultiplier, timeUnit] = this._getTimeUnitMultiplier(metric);

        if (typeof this._failIfExceedsLimitNs === 'number' && this._failIfExceedsLimitNs < value * timeUnitMultiplier) {
          eventBuilder.appendMessage(`❌ Failed: "${key}" exceeded limit: ${this._failIfExceedsLimitNs} ns.`, null);
          eventBuilder.appendMessage(' ', null);
          eventBuilder.failed();
        }

        eventBuilder.appendDescription(`(${value.toFixed(2)}${timeUnit})`);
        eventBuilder.appendTooltip(`⏱${key}: ${value} ${timeUnit}`);
      }

      Object.keys(metric).forEach(key => {
        const value = metric[key];
        const value2 = typeof value === 'string' ? '"' + value + '"' : value;
        eventBuilder.appendMessage(key + ': ' + value2, null);
      });

      eventBuilder.passed();

      eventBuilder.build();
    } catch (e) {
      this._shared.log.exceptionS(e, output);

      this.getFailedEventBase(TestRunState.Errored, 'Unexpected error: ' + e.toString());
    }
  }
}
