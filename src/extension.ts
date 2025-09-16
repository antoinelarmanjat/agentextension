import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { findAnyAgentLocation } from './agent-finder';
import { findToolLocation } from './agent-finder';
import { AgentTreeDataProvider } from './agent-tree-provider';
import { AgentConfigViewProvider } from './agent-config-view';
import { spawn, ChildProcess } from 'child_process';
import * as dotenv from 'dotenv';
import { exec } from 'child_process';
import { detectAuth, listProjects, type AuthDetection } from './auth-manager';
import { generateAgentCard, checkA2A } from './a2a-manager';


 
const fileLastLengths: Map<string, number> = new Map();
let currentSelectedFile: string | null = null;  // NEW: Track currently viewed file

let adkProcess: (ChildProcess | vscode.Terminal) | null = null;
let agentConfigProvider: AgentConfigViewProvider | undefined;

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
        setTimeout(() => { errorDiv.style.display = 'none'; }, 5000);
    }

    function refreshFiles() {
        vscode.postMessage({ command: 'getFiles' });
        if (selectedFile && pollInterval) {
            clearInterval(pollInterval);
            pollInterval = setInterval(() => {
                if (selectedFile) vscode.postMessage({ command: 'loadFile', path: selectedFile });
            }, 50000);
        }
    }

    function renderJson(obj, container, currentPath) {
        container.innerHTML = '';
        if (obj === null) {
            container.textContent = 'null';
            return;
        }
        if (Array.isArray(obj)) {
            const details = document.createElement('details');
            details.open = expandedPaths.has(currentPath);
            const path = currentPath;
            details.dataset.path = path;
            // FIXED: Use string concatenation instead of template literal
            details.innerHTML = '<summary class="key">Array [' + obj.length + ']</summary>';
            const div = document.createElement('div');
            details.appendChild(div);
            obj.forEach(function(item, index) {  // Use function() for older JS compatibility if needed
                const itemDetails = document.createElement('details');
                const summary = document.createElement('summary');
                summary.className = 'key';
                summary.textContent = '[' + index + ']';
                itemDetails.appendChild(summary);
                const itemDiv = document.createElement('div');
                itemDetails.appendChild(itemDiv);
                var itemPath = currentPath ? currentPath + '[' + index + ']' : '[' + index + ']';  // FIXED: String concat
                itemDetails.dataset.path = itemPath;
                renderJson(item, itemDiv, itemPath);
                details.appendChild(itemDetails);
            });
            container.appendChild(details);
        } else if (typeof obj === 'object') {
            const details = document.createElement('details');
            details.open = expandedPaths.has(currentPath);
            const keys = Object.keys(obj);
            const path = currentPath;
            details.dataset.path = path;
            // FIXED: Use string concatenation
            details.innerHTML = '<summary class="key">Object {' + keys.length + '} keys</summary>';
            const div = document.createElement('div');
            details.appendChild(div);
            keys.forEach(function(key) {  // Use function() for compatibility
                const keyDetails = document.createElement('details');
                const summary = document.createElement('summary');
                summary.innerHTML = '<span class="key">' + key + ':</span>';  // FIXED: String concat
                keyDetails.appendChild(summary);
                const valueDiv = document.createElement('div');
                keyDetails.appendChild(valueDiv);
                var keyPath = currentPath ? currentPath + '.' + key : key;  // FIXED: String concat
                keyDetails.dataset.path = keyPath;
                renderJson(obj[key], valueDiv, keyPath);
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
        var currentLength = childrenDiv.querySelectorAll('details').length;  // var for compatibility
        const summary = arrayDetails.querySelector('summary');
        const rootPath = arrayDetails.dataset.path || '';
        items.forEach(function(item, index) {  // Use function()
            const globalIndex = currentLength + index;
            var itemPath = rootPath ? rootPath + '[' + globalIndex + ']' : '[' + globalIndex + ']';  // FIXED: String concat
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
            // FIXED: Use string concatenation for summary update
            summary.textContent = 'Array [' + newLen + ']';
        }
        if (expandedPaths.has(rootPath)) {
            arrayDetails.open = true;
        }
    }

    function loadFile(path) {
        selectedFile = path;
        vscode.setState({ selectedFile });
        vscode.postMessage({ command: 'loadFile', path: path });
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(function() {  // Use function() for compatibility
            if (selectedFile) vscode.postMessage({ command: 'loadFile', path: selectedFile });
        }, 50000);
    }

    window.addEventListener('DOMContentLoaded', function() {  // Use function()
        refreshFiles();
        document.addEventListener('toggle', function(e) {  // Use function()
            if (e.target instanceof HTMLDetailsElement) {
                const path = e.target.dataset.path || '';
                if (e.target.open) {
                    expandedPaths.add(path);
                } else {
                    expandedPaths.delete(path);
                }
            }
        }, true);

        const questionSelect = document.getElementById('questionSelect');
        const freeText = document.getElementById('freeText');
        if (questionSelect && freeText) {
            questionSelect.addEventListener('change', function() {
                freeText.value = questionSelect.options[questionSelect.selectedIndex].text;
            });
        }
        const analyzeBtn = document.getElementById('analyzeBtn');
        const textBlock = document.getElementById('textBlock');
        if (analyzeBtn && textBlock) {
            analyzeBtn.addEventListener('click', function() {
                if (!selectedFile) {
                    textBlock.textContent = "Please select a file first.";
                    return;
                }
                const prompt = freeText.value.trim();
                if (!prompt) {
                    textBlock.textContent = "Please enter a prompt.";
                    return;
                }
                textBlock.textContent = "Analyzing...";
                vscode.postMessage({ command: 'analyze', prompt: prompt, filePath: selectedFile });
            });
        }
    });

    window.addEventListener('message', function(event) {  // Use function()
        const message = event.data;
        switch (message.command) {
            case 'filesList':
                const fileListDiv = document.getElementById('fileList');
                fileListDiv.innerHTML = '<h3>Select a log directory and JSON file:</h3>';
                message.sessions.forEach(function(ses) {
                    const details = document.createElement('details');
                    details.open = true;
                    const summary = document.createElement('summary');
                    summary.textContent = ses.dir;
                    summary.style.fontWeight = 'bold';
                    details.appendChild(summary);
                    const filesDiv = document.createElement('div');
                    filesDiv.style.paddingLeft = '20px';
                    ses.files.forEach(function(file) {
                        const btn = document.createElement('button');
                        btn.textContent = file.name;
                        btn.onclick = function() { loadFile(file.path); };  // Use function()
                        btn.style.display = 'inline-block';
                        btn.style.marginRight = '5px';
                        btn.style.marginBottom = '5px';
                        filesDiv.appendChild(btn);
                    });
                    details.appendChild(filesDiv);
                    fileListDiv.appendChild(details);
                });
                break;
            case 'analysisResult':
                const textBlock = document.getElementById('textBlock');
                textBlock.textContent = message.result || "No result received.";
                break;
            case 'fileContent':
                const jsonTree = document.getElementById('jsonTree');
                var fileName = selectedFile ? selectedFile.split('/').pop() || selectedFile : 'Unknown file';  // var + concat
                // FIXED: Use string concatenation for heading
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

        
        <pre id="textBlock" style="width: 100%; padding: 8px; border: 1px solid var(--vscode-input-border); background-color: var(--vscode-input-background); color: var(--vscode-input-foreground); white-space: pre-wrap; overflow: auto; max-height: 400px;">
             
        </pre>
    </div>
</body>
</html>`;
}

// This method is called when your extension is activated
// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel("ADK Web");
    const agentOutput = vscode.window.createOutputChannel("Agent Configurator");

    // Initialize default state scaffolding
    if (!context.workspaceState.get('agentConfigurator.region')) {
        void context.workspaceState.update('agentConfigurator.region', 'us-central1');
    }
    if (!context.globalState.get('agentConfigurator.authMode')) {
        void context.globalState.update('agentConfigurator.authMode', 'None');
    }

    // Dynamic GCP status bar and auth management
    const gcpStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
    gcpStatus.text = 'GCP: Not Authenticated';
    gcpStatus.tooltip = 'Google Cloud authentication and project';
    gcpStatus.command = 'agentConfigurator.statusMenu';
    context.subscriptions.push(gcpStatus);
    gcpStatus.show();

    let currentAuth: AuthDetection | undefined;

    const postContextToWebview = (account?: string, project?: string) => {
        try {
            agentConfigProvider?.postMessage({ type: 'context', data: { account, project } });
        } catch (e) {
            agentOutput.appendLine(`[Context] Failed to post context: ${(e as Error).message}`);
        }
    };

    const formatStatus = (auth: AuthDetection, projectId?: string): string => {
        const projText = projectId && projectId.trim().length > 0 ? projectId.trim() : '(no project)';
        if (auth.mode === 'ServiceAccount') {
            const email = auth.account || 'Service Account';
            return `GCP: Service Account • ${email} • ${projText}`;
        }
        if (auth.mode === 'ADC') {
            const email = auth.account || 'User';
            return `GCP: ${email} • ${projText}`;
        }
        return 'GCP: Not Authenticated';
    };

    const refreshAuthAndStatus = async (initial = false) => {
        try {
            agentOutput.appendLine(`[Auth] Refreshing auth status${initial ? ' (on activate)' : ''}...`);
            const existingProject = (context.workspaceState.get('agentConfigurator.projectId') as string | undefined) || undefined;

            const detected = await detectAuth(existingProject);
            currentAuth = detected;

            // Persist auth mode
            await context.globalState.update('agentConfigurator.authMode', detected.mode);

            // Determine project to use
            let projectToUse = existingProject;
            if (initial) {
                projectToUse = detected.project?.trim() || existingProject;
                if (projectToUse !== existingProject) {
                    await context.workspaceState.update('agentConfigurator.projectId', projectToUse);
                }
            }
            // For subsequent refreshes, prefer workspace-state selection over gcloud default
            const preferredProject = (context.workspaceState.get('agentConfigurator.projectId') as string | undefined) || projectToUse;

            gcpStatus.text = formatStatus(detected, preferredProject);
            postContextToWebview(detected.account, preferredProject);
            agentOutput.appendLine(`[Auth] Mode=${detected.mode} Account=${detected.account ?? '-'} Project=${preferredProject ?? '-'}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            agentOutput.appendLine(`[Auth] Error refreshing auth: ${msg}`);
            gcpStatus.text = 'GCP: Not Authenticated';
            postContextToWebview(undefined, (context.workspaceState.get('agentConfigurator.projectId') as string | undefined));
        }
    };

    // Status bar QuickPick menu
    context.subscriptions.push(
        vscode.commands.registerCommand('agentConfigurator.statusMenu', async () => {
            const notAuth = !currentAuth || currentAuth.mode === 'None';
            const options = notAuth
                ? [
                    { label: 'Sign in (gcloud ADC)', action: 'login' as const }
                  ]
                : [
                    { label: 'Refresh status', action: 'refresh' as const },
                    { label: 'Switch project', action: 'switch' as const },
                    { label: 'Sign out', action: 'signout' as const }
                  ];
            const pick = await vscode.window.showQuickPick(options.map(o => o.label), { placeHolder: 'Google Cloud' });
            const chosen = options.find(o => o.label === pick);
            if (!chosen) { return; }
            switch (chosen.action) {
                case 'login':
                    await vscode.commands.executeCommand('agentConfigurator.gcloudLogin');
                    break;
                case 'refresh':
                    await vscode.commands.executeCommand('agentConfigurator.refreshAuthStatus');
                    break;
                case 'switch':
                    await vscode.commands.executeCommand('agentConfigurator.switchProject');
                    break;
                case 'signout':
                    await vscode.commands.executeCommand('agentConfigurator.signOut');
                    break;
            }
        })
    );

    // Verify any stored engine IDs against live list
    const verifyStoredEngines = async () => {
        try {
            const ws = context.workspaceState;
            const projectId = (ws.get('agentConfigurator.projectId') as string) || '';
            const region = (ws.get('agentConfigurator.region') as string) || 'us-central1';
        void region;
            const engineIds = (ws.get('agentConfigurator.engineIds') as Record<string, string>) || {};
            const names = Object.values(engineIds);
            if (!projectId || names.length === 0) {
                return;
            }
            const scriptPath = context.asAbsolutePath(path.join('src', 'python', 'list_agent_engines.py'));
            const env: NodeJS.ProcessEnv = {
                ...process.env,
                PYTHONPATH: [rootPath, process.env.PYTHONPATH || ''].filter(Boolean).join(path.delimiter),
            };
            const child = spawn('python3', [scriptPath, '--project', projectId, '--region', region], { cwd: rootPath, env });
            let out = '';
            let err = '';
            child.stdout.on('data', (d) => { out += d.toString(); });
            child.stderr.on('data', (d) => { err += d.toString(); });
            child.on('close', async (code) => {
                if (code !== 0) {
                    agentOutput.appendLine(`[Verify] list engines failed: ${err.trim()}`);
                    return;
                }
                try {
                    const arr = JSON.parse(out) as Array<{ name: string; displayName?: string }>;
                    const live = new Set(arr.map(e => e.name));
                    let changed = false;
                    for (const [k, v] of Object.entries(engineIds)) {
                        if (!live.has(v)) {
                            agentOutput.appendLine(`[Verify] Removing stale engineId for agent "${k}": ${v}`);
                            delete engineIds[k];
                            changed = true;
                        }
                    }
                    if (changed) {
                        await ws.update('agentConfigurator.engineIds', engineIds);
                    }
                    const active = (ws.get('agentConfigurator.activeAgent') as { name: string; path?: string } | undefined);
                    if (active?.name) {
                        const eid = engineIds[active.name];
                        const valid = eid ? live.has(eid) : false;
                        agentConfigProvider?.postMessage({ type: 'deploymentVerified', data: { engineIdValid: !!valid } });
                    }
                } catch (e) {
                    agentOutput.appendLine(`[Verify] Failed to parse engine list: ${(e as Error).message}`);
                }
            });
        } catch (e) {
            agentOutput.appendLine(`[Verify] Exception: ${(e as Error).message}`);
        }
    };

    // Initial detection
    void refreshAuthAndStatus(true);
    void verifyStoredEngines();// Register Agent Config webview view provider
    agentConfigProvider = new AgentConfigViewProvider(context, agentOutput);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(AgentConfigViewProvider.viewId, agentConfigProvider)
    );


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

    // Agent Configurator commands (stubs)
    const openAgentConfigCmd = vscode.commands.registerCommand('agentConfigurator.openAgentConfig', async (agent?: { name: string; path?: string }) => {
        if (agent && typeof agent.name === 'string') {
            void context.workspaceState.update('agentConfigurator.activeAgent', agent);
        }
        await vscode.commands.executeCommand('workbench.view.extension.agentConfigurator');
        await vscode.commands.executeCommand('agentConfigurator.config.focus');

        if (agentConfigProvider) {
            const ws = context.workspaceState;
            const active = (ws.get('agentConfigurator.activeAgent') as { name: string; path?: string } | undefined) ?? agent ?? { name: '', path: undefined };
            const name = active?.name || '';
            const configs = (ws.get('agentConfigurator.agentConfigs') as Record<string, { name: string; description: string; model: string }>) || {};
            const engineIds = (ws.get('agentConfigurator.engineIds') as Record<string, string>) || {};
            const projectId = (ws.get('agentConfigurator.projectId') as string) || '';
            const region = (ws.get('agentConfigurator.region') as string) || 'us-central1';
        void region;
            const cfg = (name && configs[name]) || { name, description: '', model: 'gemini-2.0' };
            const engineId = name ? engineIds[name] : undefined;

            agentConfigProvider.postMessage({
                type: 'init',
                data: {
                    ...cfg,
                    engineId,
                    memory: { attached: !!engineId },
                    a2a: { hasCard: false, skillsCount: 0 },
                    projectId,
                    region,
                    account: (currentAuth?.account) || undefined,
                    project: projectId || undefined
                }
            });
        }
    });
    context.subscriptions.push(openAgentConfigCmd);

    const deployCmd = vscode.commands.registerCommand('agentConfigurator.deployAgent', async () => {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, cancellable: true, title: 'Deploying agent to Vertex AI Agent Engine…' },
            async (_progress, token) => {
                try {
                    const ws = context.workspaceState;
                    const active = ws.get('agentConfigurator.activeAgent') as { name: string; path?: string } | undefined;
                    if (!active?.name) {
                        void vscode.window.showErrorMessage('No active agent selected.');
                        return;
                    }

                    // Resolve module/symbol
                    const moduleSymbols = (ws.get('agentConfigurator.moduleSymbols') as Record<string, { module: string; symbol: string }>) || {};
                    let modulePath = moduleSymbols[active.name]?.module;
                    let symbol = (moduleSymbols[active.name]?.symbol || 'agent').trim();

                    const ensureModuleFromPath = () => {
                        if (modulePath && modulePath.trim()) return;
                        const fp = active.path;
                        if (fp) {
                            const abs = path.isAbsolute(fp) ? fp : path.join(rootPath, fp);
                            let rel = path.relative(rootPath, abs).replace(/\\/g, '/');
                            if (rel.toLowerCase().endsWith('.py')) {
                                rel = rel.slice(0, -3);
                            }
                            modulePath = rel.replace(/\//g, '.');
                        }
                    };
                    ensureModuleFromPath();

                    // Resolve project/region/bucket
                    let projectId = (ws.get('agentConfigurator.projectId') as string) || '';
                    if (!projectId) {
                        projectId = (await vscode.window.showInputBox({
                            prompt: 'Enter GCP Project ID',
                            ignoreFocusOut: true,
                            validateInput: (v) => v.trim() ? undefined : 'Project ID required',
                        })) || '';
                        if (!projectId) { return; }
                        await ws.update('agentConfigurator.projectId', projectId);
                    }
                    let region = (ws.get('agentConfigurator.region') as string) || 'us-central1';
                    if (!region) {
                        region = (await vscode.window.showInputBox({
                            prompt: 'Enter region (e.g. us-central1)',
                            value: 'us-central1',
                            ignoreFocusOut: true,
                        })) || 'us-central1';
                        await ws.update('agentConfigurator.region', region);
                    }
                    let bucket = (ws.get('agentConfigurator.bucket') as string) || '';
                    if (!bucket) {
                        bucket = (await vscode.window.showInputBox({
                            prompt: 'Enter GCS staging bucket (gs://bucket)',
                            placeHolder: 'gs://my-staging-bucket',
                            ignoreFocusOut: true,
                            validateInput: (v) => v.startsWith('gs://') ? undefined : 'Must start with gs://',
                        })) || '';
                        if (!bucket) { return; }
                        await ws.update('agentConfigurator.bucket', bucket);
                    }

                    if (!modulePath || !modulePath.trim()) {
                        modulePath = await vscode.window.showInputBox({
                            prompt: 'Enter Python module path for the agent (e.g. pkg.agent)',
                            ignoreFocusOut: true,
                            validateInput: (v) => v.trim() ? undefined : 'Module path required',
                        }) || '';
                        if (!modulePath) { return; }
                    }
                    if (!symbol || !symbol.trim()) {
                        symbol = await vscode.window.showInputBox({
                            prompt: 'Enter agent symbol (callable or object)',
                            value: 'agent',
                            ignoreFocusOut: true,
                        }) || 'agent';
                    }

                    const engineIds = (ws.get('agentConfigurator.engineIds') as Record<string, string>) || {};
                    const prevEngine = engineIds[active.name];

                    const scriptPath = context.asAbsolutePath(path.join('src', 'python', 'deploy_agent_engine.py'));
                    const args = [
                        scriptPath,
                        '--project', projectId,
                        '--region', region,
                        '--staging-bucket', bucket,
                        '--module', modulePath,
                        '--symbol', symbol,
                    ];
                    if (prevEngine) {
                        args.push('--engine-id', prevEngine);
                    }

                    const env: NodeJS.ProcessEnv = {
                        ...process.env,
                        PYTHONPATH: [rootPath, process.env.PYTHONPATH || ''].filter(Boolean).join(path.delimiter),
                    };

                    agentOutput.appendLine(`[Deploy] Spawning python3 ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
                    const child = spawn('python3', args, { cwd: rootPath, env });

                    token.onCancellationRequested(() => {
                        try { child.kill(); } catch { /* noop */ }
                    });

                    let stderrBuf = '';
                    let engineId: string | undefined;

                    child.stdout.on('data', (data) => {
                        const text = data.toString();
                        
                        agentOutput.appendLine(text.trim());
                        const m = text.match(/ENGINE_ID:\s*(.+)\s*$/m);
                        if (m) {
                            engineId = m[1].trim();
                        }
                    });
                    child.stderr.on('data', (data) => {
                        const text = data.toString();
                        stderrBuf += text;
                        agentOutput.appendLine(text.trim());
                    });

                    const exitCode: number = await new Promise((resolve) => child.on('close', resolve));
                    if (exitCode === 0 && engineId) {
                        engineIds[active.name] = engineId;
                        await ws.update('agentConfigurator.engineIds', engineIds);

                        // Persist the resolved module/symbol for future deploys
                        const msKey = 'agentConfigurator.moduleSymbols';
                        const existing = (ws.get(msKey) as Record<string, { module: string; symbol: string }>) || {};
                        existing[active.name] = { module: modulePath, symbol };
                        await ws.update(msKey, existing);

                        agentConfigProvider?.postMessage({ type: 'deploymentComplete', data: { engineId } });
                        void vscode.window.showInformationMessage(`Agent deployed: ${engineId}`);
                    } else {
                        // If import error, offer override for module/symbol and suggest retry
                        if (stderrBuf.toLowerCase().includes('no module named') || stderrBuf.toLowerCase().includes('symbol') || stderrBuf.toLowerCase().includes('attributeerror')) {
                            const choice = await vscode.window.showWarningMessage('Deploy failed importing module/symbol. Configure module and symbol?', 'Configure');
                            if (choice === 'Configure') {
                                const newModule = await vscode.window.showInputBox({ prompt: 'Python module path (e.g. pkg.agent)', value: modulePath, ignoreFocusOut: true }) || modulePath;
                                const newSymbol = await vscode.window.showInputBox({ prompt: 'Agent symbol', value: symbol, ignoreFocusOut: true }) || symbol;
                                const msKey = 'agentConfigurator.moduleSymbols';
                                const existing = (ws.get(msKey) as Record<string, { module: string; symbol: string }>) || {};
                                existing[active.name] = { module: newModule, symbol: newSymbol };
                                await ws.update(msKey, existing);
                                void vscode.window.showInformationMessage('Module/symbol saved. Run Deploy again.');
                            }
                        }
                        void vscode.window.showErrorMessage('Deployment failed. See "Agent Configurator" output for details.');
                    }
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    agentOutput.appendLine(`[Deploy] Error: ${msg}`);
                    void vscode.window.showErrorMessage(`Deploy failed: ${msg}`);
                }
            }
        );
    });
    context.subscriptions.push(deployCmd);

    const stopCmd = vscode.commands.registerCommand('agentConfigurator.stopAgent', async () => {
        try {
            const ws = context.workspaceState;
            const active = ws.get('agentConfigurator.activeAgent') as { name: string; path?: string } | undefined;
            if (!active?.name) {
                void vscode.window.showInformationMessage('No active agent selected.');
                return;
            }
            const engineIds = (ws.get('agentConfigurator.engineIds') as Record<string, string>) || {};
            const engineId = engineIds[active.name];
            if (!engineId) {
                void vscode.window.showInformationMessage('Agent is not deployed.');
                return;
            }
            const confirm = await vscode.window.showWarningMessage(`Delete Agent Engine?\n${engineId}`, { modal: true }, 'Yes');
            if (confirm !== 'Yes') { return; }

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, cancellable: true, title: 'Stopping agent (deleting Engine)…' },
                async (_p, token) => {
                    const projectId = (ws.get('agentConfigurator.projectId') as string) || '';
                    const region = (ws.get('agentConfigurator.region') as string) || 'us-central1';
        void region;
                    const scriptPath = context.asAbsolutePath(path.join('src', 'python', 'delete_agent_engine.py'));
                    const args = [scriptPath, '--project', projectId, '--region', region, '--engine-id', engineId, '--force', 'true'];

                    const env: NodeJS.ProcessEnv = {
                        ...process.env,
                        PYTHONPATH: [rootPath, process.env.PYTHONPATH || ''].filter(Boolean).join(path.delimiter),
                    };

                    agentOutput.appendLine(`[Stop] Spawning python3 ${args.join(' ')}`);
                    const child = spawn('python3', args, { cwd: rootPath, env });
                    token.onCancellationRequested(() => { try { child.kill(); } catch { /* noop */ } });

                    let stderrBuf = '';
                    child.stdout.on('data', (d) => agentOutput.appendLine(d.toString().trim()));
                    child.stderr.on('data', (d) => { stderrBuf += d.toString(); agentOutput.appendLine(d.toString().trim()); });

                    const code: number = await new Promise(resolve => child.on('close', resolve));
                    if (code === 0) {
                        delete engineIds[active.name];
                        await ws.update('agentConfigurator.engineIds', engineIds);
                        agentConfigProvider?.postMessage({ type: 'stopped', data: { engineIdCleared: true } });
                        void vscode.window.showInformationMessage('Agent Engine deleted.');
                    } else {
                        void vscode.window.showErrorMessage('Failed to delete Agent Engine. See "Agent Configurator" output for details.');
                        if (stderrBuf.trim()) {
                            agentOutput.appendLine(`[Stop] Error: ${stderrBuf.trim()}`);
                        }
                    }
                }
            );
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            agentOutput.appendLine(`[Stop] Error: ${msg}`);
            void vscode.window.showErrorMessage(`Stop failed: ${msg}`);
        }
    });
    context.subscriptions.push(stopCmd);

    const genCardCmd = vscode.commands.registerCommand('agentConfigurator.generateAgentCard', async () => {
        try {
            const res = await generateAgentCard(context);
            agentOutput.appendLine(`[A2A] Agent card written to: ${res.filePath}`);
            void vscode.window.showInformationMessage('Agent Card generated.');
            agentConfigProvider?.postMessage({ type: 'a2aUpdated', data: { hasCard: true, skillsCount: res.skillsCount } });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            agentOutput.appendLine(`[A2A] Generate failed: ${msg}`);
            void vscode.window.showErrorMessage(`Failed to generate Agent Card: ${msg}`);
        }
    });
    context.subscriptions.push(genCardCmd);

    const checkCompatCmd = vscode.commands.registerCommand('agentConfigurator.checkCompatibility', async () => {
        try {
            const res = await checkA2A(context);
            agentOutput.appendLine(`[A2A] Card present=${res.hasCard} skills=${res.skillsCount}`);
            agentConfigProvider?.postMessage({ type: 'a2aUpdated', data: { hasCard: res.hasCard, skillsCount: res.skillsCount } });
            void vscode.window.showInformationMessage(res.hasCard ? 'Agent Card found.' : 'Agent Card not found.');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            agentOutput.appendLine(`[A2A] Check failed: ${msg}`);
            void vscode.window.showErrorMessage(`A2A check failed: ${msg}`);
        }
    });
    context.subscriptions.push(checkCompatCmd);

    const attachMemCmd = vscode.commands.registerCommand('agentConfigurator.attachMemory', async () => {
        try {
            const ws = context.workspaceState;
            const active = ws.get('agentConfigurator.activeAgent') as { name: string; path?: string } | undefined;
            if (!active?.name) {
                void vscode.window.showInformationMessage('No active agent selected.');
                return;
            }
            const projectId = (ws.get('agentConfigurator.projectId') as string) || '';
            const region = (ws.get('agentConfigurator.region') as string) || 'us-central1';
        void region;
            if (!projectId) {
                void vscode.window.showWarningMessage('Set a GCP project before attaching an engine.');
                return;
            }
            const scriptPath = context.asAbsolutePath(path.join('src', 'python', 'list_agent_engines.py'));
            const env: NodeJS.ProcessEnv = {
                ...process.env,
                PYTHONPATH: [rootPath, process.env.PYTHONPATH || ''].filter(Boolean).join(path.delimiter),
            };
            const child = spawn('python3', [scriptPath, '--project', projectId, '--region', region], { cwd: rootPath, env });
            let out = '';
            let err = '';
            child.stdout.on('data', (d) => { out += d.toString(); });
            child.stderr.on('data', (d) => { err += d.toString(); });
            child.on('close', async (code) => {
                if (code !== 0) {
                    agentOutput.appendLine(`[Memory] list engines failed: ${err.trim()}`);
                    void vscode.window.showErrorMessage('Failed to list engines.');
                    return;
                }
                try {
                    const arr = JSON.parse(out) as Array<{ name: string; displayName?: string }>;
                    if (arr.length === 0) {
                        void vscode.window.showInformationMessage('No Agent Engines found in this project/region.');
                        return;
                    }
                    const items = arr.map(e => ({ label: e.displayName || e.name, description: e.name, value: e.name }));
                    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select an Agent Engine to attach' });
                    if (!pick) { return; }
                    const engineIds = (ws.get('agentConfigurator.engineIds') as Record<string, string>) || {};
                    engineIds[active.name] = pick.value;
                    await ws.update('agentConfigurator.engineIds', engineIds);
                    agentConfigProvider?.postMessage({ type: 'engineLinked', data: { engineId: pick.value } });
                    void vscode.window.showInformationMessage(`Attached engine: ${pick.value}`);
                } catch (e) {
                    agentOutput.appendLine(`[Memory] Parse failed: ${(e as Error).message}`);
                    void vscode.window.showErrorMessage('Failed to parse engine list.');
                }
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            agentOutput.appendLine(`[Memory] Attach error: ${msg}`);
        }
    });
    context.subscriptions.push(attachMemCmd);

    const openMemCmd = vscode.commands.registerCommand('agentConfigurator.openMemoryConsole', async () => {
        const ws = context.workspaceState;
        const active = ws.get('agentConfigurator.activeAgent') as { name: string; path?: string } | undefined;
        const projectId = (ws.get('agentConfigurator.projectId') as string) || '';
        const region = (ws.get('agentConfigurator.region') as string) || 'us-central1';
        void region;
        const engineIds = (ws.get('agentConfigurator.engineIds') as Record<string, string>) || {};
        const engineId = active?.name ? engineIds[active.name] : undefined;

        let url = `https://console.cloud.google.com/vertex-ai/agent-engines?project=${encodeURIComponent(projectId)}`;
        if (engineId) {
            url = `https://console.cloud.google.com/vertex-ai/agent-engines/instances/${encodeURIComponent(engineId)}?project=${encodeURIComponent(projectId)}`;
        }
        await vscode.env.openExternal(vscode.Uri.parse(url));
    });
    context.subscriptions.push(openMemCmd);

    const switchProjectCmd = vscode.commands.registerCommand('agentConfigurator.switchProject', async () => {
        try {
            agentOutput.appendLine('[Project] Switch project requested.');
            const projects = await listProjects();
            let selected: string | undefined;
            if (projects.length === 0) {
                agentOutput.appendLine('[Project] No projects from gcloud. Prompting manual entry.');
                selected = await vscode.window.showInputBox({
                    prompt: 'Enter GCP Project ID',
                    ignoreFocusOut: true,
                    validateInput: (v) => v.trim() ? undefined : 'Project ID required'
                });
            } else {
                const pick = await vscode.window.showQuickPick(projects.map(p => p.id), { placeHolder: 'Select a GCP Project' });
                selected = pick;
            }
            if (!selected) {
                return;
            }
            await context.workspaceState.update('agentConfigurator.projectId', selected);
            agentOutput.appendLine(`[Project] Active project set to ${selected}`);
            // Update status and webview immediately
            if (currentAuth) {
                gcpStatus.text = formatStatus(currentAuth, selected);
            }
            postContextToWebview(currentAuth?.account, selected);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            agentOutput.appendLine(`[Project] Error switching project: ${msg}`);
            vscode.window.showErrorMessage(`Failed to switch project: ${msg}`);
        }
    });
    context.subscriptions.push(switchProjectCmd);

    const loginCmd = vscode.commands.registerCommand('agentConfigurator.gcloudLogin', () => {
        agentOutput.appendLine('[Auth] Opening gcloud ADC login in terminal...');
        const term = vscode.window.createTerminal({ name: 'GCloud Auth' });
        term.sendText('gcloud auth application-default login');
        term.show();
    });
    context.subscriptions.push(loginCmd);

    const signOutCmd = vscode.commands.registerCommand('agentConfigurator.signOut', async () => {
        agentOutput.appendLine('[Auth] Revoking ADC via gcloud...');
        try {
            exec('gcloud auth application-default revoke', { timeout: 10000 }, async (error, stdout, stderr) => {
                if (stdout?.trim()) {
                    agentOutput.appendLine(`[Auth] gcloud stdout: ${stdout.trim()}`);
                }
                if (stderr?.trim()) {
                    agentOutput.appendLine(`[Auth] gcloud stderr: ${stderr.trim()}`);
                }
                if (error) {
                    agentOutput.appendLine(`[Auth] Revoke failed: ${(error as Error).message}`);
                    void vscode.window.showErrorMessage('Failed to sign out (revoke ADC). See "Agent Configurator" output for details.');
                } else {
                    agentOutput.appendLine('[Auth] ADC revoked successfully.');
                }
                // Refresh regardless of success to update UI
                await vscode.commands.executeCommand('agentConfigurator.refreshAuthStatus');
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            agentOutput.appendLine(`[Auth] Exception during revoke: ${msg}`);
            await vscode.commands.executeCommand('agentConfigurator.refreshAuthStatus');
        }
    });
    context.subscriptions.push(signOutCmd);

    const refreshAuthCmd = vscode.commands.registerCommand('agentConfigurator.refreshAuthStatus', async () => {
        await refreshAuthAndStatus(false);
    });
    context.subscriptions.push(refreshAuthCmd);

    const disposable = vscode.commands.registerCommand('agent-inspector.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from AgentDesigner!');
    });
    context.subscriptions.push(disposable);
    const sayHelloCommand = vscode.commands.registerCommand('agent-inspector.sayHello', () => {
        vscode.window.showInformationMessage('Hello');
    });
    context.subscriptions.push(sayHelloCommand);
    const addToolCommand = vscode.commands.registerCommand('agent-inspector.addTool', async (item?: { filePath?: string }) => {
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
    const addAgentCommand = vscode.commands.registerCommand('agent-inspector.addAgentTool', async (item?: { filePath?: string }) => {
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
                    } catch (e: unknown) {
                        const msg = e instanceof Error ? e.message : String(e);
                        vscode.window.showErrorMessage(`Error stopping ADK Web process: ${msg}`);
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

    // Create status bar item for viewing logs
    const logsStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    logsStatusBarItem.command = 'agent-inspector.viewLogsWebview';
    logsStatusBarItem.text = '$(eye) View Logs';
    logsStatusBarItem.tooltip = 'Open the Logs JSON Viewer';
    context.subscriptions.push(logsStatusBarItem);
    logsStatusBarItem.show();

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
                            const isArray = Array.isArray(jsonObj);

                            const isSwitchOrFresh = filePath !== currentSelectedFile || currentSelectedFile === null;

                            if (isSwitchOrFresh) {
                                // Always send full content on switch or first load (updates tree + heading)
                                currentSelectedFile = filePath;
                                logsPanel?.webview.postMessage({ command: 'fileContent', content: jsonObj });
                                if (isArray) {
                                    fileLastLengths.set(filePath, jsonObj.length);
                                }
                            } else {
                                // Poll for same file: append if grown (arrays only); reload full otherwise
                                if (!isArray) {
                                    // Non-arrays: always reload full (in case content changed)
                                    logsPanel?.webview.postMessage({ command: 'fileContent', content: jsonObj });
                                } else {
                                    const lastLength = fileLastLengths.get(filePath) || 0;
                                    if (jsonObj.length > lastLength) {
                                        const newItems = jsonObj.slice(lastLength);
                                        logsPanel?.webview.postMessage({ command: 'append', items: newItems });
                                        fileLastLengths.set(filePath, jsonObj.length);
                                    }
                                    // Else: up-to-date, do nothing (tree stays as-is)
                                }
                            }
                        } catch (err) {
                            console.error('Error reading file:', err);
                            logsPanel?.webview.postMessage({ command: 'error', text: `Failed to load file ${message.path}: ${(err as Error).message}` });
                        }
                        break;
                    case 'analyze':
                        try {
                            outputChannel.show(true);
                            const prompt = message.prompt;
                            const filePath = message.filePath;
                            outputChannel.appendLine(`Starting AI analysis for file: ${filePath}`);
                            outputChannel.appendLine(`Prompt: ${prompt}`);
                            if (!prompt || !filePath) {
                                outputChannel.appendLine('Error: Missing prompt or filePath.');
                                logsPanel?.webview.postMessage({ command: 'error', text: 'Missing prompt or filePath.' });
                                break;
                            }
                            const envPath = path.join(rootPath, '.env');
                            const envConfig = dotenv.parse(fs.readFileSync(envPath));
                            const spawnEnv = { ...process.env };
                            for (const [key, value] of Object.entries(envConfig)) {
                                spawnEnv[key] = value;
                            }
                            const pythonPath = 'python3';
                            const scriptPath = 'src/gemini_utils.py';
                            const fullFilePath = path.join(rootPath, filePath);
                            outputChannel.appendLine(`Spawning: ${pythonPath} ${scriptPath} "${prompt}" "${fullFilePath}"`);
                            const child = spawn(pythonPath, [scriptPath, prompt, fullFilePath], { cwd: context.extensionPath, stdio: ['pipe', 'pipe', 'pipe'], env: spawnEnv });
                            let result = '';
                            let errorOutput = '';
                            child.stdout.on('data', (data) => {
                                const chunk = data.toString();
                                result += chunk;
                                outputChannel.appendLine(`Python stdout: ${chunk.trim()}`);
                            });
                            child.stderr.on('data', (data) => {
                                const chunk = data.toString();
                                errorOutput += chunk;
                                outputChannel.appendLine(`Python stderr: ${chunk.trim()}`);
                            });
                            child.on('close', (code) => {
                                outputChannel.appendLine(`Python process exited with code: ${code}`);
                                if (code === 0) {
                                    logsPanel?.webview.postMessage({ command: 'analysisResult', result: result.trim() });
                                    outputChannel.appendLine('Analysis completed successfully.');
                                } else {
                                    console.error('Python error:', errorOutput);
                                    logsPanel?.webview.postMessage({ command: 'error', text: `Analysis failed: ${errorOutput.trim()}` });
                                    outputChannel.appendLine(`Analysis failed with error: ${errorOutput.trim()}`);
                                }
                            });
                        } catch (err) {
                            console.error('Error spawning python:', err);
                            outputChannel.appendLine(`Error spawning python: ${(err as Error).message}`);
                            logsPanel?.webview.postMessage({ command: 'error', text: `Failed to run analysis: ${(err as Error).message}` });
                        }
                        break;
                }
            }, undefined, context.subscriptions);

            logsPanel.onDidDispose(() => {
                logsPanel = undefined;
                currentSelectedFile = null;  // NEW: Reset on close/restart
            }, undefined, context.subscriptions);
        }
    });
    context.subscriptions.push(viewLogsWebviewCommand);
}


// This method is called when your extension is deactivated
export function deactivate() { }
