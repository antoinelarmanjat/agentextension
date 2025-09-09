import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { findAnyAgentLocation } from './agent-finder';
import { findToolLocation } from './agent-finder';
import { AgentTreeDataProvider } from './agent-tree-provider';
import { spawn, ChildProcess } from 'child_process';
import * as dotenv from 'dotenv';


 
let fileLastLengths: Map<string, number> = new Map();

let adkProcess: (ChildProcess | vscode.Terminal) | null = null;

// Function to get webview content
function getWebviewContent() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Logs JSON Viewer</title>
    <style>
        body { font-family: monospace; font-size: 10px; padding: 10px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); }
        #fileList { margin-bottom: 20px; }
        #fileList button { margin-right: 5px; margin-bottom: 5px; padding: 5px 10px; background: transparent; color: var(--vscode-textLink-foreground); border: none; cursor: pointer; }
        #fileList button:hover { background: rgba(255, 255, 255, 0.1); }
        #jsonTree { border: 1px solid var(--vscode-panel-border); padding: 10px; max-height: 600px; overflow-y: auto; white-space: pre-wrap; }
        details { margin-left: 20px; cursor: pointer; border-left: 2px solid var(--vscode-textLink-foreground); padding-left: 10px; }
        summary { font-weight: bold; user-select: none; }
        .primitive { color: var(--vscode-textPreformat-foreground); }
        .key { color: var(--vscode-textLink-foreground); }
        .error { color: var(--vscode-errorForeground); margin-top: 10px; }
        #refreshBtn { padding: 3px 6px; background: transparent; border: none; color: var(--vscode-textLink-foreground); cursor: pointer; }
    </style>
