"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = __importStar(require("vscode"));
const agent_scanner_lib_1 = require("./agent-scanner-lib");
// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
function activate(context) {
    let myStatusBarItem;
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
            const scanResult = await (0, agent_scanner_lib_1.scanDirectory)(workspaceFolder);
            const hierarchical = (0, agent_scanner_lib_1.createHierarchicalStructure)(scanResult);
            const jsonOutput = JSON.stringify(hierarchical, null, 2);
            const terminal = vscode.window.createTerminal({ name: 'Agent Scanner' });
            terminal.show();
            terminal.sendText("cat << 'JSON'\n" + jsonOutput + "\nJSON");
        }
        catch (err) {
            console.error('Agent scan failed on activation:', err);
        }
    })();
}
// This method is called when your extension is deactivated
function deactivate() { }
//# sourceMappingURL=extension.js.map