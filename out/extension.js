"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const agent_scanner_lib_1 = require("./agent-scanner-lib");
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
function activate(context) {
    let myStatusBarItem;
    console.log('Congratulations, your extension "agentdesigner" is now active!');
    // Launch agent scanner on extension activation
    launchAgentScanner();
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
}
/**
 * Launches the agent scanner and outputs results to terminal
 */
async function launchAgentScanner() {
    try {
        console.log('🔍 Launching Agent Scanner...');
        // Get the current workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const targetDirectory = workspaceFolder ? workspaceFolder.uri.fsPath : process.cwd();
        console.log(`📂 Scanning directory: ${targetDirectory}`);
        // Use the scanner
        const scanResult = await (0, agent_scanner_lib_1.scanDirectory)(targetDirectory);
        // Output the results as JSON to the terminal/console
        const jsonOutput = JSON.stringify(scanResult, null, 2);
        console.log('📊 Agent Scanner Results:');
        console.log(jsonOutput);
        // Also show a summary in VS Code
        const summary = `Found ${scanResult.totalAgents} agents in ${scanResult.filesWithAgents} files (scanned ${scanResult.totalFiles} total files)`;
        vscode.window.showInformationMessage(`Agent Scanner: ${summary}`);
    }
    catch (error) {
        console.error('❌ Error running agent scanner:', error);
        vscode.window.showErrorMessage(`Agent Scanner failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
// This method is called when your extension is deactivated
function deactivate() { }
//# sourceMappingURL=extension.js.map