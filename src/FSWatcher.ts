import * as path from 'path';
import * as vscode from 'vscode';
import * as chokidar from 'chokidar';

export interface FSWatcher extends vscode.Disposable {
  ready: () => Promise<void>;
  watched: () => Promise<string[]>;
  onAll: (handler: (fsPath: string) => void) => void;
  onError: (handler: (err: Error) => void) => void;
}

export class VSCFSWatcherWrapper implements FSWatcher {
  public constructor(workspaceFolder: vscode.WorkspaceFolder, relativePattern: string) {
    if (path.isAbsolute(relativePattern)) throw new Error('Relative path is expected:' + relativePattern);

    this._relativePattern = new vscode.RelativePattern(workspaceFolder, relativePattern);

    this._vscWatcher = vscode.workspace.createFileSystemWatcher(this._relativePattern, false, false, false);
    this._disposables.push(this._vscWatcher);
  }

  public dispose(): void {
    this._disposables.forEach(c => c.dispose());
  }

  public ready(): Promise<void> {
    return Promise.resolve();
  }

  public watched(): Promise<string[]> {
    return new Promise(resolve => {
      vscode.workspace
        .findFiles(this._relativePattern, null, 10000)
        .then((uris: vscode.Uri[]) => resolve(uris.map(v => v.fsPath)));
    });
  }

  public onAll(handler: (fsPath: string) => void): void {
    this._disposables.push(this._vscWatcher.onDidCreate((uri: vscode.Uri) => handler(uri.fsPath)));
    this._disposables.push(this._vscWatcher.onDidChange((uri: vscode.Uri) => handler(uri.fsPath)));
    this._disposables.push(this._vscWatcher.onDidDelete((uri: vscode.Uri) => handler(uri.fsPath)));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public onError(_handler: (err: Error) => void): void {}

  private readonly _relativePattern: vscode.RelativePattern;
  private readonly _vscWatcher: vscode.FileSystemWatcher;
  private readonly _disposables: vscode.Disposable[] = [];
}

export class ChokidarWrapper implements FSWatcher {
  public constructor(patterns: string[]) {
    this._chokidar = new chokidar.FSWatcher({
      persistent: true,
      ignoreInitial: true,
      ignorePermissionErrors: true,
      awaitWriteFinish: true,
    });

    this._chokidar.add(patterns);

    this._watcherReady = new Promise((resolve, reject) => {
      this._chokidar.once('ready', resolve);
      this._chokidar.once('error', (err: Error) => {
        reject(err);
        this._watcherReady = Promise.reject(err);
      });
    });
  }

  public ready(): Promise<void> {
    return this._watcherReady;
  }

  public watched(): Promise<string[]> {
    return this.ready().then(() => {
      const filePaths: string[] = [];

      const watched = this._chokidar.getWatched();

      for (const dir in watched) {
        for (const file of watched[dir]) {
          filePaths.push(path.join(dir, file));
        }
      }

      return filePaths;
    });
  }

  public dispose(): void {
    // we only can close it after it is ready. (empiric)
    this.ready().finally(() => {
      this._chokidar.close();
    });
  }

  public onAll(handler: (fsPath: string) => void): void {
    this._chokidar.on('all', (event: string, fsPath: string) => handler(fsPath));
  }

  public onError(handler: (err: Error) => void): void {
    this._chokidar.on('error', handler);
  }

  private readonly _chokidar: chokidar.FSWatcher;
  private _watcherReady: Promise<void>;
}
