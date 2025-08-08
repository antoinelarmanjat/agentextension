// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { scanDirectory, createHierarchicalStructure } from './agent-scanner-lib';

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

    // Kick off the agent scan on activation and print JSON to a terminal
    (async () => {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            const scanResult = await scanDirectory(workspaceFolder);
            const hierarchical = createHierarchicalStructure(scanResult);
            const jsonOutput = JSON.stringify(hierarchical, null, 2);

            const terminal = vscode.window.createTerminal({ name: 'Agent Scanner' });
            terminal.show();
            terminal.sendText("cat << 'JSON'\n" + jsonOutput + "\nJSON");
        } catch (err) {
            console.error('Agent scan failed on activation:', err);
        }
    })();
}

// This method is called when your extension is deactivated
export function deactivate() {}
