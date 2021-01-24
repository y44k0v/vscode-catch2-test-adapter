import * as vscode from 'vscode';
import { TestProvider } from './TestProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const testProvider = new TestProvider();

  vscode.test.registerTestProvider(testProvider);

  context.subscriptions.push(testProvider);
}
