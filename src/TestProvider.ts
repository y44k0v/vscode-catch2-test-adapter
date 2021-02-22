import * as vscode from 'vscode';
import { TestHierarchy } from './TestHierarchy';
import { TestItem } from './TestItem';
import { LoggerWrapper } from './LoggerWrapper';
import { VariableResolver } from './util/VariableResolver';
import { TaskQueue } from './util/TaskQueue';
import { BuildProcessChecker } from './util/BuildProcessChecker';
import { sep as osPathSeparator } from 'path';

export class TestProvider implements vscode.TestProvider, vscode.Disposable {
  private readonly _shared = new TestProviderShared();

  public dispose(): void {
    this._shared.dispose();
  }

  createWorkspaceTestHierarchy(workspace: vscode.WorkspaceFolder): TestHierarchy | undefined {
    try {
      return new TestHierarchy(workspace, this._shared);
    } catch (err) {
      debugger;
      this._shared.logger.exceptionS(err);
      throw Error(`Cound't create TestHierarchy for ${workspace.uri}: ${err}`);
    }
  }

  runTests(options: vscode.TestRun<TestItem>, cancellationToken: vscode.CancellationToken): Thenable<void> {
    return Promise.all(this._shared.hierarchies.map(h => h.runTests(options, cancellationToken))).then();
  }
}

export type ExecuteTaskCallbackType = (
  taskName: string,
  variableResolver: VariableResolver,
  cancellationToken: vscode.CancellationToken,
) => Promise<number | undefined>;

export class TestProviderShared implements vscode.Disposable {
  public dispose(): void {
    this.logger.dispose();
  }

  public readonly hierarchies: Array<Readonly<TestHierarchy>> = [];

  public readonly logger: LoggerWrapper = new LoggerWrapper('testMate.cpp.log', undefined, 'C++ TestMate');

  public readonly variableResolver: VariableResolver = new VariableResolver([
    { resolve: '${osPathSep}', rule: osPathSeparator },
    { resolve: '${osPathEnvSep}', rule: process.platform === 'win32' ? ';' : ':' },
    {
      resolve: /\$\{command:([^}]+)\}/,
      rule: async (m: RegExpMatchArray): Promise<string> => {
        try {
          const ruleV = await vscode.commands.executeCommand<string>(m[1]);
          if (ruleV !== undefined) return ruleV;
        } catch (reason) {
          this.logger.warnS("couldn't resolve command", m[0]);
        }
        return m[0];
      },
    },
  ]);

  public readonly isDebugRun: boolean = process.env['C2_DEBUG'] === 'true';

  private readonly executeTaskQueue = new TaskQueue();
  public readonly executeTask: ExecuteTaskCallbackType = (
    taskName: string,
    variableResolver: VariableResolver,
    cancellationToken: vscode.CancellationToken,
  ): Promise<number | undefined> => {
    return this.executeTaskQueue.then(async () => {
      const tasks = await vscode.tasks.fetchTasks();
      const found = tasks.find(t => t.name === taskName);
      if (found === undefined) {
        const msg = `Could not find task with name "${taskName}".`;
        this.logger.warn(msg);
        throw Error(msg);
      }

      const resolvedTask = await variableResolver.resolveAsync(found);
      // Task.name setter needs to be triggered in order for the task to clear its __id field
      // (https://github.com/microsoft/vscode/blob/ba33738bb3db01e37e3addcdf776c5a68d64671c/src/vs/workbench/api/common/extHostTypes.ts#L1976),
      // otherwise task execution fails with "Task not found".
      resolvedTask.name += '';

      //TODO timeout
      if (cancellationToken.isCancellationRequested) return;

      const result = new Promise<number | undefined>(resolve => {
        const disp1 = vscode.tasks.onDidEndTask((e: vscode.TaskEndEvent) => {
          if (e.execution.task.name === resolvedTask.name) {
            this.logger.info('Task execution has finished', resolvedTask.name);
            disp1.dispose();
            resolve(undefined);
          }
        });

        const disp2 = vscode.tasks.onDidEndTaskProcess((e: vscode.TaskProcessEndEvent) => {
          if (e.execution.task.name === resolvedTask.name) {
            this.logger.info('Task execution has finished', resolvedTask.name, e.exitCode);
            disp2.dispose();
            resolve(e.exitCode);
          }
        });
      });

      this.logger.info('Task execution has started', resolvedTask);

      const execution = await vscode.tasks.executeTask(resolvedTask);

      cancellationToken.onCancellationRequested(() => {
        this.logger.info('Task execution was terminated', execution.task.name);
        execution.terminate();
      });

      return result;
    });
  };

  public readonly buildProcessChecker: BuildProcessChecker = new BuildProcessChecker(this.logger);
}
