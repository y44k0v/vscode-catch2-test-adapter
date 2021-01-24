import * as vscode from 'vscode';
import { ExecuteTaskCallbackType, TestProviderShared } from './TestProvider';
import { TestItem } from './TestItem';
import { LoggerWrapper } from './LoggerWrapper';
import { VariableResolver, createPythonIndexerForPathVariable } from './util/VariableResolver';
import { Configuration } from './Configuration';
import { TaskPool } from './util/TaskPool';
import { BuildProcessChecker } from './util/BuildProcessChecker';
import { AbstractRunnable } from './AbstractRunnable';
import { TestRunEvent } from './SharedVariables';
import { AbstractTest, AbstractTestEvent } from './AbstractTest';
import { ExecutableConfig } from './ExecutableConfigX';
import { RootSuite } from './RootSuite';
import { Suite } from './Suite';

///

export class TestHierarchy implements vscode.TestHierarchy<TestItem> {
  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _onDidChangeTestEmitter = new vscode.EventEmitter<TestItem>();

  public readonly root: RootSuite;

  public readonly onDidChangeTest: vscode.Event<TestItem> = this._onDidChangeTestEmitter.event;

  public readonly discoveredInitialTests?: Thenable<unknown>;

  private readonly _shared: TestHierarchyShared;

  private readonly _removeFromHierarchy: () => void;

  public constructor(workspace: vscode.WorkspaceFolder, testProviderShared: TestProviderShared) {
    if (testProviderShared.hierarchies.indexOf(this) !== -1) throw Error('assert');
    testProviderShared.hierarchies.push(this);
    this._removeFromHierarchy = (): void => {
      const foundIndex = testProviderShared.hierarchies.indexOf(this);
      if (foundIndex === -1) throw Error('assert');
      testProviderShared.hierarchies.splice(foundIndex, 1);
    };

    const logger = testProviderShared.logger;

    logger.info(
      'Extension constructor',
      workspace.name,
      workspace.index,
      workspace.uri.fsPath,
      process.platform,
      process.version,
      process.versions,
      vscode.version,
    );

    const onDidChangeTest = (item: TestItem): void => {
      this._onDidChangeTestEmitter.fire(item);
    };

    this._shared = new TestHierarchyShared(workspace, testProviderShared, onDidChangeTest);

    this.root = new RootSuite(undefined, this._shared);

    this._disposables.push(
      this._shared.configuration.onDidChange(changeEvent => {
        try {
          if (changeEvent.affectsAny('test.randomGeneratorSeed', 'gtest.treatGmockWarningAs', 'gtest.gmockVerbose')) {
            //this._retireEmitter.fire({}); TODO
          }

          if (
            changeEvent.affectsAny(
              'test.workingDirectory',
              'test.advancedExecutables',
              'test.executables',
              'test.parallelExecutionOfExecutableLimit',
              'discovery.strictPattern',
            )
          ) {
            this._reloadTests();
          }
        } catch (e) {
          this._shared.logger.exceptionS(e);
        }
      }),
    );

    this.discoveredInitialTests = this._reloadTests().catch(err => {
      this._shared.logger.exceptionS(err);
      debugger;
    });
  }

  public dispose(): void {
    this._execConfig.forEach(d => d.dispose());
    this._onDidChangeTestEmitter.dispose();

    this._disposables.forEach(d => {
      try {
        d.dispose();
      } catch (e) {
        this._shared.logger.error('dispose', e, d);
      }
    });

    this._removeFromHierarchy();
  }

  private _execConfig: ExecutableConfig[] = [];

  private async _reloadTests(): Promise<void> {
    this.root.children = [];

    this._execConfig = this._shared.configuration.getExecutables();

    const load = this._execConfig.map(v =>
      v.load(this.root).catch(err => {
        this._shared.logger.exceptionS(err);
      }),
    );

    return Promise.all(load).then();
  }

  public runTests(
    options: vscode.TestRunOptions<Suite | AbstractTest>,
    cancellationToken: vscode.CancellationToken,
  ): Thenable<void> {
    if (!options.debug) {
      return this.root.run(options.tests, cancellationToken).catch(err => {
        this._shared.logger.exceptionS(err);
        debugger;
      });
    } else {
      return Promise.resolve().catch(err => {
        this._shared.logger.exceptionS(err);
        debugger;
      });
    }
  }
}

export class TestHierarchyShared implements vscode.Disposable {
  public readonly logger: LoggerWrapper;
  public readonly log: LoggerWrapper; // TODO temp
  public readonly executeTask: ExecuteTaskCallbackType;
  public readonly buildProcessChecker: BuildProcessChecker;

  public readonly variableResolver: VariableResolver;
  public readonly configuration: Configuration;

  public constructor(
    public readonly workspace: vscode.WorkspaceFolder,
    testProviderShared: TestProviderShared,
    public readonly onDidChangeTest: (item: TestItem, childrenRecursive: boolean) => void,
  ) {
    this.logger = testProviderShared.logger;
    this.log = this.logger;
    this.executeTask = testProviderShared.executeTask;
    this.buildProcessChecker = testProviderShared.buildProcessChecker;

    this.variableResolver = new VariableResolver(
      [
        createPythonIndexerForPathVariable('workspaceFolder', workspace.uri.fsPath),
        { resolve: '${workspaceName}', rule: (): Promise<string> => Promise.resolve(workspace.name) },
      ],
      testProviderShared.variableResolver,
    );

    this.configuration = new Configuration(testProviderShared.logger, workspace.uri, this);

    this.taskPool = new TaskPool(this.configuration.getParallelExecutionLimit());

    this._configChangeListener = this.configuration.onDidChange(changeEvent => {
      if (changeEvent.affects('test.parallelExecutionLimit'))
        this.taskPool.maxTaskCount = this.configuration.getParallelExecutionLimit();
    });
  }

  public dispose(): void {
    this._configChangeListener.dispose();
    this.configuration.dispose();
  }

  private readonly _configChangeListener: vscode.Disposable;

  public readonly taskPool: TaskPool;

  //TODO
  public readonly loadWithTask: (task: () => Promise<void | Error[]>) => Promise<void> = () => {
    return Promise.resolve();
  };
  public readonly sendRetireEvent: (tests: Iterable<AbstractRunnable>) => void = () => {
    return undefined;
  };
  public readonly sendTestRunEvent: (event: TestRunEvent) => void = () => {
    return undefined;
  };
  public readonly sendTestEvents: (testEvents: AbstractTestEvent[]) => void = () => {
    return undefined;
  };
}
