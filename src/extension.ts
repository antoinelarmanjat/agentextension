import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { findAnyAgentLocation } from './agent-finder';
import { findToolLocation } from './agent-finder';
import { AgentTreeDataProvider } from './agent-tree-provider';
import { spawn, ChildProcess } from 'child_process';
import * as dotenv from 'dotenv';

let adkProcess: ChildProcess | null = null;

// This method is called when your extension is activated
// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
    let myStatusBarItem: vscode.StatusBarItem;
    const outputChannel = vscode.window.createOutputChannel("ADK Web");


    console.log('Congratulations, your extension "agent-inspector" is now active!');
    console.log('Agent Inspector Extension Activated');

    const rootPath = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)
        ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

    if (!rootPath) {
        vscode.window.showErrorMessage('No workspace folder found.');
        return;
    }

    const agentTreeDataProvider = new AgentTreeDataProvider(rootPath, context);
    vscode.window.registerTreeDataProvider('agent-inspector.agentTree', agentTreeDataProvider);

    const disposable = vscode.commands.registerCommand('agent-inspector.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from AgentDesigner!');
    });
    context.subscriptions.push(disposable);
    const sayHelloCommand = vscode.commands.registerCommand('agent-inspector.sayHello', () => {
        vscode.window.showInformationMessage('Hello');
    });
    context.subscriptions.push(sayHelloCommand);
    const addToolCommand = vscode.commands.registerCommand('agent-inspector.addTool', async (item: any) => {
        let filePath: string | undefined;

        if (item && item.filePath) {
            filePath = item.filePath;
        } else {
            const agents = agentTreeDataProvider.getRootAgents().map(agent => ({
                label: agent.name || 'Unnamed Agent',
                description: agent.file,
                agent: agent
            }));

            const selectedAgent = await vscode.window.showQuickPick(agents, { placeHolder: 'Select an agent to add the tool to' });

            if (selectedAgent) {
                filePath = selectedAgent.agent.file;
            }
        }

        if (filePath) {
            const toolName = await vscode.window.showInputBox({ prompt: 'Enter the name of the new tool' });
            if (toolName) {
                const doc = await vscode.workspace.openTextDocument(filePath);
                const editor = await vscode.window.showTextDocument(doc);
                const eof = new vscode.Position(doc.lineCount, 0);
                editor.edit(editBuilder => {
                    const toolDefinition = `

def ${toolName}():
    pass
`;
                    editBuilder.insert(eof, toolDefinition);
                }).then(() => {
                    const newPosition = new vscode.Position(doc.lineCount - 2, 0);
                    editor.selection = new vscode.Selection(newPosition, newPosition);
                    editor.revealRange(new vscode.Range(newPosition, newPosition));
                });
            }
        }
    });
    context.subscriptions.push(addToolCommand);
    const addAgentCommand = vscode.commands.registerCommand('agent-inspector.addAgentTool', async (item: any) => {
        let filePath: string | undefined;

        if (item && item.filePath) {
            filePath = item.filePath;
        } else {
            const agents = agentTreeDataProvider.getRootAgents().map(agent => ({
                label: agent.name || 'Unnamed Agent',
                description: agent.file,
                agent: agent
            }));

            const selectedAgent = await vscode.window.showQuickPick(agents, { placeHolder: 'Select an agent to add the tool to' });

            if (selectedAgent) {
                filePath = selectedAgent.agent.file;
            }
        }

        if (filePath) {
            const agentToolName = await vscode.window.showInputBox({ prompt: 'Enter the name of the new agent tool' });
            if (agentToolName) {
                const doc = await vscode.workspace.openTextDocument(filePath);
                const editor = await vscode.window.showTextDocument(doc);
                
                // Append the agent definition to the end of the file
                const eof = new vscode.Position(doc.lineCount, 0);
                await editor.edit(editBuilder => {
                    const agentDefinition = `
${agentToolName} = Agent(
    model=,
    name=,
    description=,
    instruction=,
)
`;
                    editBuilder.insert(eof, agentDefinition);
                });

                const newPosition = new vscode.Position(doc.lineCount - 1, 0);
                editor.selection = new vscode.Selection(newPosition, newPosition);
                editor.revealRange(new vscode.Range(newPosition, newPosition));
            }
        }
    });
    context.subscriptions.push(addAgentCommand);


    // Create a new status bar item for running adk web
    // let adkStatusBarItem: vscode.StatusBarItem;
    // adkStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    // adkStatusBarItem.command = 'agent-inspector.runAdkWeb';
    // adkStatusBarItem.text = `$(terminal) Run ADK Web`;
    // adkStatusBarItem.tooltip = `Runs adk web with the specified environment variables`;
    // context.subscriptions.push(adkStatusBarItem);
    // adkStatusBarItem.show();

    // Register the command to run adk web
    // const runAdkWebCommand = vscode.commands.registerCommand('agent-inspector.runAdkWeb', () => {
    //     const terminal = vscode.window.createTerminal({
    //         name: 'ADK Web',
    //         env: {
    //             PATH: "/Library/Frameworks/Python.framework/Versions/3.12/bin:$PATH",
    //             GOOGLE_API_KEY: "AIzaSyBWCSHpR5FucjbeasA0XKrCPmCRRPKx4b8"
    //         }
    //     });
    //     terminal.sendText('adk web --port 5000');
    //     terminal.show();
    // });
    // context.subscriptions.push(runAdkWebCommand);


    const scanCommand = vscode.commands.registerCommand('agent-inspector.scanDirectory', async () => {
        agentTreeDataProvider.refresh();
        vscode.window.showInformationMessage(`Agent scan initiated. Refreshing tree view.`);
    });
    context.subscriptions.push(scanCommand);

    const refreshCommand = vscode.commands.registerCommand('agent-inspector.refreshTree', () => {
        try {
            agentTreeDataProvider.refresh();
        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Error refreshing agent tree: ${error.message}`);
            } else {
                vscode.window.showErrorMessage(`An unknown error occurred while refreshing the agent tree.`);
            }
        }
    });
    context.subscriptions.push(refreshCommand);

    const findAgentCommand = vscode.commands.registerCommand('agent-inspector.findAgent', async (filePath?: string, agentName?: string) => {
        const fileName = filePath || await vscode.window.showInputBox({ prompt: 'Enter the file name' });
        if (!fileName) {
            return;
        }

        const agent = agentName || await vscode.window.showInputBox({ prompt: 'Enter the agent name' });
        if (!agent) {
            return;
        }

        const absolutePath = path.isAbsolute(fileName) ? fileName : path.join(rootPath, fileName);

        const location = findAnyAgentLocation(absolutePath, agent);

        if (location.found) {
            const document = await vscode.workspace.openTextDocument(absolutePath);
            const editor = await vscode.window.showTextDocument(document);
            const lineNumber = location.lineNumber;
            const position = new vscode.Position(lineNumber - 1, 0);
            editor.selections = [new vscode.Selection(position, position)];
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            vscode.window.setStatusBarMessage(`Agent found at line ${lineNumber}`, 5000);
        } else {
            vscode.window.showErrorMessage(`Agent '${agent}' not found in file '${fileName}'.`);
        }
    });
    context.subscriptions.push(findAgentCommand);

    const findToolCommand = vscode.commands.registerCommand('agent-inspector.findTool', async (filePath?: string, toolName?: string) => {
        const fileName = filePath || await vscode.window.showInputBox({ prompt: 'Enter the file name containing the tool' });
        if (!fileName) {
            return;
        }

        const tool = toolName || await vscode.window.showInputBox({ prompt: 'Enter the tool name' });
        if (!tool) {
            return;
        }

        const location = findToolLocation(fileName, tool, rootPath);

        if (location.found) {
            const document = await vscode.workspace.openTextDocument(location.actualFileName);
            const editor = await vscode.window.showTextDocument(document);
            const lineNumber = location.lineNumber;
            const position = new vscode.Position(lineNumber - 1, 0);
            editor.selections = [new vscode.Selection(position, position)];
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            vscode.window.setStatusBarMessage(`Tool found at line ${lineNumber} in ${location.actualFileName}`, 5000);
        } else {
            vscode.window.showErrorMessage(`Tool '${tool}' not found in file '${fileName}'.`);
        }
    });
    context.subscriptions.push(findToolCommand);

    const runAdkWebTopBarCommand = vscode.commands.registerCommand('agent-inspector.runAdkWebTopBar', () => {
        if (adkProcess) {
            vscode.window.showInformationMessage('ADK Web is already running.');
            return;
        }
        // Execute the command in a terminal
        const pythonScriptPath = path.join(context.extensionPath, 'python', 'process_log.py');
        const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, -4);
        const logsDir = path.join(rootPath, 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir);
        }
        const logFileName = path.join(logsDir, `agent_events_${timestamp}.log`);

        const command = `adk web --port 5000 --log_level DEBUG 1> >(python3 ${pythonScriptPath} --source stdout > ${logFileName}) 2> >(python3 ${pythonScriptPath} --source stderr >> ${logFileName})`;
        
        const envPath = path.join(rootPath, '.env');
        const envConfig = dotenv.parse(fs.readFileSync(envPath));

        for (const k in envConfig) {
            process.env[k] = envConfig[k];
        }
        
        adkProcess = spawn(command, [], {
            env: {
                ...process.env,
            },
            shell: '/bin/bash',
            cwd: rootPath,
            detached: true
        });

        adkProcess.stdout?.on('data', (data) => {
            outputChannel.appendLine(data);
        });

        adkProcess.stderr?.on('data', (data) => {
            outputChannel.appendLine(`ERROR: ${data}`);
        });

        adkProcess.on('exit', (code) => {
            outputChannel.appendLine(`ADK Web process exited with code ${code}`);
            vscode.commands.executeCommand('setContext', 'adk.web.running', false);
            adkProcess = null;
        });

        outputChannel.show();
        vscode.commands.executeCommand('setContext', 'adk.web.running', true);


        // Wait for 5 seconds before opening the browser
        setTimeout(() => {
            vscode.env.openExternal(vscode.Uri.parse('http://127.0.0.1:5000'));
        }, 5000);
    });
    context.subscriptions.push(runAdkWebTopBarCommand);

    const stopAdkWebCommand = vscode.commands.registerCommand('agent-inspector.stopAdkWeb', () => {
        if (adkProcess && adkProcess.pid) {
            try {
                // Kill the entire process group by sending a signal to the negative PID.
                process.kill(-adkProcess.pid);
                vscode.window.showInformationMessage('ADK Web process stopped.');
            } catch (e: any) {
                vscode.window.showErrorMessage(`Error stopping ADK Web process: ${e.message}`);
            } finally {
                adkProcess = null;
                vscode.commands.executeCommand('setContext', 'adk.web.running', false);
            }
        } else {
            vscode.window.showWarningMessage('ADK Web process not running.');
        }
    });
    context.subscriptions.push(stopAdkWebCommand);
}
// This method is called when your extension is deactivated
export function deactivate() { }