</head>
<body>
    <div style="display: flex; justify-content: flex-end; margin-bottom: 10px;">
        <button id="refreshBtn" onclick="refreshFiles()">Refresh Files</button>
    </div>
    <div id="fileList"></div>
    <div id="jsonTree"></div>
    <div id="error" class="error" style="display: none;"></div>
    <script>
        const vscode = acquireVsCodeApi();
        let pollInterval = null;
        let selectedFile = vscode.getState()?.selectedFile || null;
        let expandedPaths = new Set();

        function showError(text) {
            const errorDiv = document.getElementById('error');
            errorDiv.textContent = text;
            errorDiv.style.display = 'block';
            setTimeout(() => { errorDiv.style.display = 'none'; }, 50000);
        }

        function refreshFiles() {
            vscode.postMessage({ command: 'getFiles' });
            if (selectedFile && pollInterval) {
                clearInterval(pollInterval);
                pollInterval = setInterval(() => vscode.postMessage({ command: 'loadFile', path: selectedFile }), 50000);
            }
        }

        function renderJson(obj, container, currentPath = '') {
            container.innerHTML = '';
            if (obj === null) {
                container.textContent = 'null';
                return;
            }
            if (Array.isArray(obj)) {
                const details = document.createElement('details');
                details.open = true;
                const path = currentPath ? \`\${currentPath}[\${obj.length}]\` : \`[\${obj.length}]\`;
                details.dataset.path = path;
                details.innerHTML = \`<summary class="key">Array [\${obj.length}]</summary>\`;
                if (expandedPaths.has(path)) {
                    details.open = true;
                }
                const div = document.createElement('div');
                details.appendChild(div);
                obj.forEach((item, index) => {
                    const itemDetails = document.createElement('details');
                    const summary = document.createElement('summary');
                    summary.className = 'key';
                    summary.textContent = \`[\${index}]\`;
                    itemDetails.appendChild(summary);
                    const itemDiv = document.createElement('div');
                    itemDetails.appendChild(itemDiv);
                    renderJson(item, itemDiv, \`\${path}[\${index}]\`);
                    details.appendChild(itemDetails);
                });
                container.appendChild(details);
            } else if (typeof obj === 'object') {
                const details = document.createElement('details');
                details.open = true;
                const keys = Object.keys(obj);
                const path = currentPath ? \`\${currentPath}.\${keys.length}\` : \`\${keys.length}\`;
                details.dataset.path = path;
                details.innerHTML = \`<summary class="key">Object {\${keys.length}} keys</summary>\`;
                if (expandedPaths.has(path)) {
                    details.open = true;
                }
                const div = document.createElement('div');
                details.appendChild(div);
                keys.forEach(key => {
                    const keyDetails = document.createElement('details');
                    const summary = document.createElement('summary');
                    summary.innerHTML = \`<span class="key">\${key}:</span>\`;
                    keyDetails.appendChild(summary);
                    const valueDiv = document.createElement('div');
                    keyDetails.appendChild(valueDiv);
                    renderJson(obj[key], valueDiv, currentPath ? \`\${currentPath}.\${key}\` : key);
                    details.appendChild(keyDetails);
                });
                container.appendChild(details);
            } else {
                const span = document.createElement('span');
                span.className = 'primitive';
                span.textContent = JSON.stringify(obj);
                container.appendChild(span);
            }
        }

        function appendItems(items) {
            const jsonTree = document.getElementById('jsonTree');
            const contentDiv = jsonTree.querySelector('#jsonContent');
            if (!contentDiv) return;
            const arrayDetails = contentDiv.querySelector('details');
            if (!arrayDetails) return;
            const childrenDiv = arrayDetails.querySelector('div');
            if (!childrenDiv) return;
            let currentLength = childrenDiv.querySelectorAll('details').length;
            const summary = arrayDetails.querySelector('summary');
            items.forEach((item, index) => {
                const globalIndex = currentLength + index;
                const itemPath = '[' + globalIndex + ']';
                const itemDetails = document.createElement('details');
                itemDetails.dataset.path = itemPath;
                const itemSummary = document.createElement('summary');
                itemSummary.className = 'key';
                itemSummary.textContent = '[' + globalIndex + ']';
                itemDetails.appendChild(itemSummary);
                const itemDiv = document.createElement('div');
                itemDetails.appendChild(itemDiv);
                renderJson(item, itemDiv, itemPath);
                childrenDiv.appendChild(itemDetails);
            });
            if (summary && summary.textContent.includes('Array ')) {
                const newLen = currentLength + items.length;
                summary.textContent = 'Array [' + newLen + ']';
            }
        }

        function appendItems(items) {
            const jsonTree = document.getElementById('jsonTree');
            const contentDiv = jsonTree.querySelector('#jsonContent');
            if (!contentDiv) return;
            const arrayDetails = contentDiv.querySelector('details');
            if (!arrayDetails) return;
            const childrenDiv = arrayDetails.querySelector('div');
            if (!childrenDiv) return;
            let currentLength = childrenDiv.querySelectorAll('details').length;
            const summary = arrayDetails.querySelector('summary');
            const rootPath = arrayDetails.dataset.path || '';
            items.forEach((item, index) => {
                const globalIndex = currentLength + index;
                const itemPath = rootPath ? rootPath + '[' + globalIndex + ']' : '[' + globalIndex + ']';
                const itemDetails = document.createElement('details');
                itemDetails.dataset.path = itemPath;
                const itemSummary = document.createElement('summary');
                itemSummary.className = 'key';
                itemSummary.textContent = '[' + globalIndex + ']';
                itemDetails.appendChild(itemSummary);
                const itemDiv = document.createElement('div');
                itemDetails.appendChild(itemDiv);
                renderJson(item, itemDiv, itemPath);
                childrenDiv.appendChild(itemDetails);
            });
            if (summary && summary.textContent.indexOf('Array [') >= 0) {
                const newLen = currentLength + items.length;
                summary.textContent = 'Array [' + newLen + ']';
            }
            // Ensure root is expanded if previously was
            if (expandedPaths.has(rootPath)) {
                arrayDetails.open = true;
            }
        }

        function loadFile(path) {
            selectedFile = path;
            vscode.postMessage({ command: 'loadFile', path: path });
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = setInterval(() => {
                if (selectedFile) vscode.postMessage({ command: 'loadFile', path: selectedFile });
            }, 50000);
        }

        // Initial load
        window.addEventListener('DOMContentLoaded', () => {
            refreshFiles();
            // Listen for toggle events to update expanded state
            document.addEventListener('toggle', (e) => {
                if (e.target instanceof HTMLDetailsElement) {
                    const path = e.target.dataset.path || '';
                    if (e.target.open) {
                        expandedPaths.add(path);
                    } else {
                        expandedPaths.delete(path);
                    }
                }
            }, true);
        });

       // Handle messages
       window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'filesList':
                    const fileListDiv = document.getElementById('fileList');
                    fileListDiv.innerHTML = '<h3>Select a log directory and JSON file:</h3>';
                    message.sessions.forEach(ses => {
                        const details = document.createElement('details');
                        details.open = true;
                        const summary = document.createElement('summary');
                        summary.textContent = ses.dir;
                        summary.style.fontWeight = 'bold';
                        details.appendChild(summary);
                        const filesDiv = document.createElement('div');
                        filesDiv.style.paddingLeft = '20px';
                        ses.files.forEach(file => {
                            const btn = document.createElement('button');
                            btn.textContent = file.name;
                            btn.onclick = () => loadFile(file.path);
                            btn.style.display = 'inline-block';
                            btn.style.marginRight = '5px';
                            btn.style.marginBottom = '5px';
                            filesDiv.appendChild(btn);
                        });
                        details.appendChild(filesDiv);
                        fileListDiv.appendChild(details);
                    });
                    break;
                case 'fileContent':
                    const jsonTree = document.getElementById('jsonTree');
                    const fileName = selectedFile ? selectedFile.split('/').pop() || selectedFile : 'Unknown file';
                    jsonTree.innerHTML = '<h3 style="margin-top: 0; margin-bottom: 10px; color: var(--vscode-textLink-foreground);">Viewing: ' + fileName + '</h3><div id="jsonContent"></div>';
                    renderJson(message.content, document.getElementById('jsonContent'), '');
                    document.getElementById('error').style.display = 'none';
                    break;
                case 'append':
                    appendItems(message.items);
                    break;
                case 'error':
                    showError(message.text);
                    break;
            }
        });

        document.addEventListener('DOMContentLoaded', () => {
            const questionSelect = document.getElementById('questionSelect');
            const freeText = document.getElementById('freeText');

            questionSelect.addEventListener('change', () => {
                freeText.value = questionSelect.options[questionSelect.selectedIndex].text;
            });

            const analyzeBtn = document.getElementById('analyzeBtn');
            const textBlock = document.getElementById('textBlock');
            analyzeBtn.addEventListener('click', () => {
                setTimeout(() => {
                    textBlock.textContent = "Root agent initializes the conversation, sets up user profile (US Citizen, window seat preference, vegan food, home in San Diego, CA), and transfers control to the inspiration_agent. Inspiration_agent receives the query, calls the poi_agent with Milano, Italy to fetch points of interest. Poi_agent responds with a list of 5 top attractions: Duomo di Milano (4.8 rating, Gothic cathedral), Galleria Vittorio Emanuele II (4.7, shopping arcade), Sforzesco Castle (4.6, historic fortress with museums), Teatro alla Scala (4.7, opera house), and Pinacoteca di Brera (4.6, art gallery with Renaissance works). Each includes address, coordinates, highlights, and image URL. The state is updated with this POI data. Inspiration_agent then calls the map_tool with the POI key, receiving the same place data (possibly for map generation). Inspiration_agent generates a user-friendly response summarizing the places and asks if any interest the user or if alternatives are needed.";
                }, 7000);
            });
        });
    </script>
    <div style="margin-bottom: 20px;">
        <label for="questionSelect" style="display: block; margin-bottom: 5px;">Select a Question:</label>
        <select id="questionSelect" style="width: 100%; padding: 8px; margin-bottom: 10px; border: 1px solid var(--vscode-input-border); background-color: var(--vscode-input-background); color: var(--vscode-input-foreground);">
            <option value="question1">Please analyze the events and show me the highlights of each even in this run</option>
            <option value="question2">Please highlight the state changes over time in this run</option>
            <option value="question3">Please show me the state with only the non empty strings/values</option>
            <option value="question4">Please show me the events with only the non empty strings</option>
        </select>

        
        <input type="text" id="freeText" style="width: 100%; padding: 8px; margin-bottom: 10px; border: 1px solid var(--vscode-input-border); background-color: var(--vscode-input-background); color: var(--vscode-input-foreground);">
        <button id="analyzeBtn" style="padding: 3px 6px; background: transparent; border: none; color: var(--vscode-textLink-foreground); cursor: pointer;">Analyze with AI</button>

        
        <div id="textBlock" style="width: 100%; padding: 8px; border: 1px solid var(--vscode-input-border); background-color: var(--vscode-input-background); color: var(--vscode-input-foreground);">
            This is a block of text.
        </div>
    </div>
</body>
</html>`;
}

// This method is called when your extension is activated
// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
    let myStatusBarItem: vscode.StatusBarItem;
    const outputChannel = vscode.window.createOutputChannel("ADK Web");


    console.log('Congratulations, your extension "agent-inspector" is now active!');
    console.log('Agent Inspector Extension Activated');
    console.log('Loading __init__.py');

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
                label: agent.args.name || 'Unnamed Agent',
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
                const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath);
                const doc = await vscode.workspace.openTextDocument(absolutePath);
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
                label: agent.args.name || 'Unnamed Agent',
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
                const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath);
                const doc = await vscode.workspace.openTextDocument(absolutePath);
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

        const location = findAnyAgentLocation(fileName, agent, rootPath);

        if (location.found) {
            const absolutePath = path.isAbsolute(location.actualFileName) ? location.actualFileName : path.join(rootPath, location.actualFileName);
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
            const absolutePath = path.isAbsolute(location.actualFileName) ? location.actualFileName : path.join(rootPath, location.actualFileName);
            const document = await vscode.workspace.openTextDocument(absolutePath);
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
        const isDebugMode = fs.existsSync(context.asAbsolutePath('dist'));
        const pythonScriptPath = isDebugMode
            ? context.asAbsolutePath(path.join('src', 'python', 'process_log.py'))
            : context.asAbsolutePath(path.join('python', 'process_log.py'));
        const timestamp = new Date().toISOString().replace(/[-:.]/g, '').slice(0, -4);
        const logsDir = path.join(rootPath, 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir);
        }
        const logFileName = path.join(logsDir, `agent_events_${timestamp}.log`);

        const extensionPath = context.extensionPath;
        const agentWithDumpPath = path.join(extensionPath, 'src');

        const envPath = path.join(rootPath, '.env');
        const envConfig = dotenv.parse(fs.readFileSync(envPath));

        const terminalEnv: { [key: string]: string } = Object.fromEntries(
            Object.entries(process.env).map(([k, v]) => [k, v as string])
        );

        for (const k in envConfig) {
            terminalEnv[k] = envConfig[k];
        }

        const terminal = vscode.window.createTerminal({
            name: 'ADK Web',
            cwd: agentWithDumpPath,
            env: terminalEnv
        });

        const fullCommand = `export PATH="/Library/Frameworks/Python.framework/Versions/3.12/bin:\$PATH"; export PROJECT_DIR="${rootPath}"; adk web --port 5000 --log_level DEBUG 1> >(python3 "${pythonScriptPath}" --source stdout > "${logFileName}") 2> >(python3 "${pythonScriptPath}" --source stderr >> "${logFileName}")`;

        terminal.sendText(fullCommand);
        terminal.show();

        adkProcess = terminal;

        outputChannel.show();
        vscode.commands.executeCommand('setContext', 'adk.web.running', true);

        // Wait for 5 seconds before opening the browser
        setTimeout(() => {
            vscode.env.openExternal(vscode.Uri.parse('http://127.0.0.1:5000'));
        }, 5000);
    });
    context.subscriptions.push(runAdkWebTopBarCommand);

    const stopAdkWebCommand = vscode.commands.registerCommand('agent-inspector.stopAdkWeb', () => {
        if (adkProcess) {
            if ('dispose' in adkProcess) {
                (adkProcess as vscode.Terminal).dispose();
            } else if ('pid' in adkProcess) {
                const pid = (adkProcess as ChildProcess).pid;
  if (pid !== undefined){
                    try {
                        process.kill(-pid);
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Error stopping ADK Web process: ${e.message}`);
                    }
  }
            }
            vscode.window.showInformationMessage('ADK Web process stopped.');
            adkProcess = null;
            vscode.commands.executeCommand('setContext', 'adk.web.running', false);
        } else {
            vscode.window.showWarningMessage('ADK Web process not running.');
        }
    });
    context.subscriptions.push(stopAdkWebCommand);

    let logsPanel: vscode.WebviewPanel | undefined = undefined;

    const viewLogsWebviewCommand = vscode.commands.registerCommand('agent-inspector.viewLogsWebview', async () => {
        const rootPath = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0)
            ? vscode.workspace.workspaceFolders[0].uri.fsPath : undefined;

        if (!rootPath) {
            vscode.window.showErrorMessage('No workspace folder found.');
            return;
        }

        const rootUri = vscode.Uri.file(rootPath);

        if (logsPanel) {
            logsPanel.reveal(vscode.ViewColumn.One);
        } else {
            logsPanel = vscode.window.createWebviewPanel(
                'logsViewer',
                'Logs JSON Viewer',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                }
            );

            logsPanel.webview.html = getWebviewContent();

            logsPanel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'getFiles':
                        try {
                            console.log('Reading logs directory');
                            const logsUri = vscode.Uri.joinPath(rootUri, 'logs');
                            const entries = await vscode.workspace.fs.readDirectory(logsUri);
                            console.log('Found entries:', entries.length, entries.map(([n]) => n));
                            const sessions: { dir: string; files: { name: string; path: string }[] }[] = [];
                            const timestampRegex = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;
                            for (const [name, type] of entries) {
                                console.log('Processing entry:', name, type);
                                if (type === vscode.FileType.Directory && name.match(timestampRegex)) {
                                    console.log('Directory matches timestamp regex:', name);
                                    const dirUri = vscode.Uri.joinPath(logsUri, name);
                                    try {
                                        const subEntries = await vscode.workspace.fs.readDirectory(dirUri);
                                        console.log('Subentries for', name, ':', subEntries.length, subEntries.map(([n]) => n));
                                        const dirFiles: { name: string; path: string }[] = [];
                                        for (const [subName, subType] of subEntries) {
                                            if (subName.endsWith('.json') && subType === vscode.FileType.File) {
                                                const fullPath = path.join('logs', name, subName).replace(/\\/g, '/');
                                                dirFiles.push({ name: subName, path: fullPath });
                                            }
                                        }
                                        console.log('JSON files found in', name, ':', dirFiles.length);
                                        if (dirFiles.length > 0) {
                                            sessions.push({ dir: name, files: dirFiles });
                                        }
                                    } catch (err) {
                                        console.error(`Error reading subdir ${name}:`, err);
                                    }
                                } else {
                                    console.log('Skipping', name, 'type:', type, 'regex match:', !!name.match(timestampRegex));
                                }
                            }
                            sessions.sort((a, b) => b.dir.localeCompare(a.dir));
                            console.log('Final sessions to send:', sessions.length, sessions.map(s => ({dir: s.dir, fileCount: s.files.length})));
                            logsPanel?.webview.postMessage({ command: 'filesList', sessions });
                        } catch (err) {
                            console.error('Error reading logs dir:', err);
                            logsPanel?.webview.postMessage({ command: 'error', text: 'Failed to read logs directory' });
                        }
                        break;
                    case 'loadFile':
                        try {
                            const fileUri = vscode.Uri.joinPath(rootUri, message.path);
                            const fileData = await vscode.workspace.fs.readFile(fileUri);
                            const jsonString = new TextDecoder().decode(fileData);
                            const jsonObj = JSON.parse(jsonString);
                            const filePath = message.path;
                            let lastLength = fileLastLengths.get(filePath) || 0;
                            const isArray = Array.isArray(jsonObj);
                            if (!isArray || lastLength === 0) {
                                logsPanel?.webview.postMessage({ command: 'fileContent', content: jsonObj });
                                if (isArray) {
                                    fileLastLengths.set(filePath, jsonObj.length);
                                }
                            } else if (isArray && jsonObj.length > lastLength) {
                                const newItems = jsonObj.slice(lastLength);
                                logsPanel?.webview.postMessage({ command: 'append', items: newItems });
                                fileLastLengths.set(filePath, jsonObj.length);
                            } // else do nothing to preserve state
                        } catch (err) {
                            console.error('Error reading file:', err);
                            logsPanel?.webview.postMessage({ command: 'error', text: `Failed to load file ${message.path}: ${(err as Error).message}` });
                        }
                        break;
                }
            }, undefined, context.subscriptions);

            logsPanel.onDidDispose(() => {
                logsPanel = undefined;
            }, undefined, context.subscriptions);
        }
    });
    context.subscriptions.push(viewLogsWebviewCommand);
}


// This method is called when your extension is deactivated
export function deactivate() { }
