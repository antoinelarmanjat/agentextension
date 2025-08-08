import * as vscode from 'vscode';
import { agentScanner } from './agent-scanner-lib';
import * as path from 'path';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    let myStatusBarItem: vscode.StatusBarItem;

    console.log('Congratulations, your extension "agentdesigner" is now active!');

    const disposable = vscode.commands.registerCommand('agentdesigner.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from AgentDesigner!');
    });
    context.subscriptions.push(disposable);

    // ********* YOU ARE MISSING THIS BLOCK *********
    // This is the command that the status bar item will run
    const insertCommand = vscode.commands.registerCommand('agentdesigner.insertDateTime', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const selection = editor.selection;
            const dateTimeString = new Date().toLocaleString();
            editor.edit(editBuilder => {
                editBuilder.replace(selection, dateTimeString);
            });
        }
    });
    context.subscriptions.push(insertCommand);
    // ***********************************************


    // Create the status bar item
    myStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    
    // Set the command that runs when the item is clicked
    myStatusBarItem.command = 'agentdesigner.insertDateTime';

    // Set the text and tooltip
    myStatusBarItem.text = `$(watch) Insert Time`;
    myStatusBarItem.tooltip = `Inserts the current date and time`;

    // Add it to the subscriptions so it's disposed of when the extension deactivates
    context.subscriptions.push(myStatusBarItem);
    
    // And finally, show it in the status bar
    myStatusBarItem.show();

    const scanCommand = vscode.commands.registerCommand('agentdesigner.scanDirectory', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const rootPath = workspaceFolders[0].uri.fsPath;
            const scanResult = await agentScanner.scanDirectory(rootPath);
            const jsonOutput = JSON.stringify(scanResult, null, 2);
            const document = await vscode.workspace.openTextDocument({ content: jsonOutput, language: 'json' });
            await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
        } else {
            vscode.window.showErrorMessage('No workspace folder found.');
        }
    });
    context.subscriptions.push(scanCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}
