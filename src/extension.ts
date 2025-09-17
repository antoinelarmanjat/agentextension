import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { findAnyAgentLocation } from './agent-finder';
import { findToolLocation } from './agent-finder';
import { AgentTreeDataProvider } from './agent-tree-provider';
import { AgentConfigViewProvider } from './agent-config-view';
import { AgentConfigPanel } from './agent-config-panel';
import { spawn, ChildProcess } from 'child_process';
import * as dotenv from 'dotenv';
import { exec } from 'child_process';
import { detectAuth, listProjects, type AuthDetection, getGcloudAdcPath, getGcloudAdcDirPath } from './auth-manager';
import { generateAgentCard, checkA2A } from './a2a-manager';


 
const fileLastLengths: Map<string, number> = new Map();
let currentSelectedFile: string | null = null;  // NEW: Track currently viewed file

let adkProcess: (ChildProcess | vscode.Terminal) | null = null;
let agentConfigProvider: AgentConfigViewProvider | undefined;

// Python dependency installation guard state
let pythonInstallInProgress = false;
let pythonSetupTerminal: vscode.Terminal | undefined;
const SETUP_TERMINAL_NAME = 'Agent Configurator: Python Setup';
const PY_INSTALL_KEY = 'agentConfigurator.pythonInstallInProgress';

type PendingAction = { kind: 'deploy' | 'attachMemory' | 'stop' | 'verify' };
let pendingAction: PendingAction | null = null;
function setPendingAction(kind: PendingAction['kind']) { pendingAction = { kind }; }
function clearPendingAction() { pendingAction = null; }
async function resumePendingAction(): Promise<void> {
    const act = pendingAction; if (!act) return; clearPendingAction();
    switch (act.kind) {
        case 'deploy': await vscode.commands.executeCommand('agentConfigurator.deployAgent'); break;
        case 'attachMemory': await vscode.commands.executeCommand('agentConfigurator.attachMemory'); break;
        case 'stop': await vscode.commands.executeCommand('agentConfigurator.stopAgent'); break;
        case 'verify': await vscode.commands.executeCommand('agentConfigurator.verifyPython'); break;
    }
}

// Auth auto-refresh constants and runtime state
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_MS = 90_000;
const ADC_WATCH_DEBOUNCE_MS = 500;

let loginTerminal: vscode.Terminal | undefined;
const debounceTimers = new Map<string, NodeJS.Timeout>();
let adcWatcher: fs.FSWatcher | undefined;

// Spinner state for login waiting UI
let isWaitingForSignIn = false;

// AuthRefreshCoordinator: dir watcher + stat-based fallback polling
const AuthRefreshCoordinator = (() => {
    let dirWatcher: fs.FSWatcher | undefined;
    let statTimer: NodeJS.Timeout | undefined;
    let lastSeenMtimeMs: number | undefined;
    let onRefresh: ((reason: string) => Promise<void>) | undefined;
    let out: vscode.OutputChannel | undefined;

    function init(context: vscode.ExtensionContext, refreshFn: (reason: string) => Promise<void>, output: vscode.OutputChannel) {
        onRefresh = refreshFn;
        out = output;
        try {
            const dir = getGcloudAdcDirPath();
            if (fs.existsSync(dir)) {
                try {
                    if (dirWatcher) { try { dirWatcher.close(); } catch { /* noop */ } dirWatcher = undefined; }
                    dirWatcher = fs.watch(dir, { persistent: false }, (event, filename) => {
                        try {
                            if ((event === 'rename' || event === 'change') && filename === 'application_default_credentials.json') {
                                debounceKey('adc-dir', () => { void onRefresh?.('adc-dir-watch'); }, ADC_WATCH_DEBOUNCE_MS);
                            }
                        } catch {
                            // ignore single event errors
                        }
                    });
                    context.subscriptions.push({
                        dispose: () => { try { dirWatcher?.close(); } catch { /* noop */ } dirWatcher = undefined; }
                    });
                    out.appendLine(`[Auth] ADC dir watcher active: ${dir}`);
                } catch (e) {
                    out.appendLine(`[Auth] Warning: fs.watch failed for ADC dir: ${(e as Error).message}`);
                }
            }
        } catch (e) {
            out?.appendLine(`[Auth] Warning: ADC dir watch setup exception: ${(e as Error).message}`);
        }
    }

    function startStatPoll() {
        const adcPath = getGcloudAdcPath();
        if (statTimer) { clearInterval(statTimer); statTimer = undefined; }
        lastSeenMtimeMs = undefined;
        try {
            const st = fs.statSync(adcPath);
            lastSeenMtimeMs = st.mtimeMs;
        } catch {
            lastSeenMtimeMs = undefined;
        }
        const deadline = Date.now() + MAX_POLL_MS;
        statTimer = setInterval(() => {
            fs.stat(adcPath, (err, st) => {
                if (!err && st) {
                    const m = st.mtimeMs;
                    const changed = typeof lastSeenMtimeMs !== 'number' || m !== lastSeenMtimeMs;
                    if (changed) {
                        lastSeenMtimeMs = m;
                        if (statTimer) { clearInterval(statTimer); statTimer = undefined; }
                        debounceKey('adc-stat', () => { void onRefresh?.('adc-stat-poll'); }, 50);
                        return;
                    }
                }
                if (Date.now() >= deadline) {
                    if (statTimer) { clearInterval(statTimer); statTimer = undefined; }
                }
            });
        }, POLL_INTERVAL_MS);
    }

    function dispose() {
        try { dirWatcher?.close(); } catch { /* noop */ }
        dirWatcher = undefined;
        if (statTimer) { clearInterval(statTimer); statTimer = undefined; }
    }

    return { init, startStatPoll, dispose };
})();

function debounceKey(key: string, fn: () => void, delay: number) {
    const prev = debounceTimers.get(key);
    if (prev) {
        clearTimeout(prev);
    }
    const t = setTimeout(() => {
        debounceTimers.delete(key);
        try { fn(); } catch { /* noop */ }
    }, delay);
    debounceTimers.set(key, t);
}

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

    // Rehydrate persisted python install sentinel and reconcile with live terminals
    try {
        const persistedInstalling = context.globalState.get<boolean>(PY_INSTALL_KEY) === true;
        const existingSetup = vscode.window.terminals.find(t => t.name === SETUP_TERMINAL_NAME);
        if (persistedInstalling) {
            if (existingSetup) {
                pythonInstallInProgress = true;
                pythonSetupTerminal = existingSetup;
                agentOutput.appendLine('[Python] Install-in-progress detected (persisted). Guard is active until setup terminal closes.');
            } else {
                void context.globalState.update(PY_INSTALL_KEY, false);
                pythonInstallInProgress = false;
                agentOutput.appendLine('[Python] Cleared stale install-in-progress sentinel.');
            }
        }
    } catch { /* noop */ }

// Python environment helpers: interpreter discovery, availability, dependency checks, and guided install
async function getPythonPath(): Promise<string> {
    try {
        const cfg = vscode.workspace.getConfiguration();
        const inspected = cfg.inspect<string>('agentConfigurator.pythonPath');
        const explicit = (inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue) as string | undefined;
        const explicitTrimmed = (explicit ?? '').trim();
        if (explicitTrimmed) {
            return explicitTrimmed;
        }

        // Auto-detect common virtualenv interpreters
        const wsFolder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
            ? vscode.workspace.workspaceFolders[0].uri.fsPath
            : undefined;

        if (wsFolder) {
            const candidates: string[] = [];
            if (process.platform === 'win32') {
                candidates.push(path.join(wsFolder, '.venv', 'Scripts', 'python.exe'));
                candidates.push(path.join(wsFolder, 'venv', 'Scripts', 'python.exe'));
            } else {
                candidates.push(path.join(wsFolder, '.venv', 'bin', 'python'));
                candidates.push(path.join(wsFolder, 'venv', 'bin', 'python'));
            }
            const detected = candidates.find(p => {
                try { return fs.existsSync(p); } catch { return false; }
            });
            if (detected) {
                try { agentOutput.appendLine(`[Python] Using detected venv interpreter: ${detected}`); } catch { /* noop */ }
                const toastKey = 'agentConfigurator.venvDetectedNotified';
                const shown = context.globalState.get<boolean>(toastKey) === true;
                if (!shown) {
                    void context.globalState.update(toastKey, true);
                    void vscode.window.showInformationMessage(`Using detected interpreter: ${detected}. You can change it in Settings: agentConfigurator.pythonPath.`);
                }
                return detected;
            }
        }

        return 'python3';
    } catch {
        return 'python3';
    }
}

async function checkPythonAvailable(pythonPath: string): Promise<boolean> {
    return new Promise((resolve) => {
        exec(`${pythonPath} -c "import sys; print(sys.version)"`, { timeout: 10000 }, (error) => {
            resolve(!error);
        });
    });
}

async function checkPythonDeps(pythonPath: string): Promise<{ ok: boolean; reason?: string }> {
    return new Promise((resolve) => {
        // Check for required packages - google-cloud-aiplatform with agent_engines and adk extras
        // We check for the base packages that should be available with these extras
        const cmd = `${pythonPath} -c "import google.cloud.aiplatform; import vertexai; import google.adk"`;
        exec(cmd, { timeout: 20000 }, (error) => {
            if (!error) {
                resolve({ ok: true });
            } else {
                resolve({ ok: false, reason: 'missing_deps' });
            }
        });
    });
}

// Types and helpers for non-interactive installation
type InstallOpts = {
    useVenv: boolean;
    pythonPath: string;
    workspaceRoot: string;
    output: vscode.OutputChannel;
};

/**
 * Promise-based spawn wrapper with output piped to the provided OutputChannel.
 * Returns exit code and captured stdio. Does not use a shell; args are passed as-is.
 */
function runCommand(
    cmd: string,
    args: string[],
    opts: { cwd?: string; env?: NodeJS.ProcessEnv; output?: vscode.OutputChannel; label?: string } = {}
): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        try {
            const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, shell: false });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (d: Buffer) => {
                const text = d.toString('utf8');
                stdout += text;
                try { opts.output?.appendLine(text.trimEnd()); } catch { /* noop */ }
            });
            child.stderr.on('data', (d: Buffer) => {
                const text = d.toString('utf8');
                stderr += text;
                try { opts.output?.appendLine(text.trimEnd()); } catch { /* noop */ }
            });
            child.on('close', (code) => {
                resolve({ code: typeof code === 'number' ? code : -1, stdout, stderr });
            });
            child.on('error', (err) => {
                try { opts.output?.appendLine(`[runCommand] Failed to spawn ${cmd}: ${(err as Error).message}`); } catch { /* noop */ }
                resolve({ code: -1, stdout, stderr: (err as Error).message });
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            try { opts.output?.appendLine(`[runCommand] Exception for ${cmd}: ${msg}`); } catch { /* noop */ }
            resolve({ code: -1, stdout: '', stderr: msg });
        }
    });
}

/**
 * Non-interactive installer for Python deps with auto-resume on success.
 * Sets and clears the same sentinels used by the terminal-based flow.
 */
async function installDepsNonInteractive(opts: InstallOpts): Promise<boolean> {
    const { useVenv, pythonPath, workspaceRoot, output } = opts;

    // Set install sentinel immediately (memory + global)
    try {
        pythonInstallInProgress = true;
        await context.globalState.update(PY_INSTALL_KEY, true);
    } catch {
        pythonInstallInProgress = true;
    }

    try {
        let resolvedPy = pythonPath;
        let venvPy = '';

        if (useVenv) {
            venvPy = process.platform === 'win32'
                ? path.join(workspaceRoot, '.venv', 'Scripts', 'python.exe')
                : path.join(workspaceRoot, '.venv', 'bin', 'python');

            // Create .venv if interpreter missing
            let venvExists = false;
            try { venvExists = fs.existsSync(venvPy); } catch { venvExists = false; }

            if (!venvExists) {
                output.appendLine('[Python] Creating workspace .venv (non-interactive)…');
                if (process.platform === 'win32') {
                    let res = await runCommand('py', ['-3', '-m', 'venv', '.venv'], { cwd: workspaceRoot, output });
                    if (res.code !== 0) {
                        res = await runCommand('python', ['-m', 'venv', '.venv'], { cwd: workspaceRoot, output });
                        if (res.code !== 0) { throw new Error('Failed to create .venv'); }
                    }
                } else {
                    let res = await runCommand('python3', ['-m', 'venv', '.venv'], { cwd: workspaceRoot, output });
                    if (res.code !== 0) {
                        res = await runCommand('python', ['-m', 'venv', '.venv'], { cwd: workspaceRoot, output });
                        if (res.code !== 0) { throw new Error('Failed to create .venv'); }
                    }
                }
                // Re-check presence
                try { venvExists = fs.existsSync(venvPy); } catch { venvExists = false; }
                if (!venvExists) {
                    // Continue anyway; resolved interpreter path is still venvPy
                }
            }
            resolvedPy = venvPy;
        }

        // Upgrade pip
        output.appendLine(`[Python] Upgrading pip using: ${resolvedPy}`);
        const up = await runCommand(resolvedPy, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
            cwd: workspaceRoot, output
        });
        if (up.code !== 0) {
            throw new Error('pip upgrade failed');
        }

        // Install required extras
        output.appendLine('[Python] Installing google-cloud-aiplatform[agent_engines,adk]…');
        const install = await runCommand(resolvedPy, ['-m', 'pip', 'install', 'google-cloud-aiplatform[agent_engines,adk]'], {
            cwd: workspaceRoot, output
        });
        if (install.code !== 0) {
            throw new Error('Dependency install failed');
        }

        if (useVenv) {
            try {
                await vscode.workspace.getConfiguration('agentConfigurator')
                    .update('pythonPath', resolvedPy, vscode.ConfigurationTarget.Workspace);
                output.appendLine(`[Python] Using workspace venv interpreter: ${resolvedPy}`);
            } catch { /* noop */ }
        }

        // Verify deps using existing helper
        output.appendLine('[Python] Verifying dependencies...');
        const deps = await checkPythonDeps(resolvedPy);
        if (!deps.ok) {
            output.appendLine('[Python] Dependency verification failed - packages may not be fully installed');
            throw new Error('Dependency verification failed');
        }

        // Clear sentinel and resume pending action
        try {
            pythonInstallInProgress = false;
            await context.globalState.update(PY_INSTALL_KEY, false);
        } catch {
            pythonInstallInProgress = false;
        }
        output.appendLine('[Python] Dependencies ready (non-interactive).');
        await resumePendingAction();
        return true;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        try { output.appendLine(`[Python] Non-interactive install failed: ${msg}`); } catch { /* noop */ }
        try {
            pythonInstallInProgress = false;
            await context.globalState.update(PY_INSTALL_KEY, false);
        } catch {
            pythonInstallInProgress = false;
        }
        void vscode.window.showWarningMessage('Python dependencies still missing. Run "Verify Python Dependencies".');
        return false;
    }
}

async function offerInstallPythonDeps(pythonPath: string, resumeKind?: PendingAction['kind']): Promise<void> {
    // If installation is already in progress, just inform and (if provided) remember the pending action
    if (pythonInstallInProgress || vscode.window.terminals.some(t => t.name === SETUP_TERMINAL_NAME)) {
        await vscode.window.showInformationMessage(
            'Python dependencies are currently installing… Wait for the "Agent Configurator: Python Setup" terminal to finish, then retry.'
        );
        if (resumeKind) { setPendingAction(resumeKind); }
        return;
    }

    if (resumeKind) { setPendingAction(resumeKind); }

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
        void vscode.window.showErrorMessage('Open a workspace/folder to install dependencies.');
        return;
    }

    const options = [
        'Use workspace venv (.venv) [auto-install and resume]',
        `Install into current interpreter (${pythonPath}) [auto-install and resume]`,
        'Use workspace venv (.venv) via terminal',
        `Install into current interpreter (${pythonPath}) via terminal`,
        'Cancel'
    ];
    const pick = await vscode.window.showQuickPick(options, { placeHolder: 'Set up Python dependencies for Vertex AI Agent Engine' });
    if (!pick || pick === 'Cancel') {
        return;
    }

    // Handle non-interactive auto-install options
    if (pick.startsWith('Use workspace venv (.venv) [auto-install')) {
        await installDepsNonInteractive({
            useVenv: true,
            pythonPath,
            workspaceRoot: root,
            output: agentOutput
        });
        return;
    }

    if (pick.startsWith(`Install into current interpreter (${pythonPath}) [auto-install`)) {
        await installDepsNonInteractive({
            useVenv: false,
            pythonPath,
            workspaceRoot: root,
            output: agentOutput
        });
        return;
    }

    // Handle legacy terminal-based options
    if (pick === 'Use workspace venv (.venv) via terminal') {
        await vscode.commands.executeCommand('agentConfigurator.setupWorkspaceVenv');
        // setupWorkspaceVenv sets sentinels and verification runs on terminal close
        return;
    }

    // Install into current interpreter via terminal
    // Set both in-memory and persistent sentinels BEFORE sending pip commands
    pythonInstallInProgress = true;
    void context.globalState.update(PY_INSTALL_KEY, true);

    // Open or reuse a terminal named exactly SETUP_TERMINAL_NAME
    let term = vscode.window.terminals.find(t => t.name === SETUP_TERMINAL_NAME);
    if (!term) {
        term = vscode.window.createTerminal({ name: SETUP_TERMINAL_NAME });
    }
    pythonSetupTerminal = term;

    const q = pythonPath.includes(' ') ? `"${pythonPath}"` : pythonPath;
    term.sendText(`${q} -m pip install --upgrade pip`);
    term.sendText(`${q} -m pip install "google-cloud-aiplatform[agent_engines,adk]"`);
    term.show();

    void vscode.window.showInformationMessage(`Installing dependencies into ${pythonPath}… Actions are blocked until setup finishes.`);
    try {
        agentOutput.appendLine(`[Python] Started dependency installation using ${pythonPath}. Actions are blocked until setup finishes.`);
    } catch { /* noop */ }
}
// Guard before any Python-based command
async function ensurePythonReady(pythonPath: string, resumeKind?: PendingAction['kind']): Promise<boolean> {
   // Hard guard: block while setup terminal is present or sentinel is set
   const hasSetupTerminal = vscode.window.terminals.some(t => t.name === SETUP_TERMINAL_NAME);
   if (pythonInstallInProgress || hasSetupTerminal) {
       void vscode.window.showInformationMessage('Python dependencies are currently installing… Wait for the "Agent Configurator: Python Setup" terminal to finish, then retry.');
       if (resumeKind) { setPendingAction(resumeKind); }
       return false;
   }

   const available = await checkPythonAvailable(pythonPath);
   if (!available) {
       const action = await vscode.window.showErrorMessage(`Python interpreter not found: ${pythonPath}`, 'Open settings');
       if (action === 'Open settings') {
           await vscode.commands.executeCommand('workbench.action.openSettings', 'agentConfigurator.pythonPath');
       }
       return false;
   }
   const deps = await checkPythonDeps(pythonPath);
   if (!deps.ok) {
       await offerInstallPythonDeps(pythonPath, resumeKind);
       return false;
   }
   // Successful import check means installs (if any) have completed
   if (pythonInstallInProgress) {
       pythonInstallInProgress = false;
       // Best-effort: clear persisted flag if any
       void context.globalState.update(PY_INSTALL_KEY, false);
   }
   return true;
}
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
            AgentConfigPanel.postMessage({ type: 'context', data: { account, project } });
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
            // If we couldn't resolve an email from gcloud, detectAuth() sets 'ADC user'
            let label = 'Application Default';
            const acct = (auth.account || '').trim();
            if (acct) {
                label = acct === 'ADC user' ? 'ADC user' : acct;
            }
            return `GCP: ${label} • ${projText}`;
        }
        return 'GCP: Not Authenticated';
    };

    // Final ADC probe: attempts to get an access token via gcloud as ground truth
    async function probeAdcToken(timeoutMs = 8000): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            try {
                exec('gcloud auth application-default print-access-token', { timeout: timeoutMs }, (error, stdout, stderr) => {
                    const out = (stdout || '').trim();
                    if (!error && out.length > 0) {
                        try { agentOutput.appendLine('[Auth] token-probe: success'); } catch { /* noop */ }
                        resolve(true);
                    } else {
                        try {
                            const msg = error ? (error as Error).message : (stderr || '').trim();
                            agentOutput.appendLine('[Auth] token-probe: failed' + (msg ? ` (${msg.split('\n')[0]})` : ''));
                        } catch { /* noop */ }
                        resolve(false);
                    }
                });
            } catch {
                try { agentOutput.appendLine('[Auth] token-probe: failed (exec threw)'); } catch { /* noop */ }
                resolve(false);
            }
        });
    }

    const refreshAuthUI = async (reason?: string) => {
        try {
            agentOutput.appendLine(`[Auth] Refreshing auth status${reason ? ` (${reason})` : ''}...`);
            const ws = context.workspaceState;
            const gs = context.globalState;

            const existingProject = (ws.get('agentConfigurator.projectId') as string | undefined) || undefined;

            let detected = await detectAuth(existingProject);

            // If detection failed, try the final ADC token probe as a ground truth
            if (detected.mode === 'None') {
                const probeOk = await probeAdcToken();
                if (probeOk) {
                    agentOutput.appendLine('[Auth] ADC token probe succeeded; treating as authenticated ADC');
                    // Try detectAuth again (credentials may have just landed)
                    let detected2 = await detectAuth(existingProject);
                    if (detected2.mode === 'None') {
                        // Synthesize ADC state with best-effort project adoption
                        let adoptedProject: string | undefined = existingProject;
                        if (!adoptedProject || adoptedProject.trim().length === 0) {
                            try {
                                const adcPath = getGcloudAdcPath();
                                const raw = fs.readFileSync(adcPath, 'utf8');
                                const json = JSON.parse(raw) as { quota_project_id?: string };
                                const qp = (json.quota_project_id || '').trim();
                                if (qp) {
                                    adoptedProject = qp;
                                    await ws.update('agentConfigurator.projectId', adoptedProject);
                                    agentOutput.appendLine(`[Auth] using ADC quota_project_id=${adoptedProject}`);
                                }
                            } catch {
                                // ignore read/parse errors
                            }
                        }
                        detected2 = { mode: 'ADC', account: 'ADC user', project: adoptedProject };
                    }
                    detected = detected2;
                    // Clear spinner once we consider ADC authenticated
                    if (isWaitingForSignIn) {
                        isWaitingForSignIn = false;
                    }
                }
            }

            currentAuth = detected;

            // Persist auth mode (may have transitioned from None -> ADC due to probe)
            await gs.update('agentConfigurator.authMode', detected.mode);

            // If no workspace project is set and detectAuth provided one, adopt it
            let projectToUse = existingProject;
            if ((!existingProject || existingProject.trim().length === 0) && detected.project && detected.project.trim().length > 0) {
                projectToUse = detected.project.trim();
                await ws.update('agentConfigurator.projectId', projectToUse);
            }

            // Short, non-sensitive log indicating which auth path was used
            try {
                const sa = process.env.GOOGLE_APPLICATION_CREDENTIALS;
                const adcPath = getGcloudAdcPath();
                let pathMsg = 'detected None';
                if (detected.mode === 'ServiceAccount' && sa && fs.existsSync(sa)) {
                    pathMsg = 'detected Service Account via GOOGLE_APPLICATION_CREDENTIALS';
                } else if (detected.mode === 'ADC') {
                    pathMsg = fs.existsSync(adcPath) ? 'detected ADC via ADC file' : 'detected ADC via gcloud CLI';
                }
                agentOutput.appendLine(`[Auth] ${pathMsg}`);
            } catch {
                // ignore logging errors
            }

            if (isWaitingForSignIn && detected.mode === 'None') {
                // Keep spinner visible while waiting for sign-in to complete
                gcpStatus.text = '$(sync~spin) GCP: Waiting for sign-in…';
                gcpStatus.tooltip = 'Completing gcloud ADC sign-in';
            } else {
                // Clear waiting state once we have a valid auth mode
                if (isWaitingForSignIn && detected.mode !== 'None') {
                    isWaitingForSignIn = false;
                }
                gcpStatus.text = formatStatus(detected, projectToUse);
                gcpStatus.tooltip = detected.mode !== 'None'
                    ? `Google Cloud\nAccount: ${detected.account ?? '-'}\nProject: ${projectToUse ?? '(no project)'}`
                    : 'Google Cloud authentication and project';
            }

            postContextToWebview(detected.account, projectToUse);
            agentOutput.appendLine(`[Auth] Mode=${detected.mode} Account=${detected.account ?? '-'} Project=${projectToUse ?? '-'}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            agentOutput.appendLine(`[Auth] Error refreshing auth: ${msg}`);
            gcpStatus.text = 'GCP: Not Authenticated';
            gcpStatus.tooltip = 'Google Cloud authentication and project';
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
            const engineIds = (ws.get('agentConfigurator.engineIds') as Record<string, string>) || {};
            const names = Object.values(engineIds);
            if (!projectId || names.length === 0) {
                return;
            }

            const pythonPath = await getPythonPath();
            const ready = await ensurePythonReady(pythonPath);
            if (!ready) {
                agentOutput.appendLine(`[Memory] skip verify: python deps missing`);
                return;
            }

            const scriptPath = context.asAbsolutePath(path.join('src', 'python', 'list_agent_engines.py'));
            
            // Ensure PYTHONPATH includes workspace root
            const pythonPathDirs = rootPath ? [rootPath] : [];
            if (process.env.PYTHONPATH) {
                pythonPathDirs.push(process.env.PYTHONPATH);
            }
            
            const env: NodeJS.ProcessEnv = {
                ...process.env,
                PYTHONPATH: pythonPathDirs.filter(Boolean).join(path.delimiter),
            };
            agentOutput.appendLine(`[Verify] Python: ${pythonPath}`);
            const child = spawn(pythonPath, [scriptPath, '--project', projectId, '--region', region], { cwd: rootPath, env });
            let out = '';
            let err = '';
            let offeredInstall = false;
            child.stdout.on('data', (d) => { out += d.toString(); });
            child.stderr.on('data', async (d) => {
                const text = d.toString();
                err += text;
                if (!offeredInstall && text.toLowerCase().includes('google-cloud-aiplatform') && text.toLowerCase().includes('not installed')) {
                    offeredInstall = true;
                    const choice = await vscode.window.showInformationMessage('Python dependency google-cloud-aiplatform is not installed.', 'Install now', 'Dismiss');
                    if (choice === 'Install now') { await offerInstallPythonDeps(pythonPath, 'verify'); }
                }
            });
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
                        AgentConfigPanel.postMessage({ type: 'deploymentVerified', data: { engineIdValid: !!valid } });
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
    void refreshAuthUI('activate');
    void verifyStoredEngines();// Register Agent Config webview view provider
    agentConfigProvider = new AgentConfigViewProvider(context, agentOutput);
 
    // Initialize robust ADC dir watcher + stat-based fallback polling
    AuthRefreshCoordinator.init(context, refreshAuthUI, agentOutput);

    // ADC credentials file watcher
    try {
        const adcPath = getGcloudAdcPath();
        const adcDir = path.dirname(adcPath);
        if (fs.existsSync(adcDir)) {
            try {
                if (adcWatcher) { try { adcWatcher.close(); } catch { /* noop */ } adcWatcher = undefined; }
                adcWatcher = fs.watch(adcPath, { persistent: false }, (event) => {
                    // On 'change' or 'rename', trigger a debounced refresh
                    if (event === 'change' || event === 'rename') {
                        debounceKey('adc-file', () => { void refreshAuthUI('adc-file-changed'); }, ADC_WATCH_DEBOUNCE_MS);
                    } else {
                        debounceKey('adc-file', () => { void refreshAuthUI('adc-file-changed'); }, ADC_WATCH_DEBOUNCE_MS);
                    }
                });
                context.subscriptions.push({
                    dispose: () => { try { adcWatcher?.close(); } catch { /* noop */ } adcWatcher = undefined; }
                });
                agentOutput.appendLine(`[Auth] ADC watcher active: ${adcPath}`);
            } catch (e) {
                agentOutput.appendLine(`[Auth] Warning: fs.watch failed for ADC file: ${(e as Error).message}`);
            }
        } else {
            agentOutput.appendLine('[Auth] ADC dir not found; skipping ADC file watch.');
        }
    } catch (e) {
        agentOutput.appendLine(`[Auth] Warning: ADC watch setup exception: ${(e as Error).message}`);
    }
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

        // Open or reveal the editor WebviewPanel
        AgentConfigPanel.createOrShow(context, agentOutput, context.workspaceState);

        // Build and post init/context to keep UI in sync with selection
        const ws = context.workspaceState;
        const active = (ws.get('agentConfigurator.activeAgent') as { name: string; path?: string } | undefined) ?? agent ?? { name: '', path: undefined };
        const name = active?.name || '';
        const configs = (ws.get('agentConfigurator.agentConfigs') as Record<string, { name: string; description: string; model: string }>) || {};
        const engineIds = (ws.get('agentConfigurator.engineIds') as Record<string, string>) || {};
        const projectId = (ws.get('agentConfigurator.projectId') as string) || '';
        const region = (ws.get('agentConfigurator.region') as string) || 'us-central1';
        const cfg = (name && configs[name]) || { name, description: '', model: 'gemini-2.0' };
        const engineId = name ? engineIds[name] : undefined;

        const initMsg = {
            type: 'init' as const,
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
        };

        agentConfigProvider?.postMessage(initMsg);
        AgentConfigPanel.postMessage(initMsg);
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

                    if (pythonInstallInProgress) {
                        void vscode.window.showInformationMessage('Python dependencies are currently installing… Wait for the "Agent Configurator: Python Setup" terminal to finish, then retry.');
                        agentOutput.appendLine('[Deploy] Blocked because dependency installation is in progress.');
                        return;
                    }

                    // Python preflight
                    const pythonPath = await getPythonPath();
                    agentOutput.appendLine(`[Deploy] Python: ${pythonPath}`);
                    const ready = await ensurePythonReady(pythonPath, 'deploy');
                    if (!ready) {
                        agentOutput.appendLine('[Deploy] Aborted due to missing Python environment/dependencies.');
                        return;
                    }

                    // Resolve module/symbol
                    const moduleSymbols = (ws.get('agentConfigurator.moduleSymbols') as Record<string, { module: string; symbol: string }>) || {};
                    let modulePath = moduleSymbols[active.name]?.module;
                    let symbol = moduleSymbols[active.name]?.symbol;
                    
                    // If not stored, derive from the active agent's path and the scanner data
                    if (!modulePath || !symbol) {
                        // Try to get agent info from scanner data
                        const agentTreeProvider = agentTreeDataProvider;
                        const scannedAgents = agentTreeProvider.getRootAgents();
                        const matchingAgent = scannedAgents.find(a =>
                            (a.args.name === active.name || a.id === active.name) &&
                            a.file === active.path
                        );
                        
                        if (matchingAgent) {
                            // Use the id from scanner as the symbol (e.g., "root_agent")
                            symbol = matchingAgent.id;
                            agentOutput.appendLine(`[Deploy] Using scanned symbol: ${symbol}`);
                        }
                        
                        // Derive module path from file path
                        const fp = active.path;
                        if (fp) {
                            const abs = path.isAbsolute(fp) ? fp : path.join(rootPath, fp);
                            let rel = path.relative(rootPath, abs).replace(/\\/g, '/');
                            if (rel.toLowerCase().endsWith('.py')) {
                                rel = rel.slice(0, -3);
                            }
                            modulePath = rel.replace(/\//g, '.');
                            agentOutput.appendLine(`[Deploy] Derived module path: ${modulePath}`);
                        }
                    }
                    
                    // Default symbol to 'agent' if still not found
                    if (!symbol || !symbol.trim()) {
                        symbol = 'agent';
                    }

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
                    const bucketRegex = /^gs:\/\/[a-z0-9.\-_]{3,63}(\/.*)?$/;
                    const promptForBucket = async (): Promise<string | undefined> => {
                        return vscode.window.showInputBox({
                            prompt: 'Enter GCS staging bucket (e.g., gs://my-staging-bucket)',
                            placeHolder: 'gs://my-staging-bucket',
                            ignoreFocusOut: true,
                            validateInput: (v) => bucketRegex.test((v || '').trim()) ? undefined : 'Invalid bucket. Example: gs://my-staging-bucket'
                        });
                    };
                    if (!bucket || !bucketRegex.test(bucket.trim())) {
                        const entered = await promptForBucket();
                        if (!entered || !bucketRegex.test(entered.trim())) {
                            void vscode.window.showErrorMessage('Invalid staging bucket. Aborting deploy.');
                            return;
                        }
                        bucket = entered.trim();
                        await ws.update('agentConfigurator.bucket', bucket);
                    }
                    agentOutput.appendLine(`[Deploy] Using staging bucket: ${bucket}`);

                    if (!modulePath || !modulePath.trim()) {
                        modulePath = await vscode.window.showInputBox({
                            prompt: 'Enter Python module path for the agent (e.g. pkg.agent)',
                            ignoreFocusOut: true,
                            validateInput: (v) => v.trim() ? undefined : 'Module path required',
                        }) || '';
                    }
                    if (!symbol || !symbol.trim()) {
                        symbol = await vscode.window.showInputBox({
                            prompt: 'Enter agent symbol (callable or object)',
                            value: 'agent',
                            ignoreFocusOut: true,
                            validateInput: (v) => v.trim() ? undefined : 'Symbol required',
                        }) || '';
                    }
                    if (!modulePath.trim() || !symbol.trim()) {
                        void vscode.window.showErrorMessage('Module and symbol are required for deployment.');
                        return;
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

                    // For module imports to work, we need the correct directory in PYTHONPATH
                    // If module is "travel_concierge.agent", Python needs to find "travel_concierge" as a package
                    const pythonPathDirs: string[] = [];
                    
                    agentOutput.appendLine(`[Deploy] Workspace root: ${rootPath}`);
                    agentOutput.appendLine(`[Deploy] Module to import: ${modulePath}`);
                    
                    if (rootPath) {
                        // Check if we need to adjust the PYTHONPATH for module imports
                        if (modulePath && modulePath.includes('.')) {
                            const packageName = modulePath.split('.')[0];
                            agentOutput.appendLine(`[Deploy] Package name: ${packageName}`);
                            
                            // Check if the workspace root ends with the package name
                            // e.g., workspace is /path/to/travel_concierge and module is travel_concierge.agent
                            if (rootPath.endsWith(packageName) || rootPath.endsWith(path.sep + packageName)) {
                                // We're inside the package directory, need parent in PYTHONPATH
                                const parentDir = path.dirname(rootPath);
                                pythonPathDirs.push(parentDir);
                                agentOutput.appendLine(`[Deploy] Workspace IS the package directory '${packageName}'`);
                                agentOutput.appendLine(`[Deploy] Using parent directory for imports: ${parentDir}`);
                            } else {
                                // Check if the package exists as a subdirectory
                                const packagePath = path.join(rootPath, packageName);
                                if (fs.existsSync(packagePath) && fs.statSync(packagePath).isDirectory()) {
                                    // Package is a subdirectory, workspace root is correct
                                    pythonPathDirs.push(rootPath);
                                    agentOutput.appendLine(`[Deploy] Package '${packageName}' found as subdirectory in workspace`);
                                    agentOutput.appendLine(`[Deploy] Using workspace root: ${rootPath}`);
                                } else {
                                    // Default: use workspace root
                                    pythonPathDirs.push(rootPath);
                                    agentOutput.appendLine(`[Deploy] Using workspace root (default): ${rootPath}`);
                                }
                            }
                        } else {
                            // No package structure detected, use workspace root
                            pythonPathDirs.push(rootPath);
                            agentOutput.appendLine(`[Deploy] No package structure detected, using workspace root: ${rootPath}`);
                        }
                    }
                    
                    // Preserve existing PYTHONPATH entries
                    if (process.env.PYTHONPATH) {
                        pythonPathDirs.push(process.env.PYTHONPATH);
                    }
                    
                    const env: NodeJS.ProcessEnv = {
                        ...process.env,
                        PYTHONPATH: pythonPathDirs.filter(Boolean).join(path.delimiter),
                    };

                    agentOutput.appendLine(`[Deploy] PYTHONPATH: ${env.PYTHONPATH}`);
                    agentOutput.appendLine(`[Deploy] Spawning ${pythonPath} ${args.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`);
                    const child = spawn(pythonPath, args, { cwd: rootPath, env });

                    token.onCancellationRequested(() => {
                        try { child.kill(); } catch { /* noop */ }
                    });

                    let stderrBuf = '';
                    let engineId: string | undefined;
                    let offeredInstall = false;

                    child.stdout.on('data', (data) => {
                        const text = data.toString();
                        agentOutput.appendLine(text.trim());
                        const m = text.match(/ENGINE_ID:\s*(.+)\s*$/m);
                        if (m) {
                            engineId = m[1].trim();
                        }
                    });
                    child.stderr.on('data', async (data) => {
                        const text = data.toString();
                        stderrBuf += text;
                        agentOutput.appendLine(text.trim());
                        if (!offeredInstall && text.toLowerCase().includes('google-cloud-aiplatform') && text.toLowerCase().includes('not installed')) {
                            offeredInstall = true;
                            const choice = await vscode.window.showInformationMessage('Python dependency google-cloud-aiplatform is not installed.', 'Install now', 'Dismiss');
                            if (choice === 'Install now') { await offerInstallPythonDeps(pythonPath, 'deploy'); }
                        }
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
                        AgentConfigPanel.postMessage({ type: 'deploymentComplete', data: { engineId } });
                        void vscode.window.showInformationMessage(`Agent deployed: ${engineId}`);
                    } else {
                        // If import error, offer override for module/symbol and suggest retry
                        if (stderrBuf.toLowerCase().includes('no module named') || stderrBuf.toLowerCase().includes('symbol') || stderrBuf.toLowerCase().includes('attributeerror')) {
                            const choice = await vscode.window.showWarningMessage('Deploy failed importing module/symbol. Configure module and symbol?', 'Configure');
                            if (choice === 'Configure') {
                                const newModule = await vscode.window.showInputBox({ prompt: 'Python module path (e.g. pkg.agent)', value: modulePath, ignoreFocusOut: true }) || modulePath;
                                const newSymbol = await vscode.window.showInputBox({ prompt: 'Agent symbol', value: symbol, ignoreFocusOut: true }) || symbol;
                                if (newModule.trim()) {
                                    const msKey = 'agentConfigurator.moduleSymbols';
                                    const existing = (ws.get(msKey) as Record<string, { module: string; symbol: string }>) || {};
                                    existing[active.name] = { module: newModule, symbol: newSymbol.trim() || 'agent' };
                                    await ws.update(msKey, existing);
                                    void vscode.window.showInformationMessage('Module/symbol saved. Run Deploy again.');
                                } else {
                                    void vscode.window.showWarningMessage('Module cannot be empty. Not saved.');
                                }
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
            if (pythonInstallInProgress) {
                void vscode.window.showInformationMessage('Python dependencies are currently installing… Wait for the "Agent Configurator: Python Setup" terminal to finish, then retry.');
                return;
            }
            const confirm = await vscode.window.showWarningMessage(`Delete Agent Engine?\n${engineId}`, { modal: true }, 'Yes');
            if (confirm !== 'Yes') { return; }

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, cancellable: true, title: 'Stopping agent (deleting Engine)…' },
                async (_p, token) => {
                    const projectId = (ws.get('agentConfigurator.projectId') as string) || '';
                    const region = (ws.get('agentConfigurator.region') as string) || 'us-central1';

                    const pythonPath = await getPythonPath();
                    agentOutput.appendLine(`[Stop] Python: ${pythonPath}`);
                    const ready = await ensurePythonReady(pythonPath, 'stop');
                    if (!ready) { agentOutput.appendLine('[Stop] Aborted due to missing Python environment/dependencies.'); return; }

                    const scriptPath = context.asAbsolutePath(path.join('src', 'python', 'delete_agent_engine.py'));
                    const args = [scriptPath, '--project', projectId, '--region', region, '--engine-id', engineId, '--force', 'true'];

                    // Ensure PYTHONPATH includes workspace root
                    const pythonPathDirs = rootPath ? [rootPath] : [];
                    if (process.env.PYTHONPATH) {
                        pythonPathDirs.push(process.env.PYTHONPATH);
                    }
                    
                    const env: NodeJS.ProcessEnv = {
                        ...process.env,
                        PYTHONPATH: pythonPathDirs.filter(Boolean).join(path.delimiter),
                    };

                    agentOutput.appendLine(`[Stop] Spawning ${pythonPath} ${args.join(' ')}`);
                    const child = spawn(pythonPath, args, { cwd: rootPath, env });
                    token.onCancellationRequested(() => { try { child.kill(); } catch { /* noop */ } });

                    let stderrBuf = '';
                    let offeredInstall = false;
                    child.stdout.on('data', (d) => agentOutput.appendLine(d.toString().trim()));
                    child.stderr.on('data', async (d) => {
                        const text = d.toString();
                        stderrBuf += text;
                        agentOutput.appendLine(text.trim());
                        if (!offeredInstall && text.toLowerCase().includes('google-cloud-aiplatform') && text.toLowerCase().includes('not installed')) {
                            offeredInstall = true;
                            const choice = await vscode.window.showInformationMessage('Python dependency google-cloud-aiplatform is not installed.', 'Install now', 'Dismiss');
                            if (choice === 'Install now') { await offerInstallPythonDeps(pythonPath, 'stop'); }
                        }
                    });

                    const code: number = await new Promise(resolve => child.on('close', resolve));
                    if (code === 0) {
                        delete engineIds[active.name];
                        await ws.update('agentConfigurator.engineIds', engineIds);
                        agentConfigProvider?.postMessage({ type: 'stopped', data: { engineIdCleared: true } });
                        AgentConfigPanel.postMessage({ type: 'stopped', data: { engineIdCleared: true } });
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

    // One-click: Create/Use workspace .venv and install dependencies
    const setupWorkspaceVenvCmd = vscode.commands.registerCommand('agentConfigurator.setupWorkspaceVenv', async () => {
        try {
            const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!root) {
                void vscode.window.showErrorMessage('Open a workspace/folder to create .venv first.');
                return;
            }

            const venvPy = process.platform === 'win32'
                ? path.join(root, '.venv', 'Scripts', 'python.exe')
                : path.join(root, '.venv', 'bin', 'python');

            // Ensure sentinel set BEFORE launching commands
            pythonInstallInProgress = true;
            await context.globalState.update(PY_INSTALL_KEY, true);

            // Open or reuse a terminal named exactly SETUP_TERMINAL_NAME
            let term = vscode.window.terminals.find(t => t.name === SETUP_TERMINAL_NAME);
            if (!term) {
                term = vscode.window.createTerminal({ name: SETUP_TERMINAL_NAME, cwd: root });
            } else {
                // Ensure working directory is the workspace root
                if (process.platform === 'win32') {
                    term.sendText(`cd /d "${root}"`);
                } else {
                    term.sendText(`cd "${root}"`);
                }
            }
            pythonSetupTerminal = term;

            // Update workspace setting to use this interpreter immediately
            await vscode.workspace.getConfiguration('agentConfigurator')
                .update('pythonPath', venvPy, vscode.ConfigurationTarget.Workspace);
            try { agentOutput.appendLine(`[Python] Using workspace venv interpreter: ${venvPy}`); } catch { /* noop */ }

            // Inform user and start setup
            void vscode.window.showInformationMessage('Creating .venv and installing dependencies… Actions will be blocked until setup finishes.');

            // Create venv if missing (cross-platform fallback chain)
            const createVenvCmd = process.platform === 'win32'
                ? 'py -3 -m venv .venv || python -m venv .venv'
                : 'python3 -m venv .venv || python -m venv .venv';
            term.sendText(createVenvCmd);

            // Install/upgrade pip and required deps WITHOUT activating shell (invoke venv python directly)
            const q = venvPy.includes(' ') ? `"${venvPy}"` : venvPy;
            term.sendText(`${q} -m pip install --upgrade pip`);
            term.sendText(`${q} -m pip install "google-cloud-aiplatform[agent_engines,adk]"`);
            term.show();
            // Sentinel is cleared and verification auto-runs in onDidCloseTerminal
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            try { agentOutput.appendLine(`[Python] Setup error: ${msg}`); } catch { /* noop */ }
            void vscode.window.showErrorMessage(`Failed to set up workspace venv: ${msg}`);
        }
    });
    context.subscriptions.push(setupWorkspaceVenvCmd);
    // Verify Python Dependencies command
    const verifyPythonCmd = vscode.commands.registerCommand('agentConfigurator.verifyPython', async () => {
        const pythonPath = await getPythonPath();

        if (pythonInstallInProgress) {
            void vscode.window.showInformationMessage('Python dependencies are currently installing… Wait for the "Agent Configurator: Python Setup" terminal to finish, then retry.');
            return;
        }

        const ok = await ensurePythonReady(pythonPath, 'verify');
        if (ok) {
            void vscode.window.showInformationMessage(`Python deps OK (google-cloud-aiplatform[agent_engines,adk]). Interpreter: ${pythonPath}`);
        } else {
            // ensurePythonReady() already offered install; offer once more if not already installing
            if (!pythonInstallInProgress) {
                const choice = await vscode.window.showInformationMessage(
                    'Python dependencies for Vertex AI Agent Engine are missing.',
                    'Install now',
                    'Cancel'
                );
                if (choice === 'Install now') {
                    await offerInstallPythonDeps(pythonPath, 'verify');
                }
            }
        }
    });
    context.subscriptions.push(verifyPythonCmd);

    const genCardCmd = vscode.commands.registerCommand('agentConfigurator.generateAgentCard', async () => {
        try {
            const res = await generateAgentCard(context);
            agentOutput.appendLine(`[A2A] Agent card written to: ${res.filePath}`);
            void vscode.window.showInformationMessage('Agent Card generated.');
            agentConfigProvider?.postMessage({ type: 'a2aUpdated', data: { hasCard: true, skillsCount: res.skillsCount } });
            AgentConfigPanel.postMessage({ type: 'a2aUpdated', data: { hasCard: true, skillsCount: res.skillsCount } });
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
            AgentConfigPanel.postMessage({ type: 'a2aUpdated', data: { hasCard: res.hasCard, skillsCount: res.skillsCount } });
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
            if (!projectId) {
                void vscode.window.showWarningMessage('Set a GCP project before attaching an engine.');
                return;
            }

            if (pythonInstallInProgress) {
                void vscode.window.showInformationMessage('Python dependencies are currently installing… Wait for the "Agent Configurator: Python Setup" terminal to finish, then retry.');
                return;
            }

            const pythonPath = await getPythonPath();
            agentOutput.appendLine(`[Memory] Python: ${pythonPath}`);
            const ready = await ensurePythonReady(pythonPath, 'attachMemory');
            if (!ready) {
                agentOutput.appendLine(`[Memory] Skipped listing engines: Python dependencies not installed. Use 'Install now' to set up.`);
                return;
            }

            const scriptPath = context.asAbsolutePath(path.join('src', 'python', 'list_agent_engines.py'));
            
            // Ensure PYTHONPATH includes workspace root
            const pythonPathDirs = rootPath ? [rootPath] : [];
            if (process.env.PYTHONPATH) {
                pythonPathDirs.push(process.env.PYTHONPATH);
            }
            
            const env: NodeJS.ProcessEnv = {
                ...process.env,
                PYTHONPATH: pythonPathDirs.filter(Boolean).join(path.delimiter),
            };
            const child = spawn(pythonPath, [scriptPath, '--project', projectId, '--region', region], { cwd: rootPath, env });
            let out = '';
            let err = '';
            let offeredInstall = false;
            child.stdout.on('data', (d) => { out += d.toString(); });
            child.stderr.on('data', async (d) => {
                const text = d.toString();
                err += text;
                if (!offeredInstall && text.toLowerCase().includes('google-cloud-aiplatform') && text.toLowerCase().includes('not installed')) {
                    offeredInstall = true;
                    const choice = await vscode.window.showInformationMessage('Python dependency google-cloud-aiplatform is not installed.', 'Install now', 'Dismiss');
                    if (choice === 'Install now') { await offerInstallPythonDeps(pythonPath, 'attachMemory'); }
                }
            });
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
                    AgentConfigPanel.postMessage({ type: 'engineLinked', data: { engineId: pick.value } });
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

    const loginCmd = vscode.commands.registerCommand('agentConfigurator.gcloudLogin', async () => {
        agentOutput.appendLine('[Auth] Opening gcloud ADC login in terminal...');
        loginTerminal = vscode.window.createTerminal({ name: 'GCloud Auth' });
        // Show waiting spinner in Status Bar and start stat-based fallback polling
        isWaitingForSignIn = true;
        gcpStatus.text = '$(sync~spin) GCP: Waiting for sign-in…';
        gcpStatus.tooltip = 'Completing gcloud ADC sign-in';
        AuthRefreshCoordinator.startStatPoll();
        // Start gcloud browser auth
        loginTerminal.sendText('gcloud auth application-default login');
        loginTerminal.show();

        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, cancellable: true, title: 'Waiting for Google auth to complete…' },
            async (_progress, token) => {
                const started = Date.now();
                await new Promise<void>((resolve) => {
                    const timer = setInterval(async () => {
                        if (token.isCancellationRequested) {
                            clearInterval(timer);
                            agentOutput.appendLine('[Auth] Login poll cancelled.');
                            resolve();
                            return;
                        }
                        try {
                            const existingProject = (context.workspaceState.get('agentConfigurator.projectId') as string | undefined) || undefined;
                            const res = await detectAuth(existingProject);
                            if (res.mode !== 'None' && (res.account?.trim()?.length ?? 0) > 0) {
                                clearInterval(timer);
                                agentOutput.appendLine('[Auth] Poll detected ADC credentials.');
                                await refreshAuthUI('poll-detected');
                                resolve();
                                return;
                            } else {
                                // If detectAuth is inconclusive, try the ADC token probe immediately for fast UI flip
                                const probeOk = await probeAdcToken();
                                if (probeOk) {
                                    clearInterval(timer);
                                    agentOutput.appendLine('[Auth] ADC token probe succeeded; treating as authenticated ADC');
                                    isWaitingForSignIn = false;
                                    await refreshAuthUI('token-probe-during-poll');
                                    resolve();
                                    return;
                                }
                            }
                        } catch {
                            // ignore and continue polling
                        }
                        if (Date.now() - started >= MAX_POLL_MS) {
                            clearInterval(timer);
                            agentOutput.appendLine('[Auth] Poll timed out waiting for ADC.');
                            resolve();
                        }
                    }, POLL_INTERVAL_MS);
                    token.onCancellationRequested(() => {
                        clearInterval(timer);
                        agentOutput.appendLine('[Auth] Login poll cancelled.');
                        resolve();
                    });
                });
                // Finalize: if polling/watchers didn't detect auth, try token probe before giving up
                if (isWaitingForSignIn) {
                    const probeOk = await probeAdcToken();
                    if (probeOk) {
                        agentOutput.appendLine('[Auth] ADC token probe succeeded; treating as authenticated ADC');
                        isWaitingForSignIn = false;
                        await refreshAuthUI('token-probe-post-timeout');
                    } else {
                        agentOutput.appendLine('[Auth] ADC not detected within timeout; use Refresh status');
                        isWaitingForSignIn = false;
                        await refreshAuthUI('manual');
                    }
                }
            }
        );
    });
    context.subscriptions.push(loginCmd);

    // Terminal hooks for Python setup and gcloud login terminals
    context.subscriptions.push(
        vscode.window.onDidOpenTerminal((opened) => {
            if (opened.name === SETUP_TERMINAL_NAME) {
                pythonSetupTerminal = opened;
                pythonInstallInProgress = true;
                void context.globalState.update(PY_INSTALL_KEY, true);
                try { agentOutput.appendLine('[Python] Setup terminal opened. Install sentinel set; actions will be blocked until it closes.'); } catch { /* noop */ }
            }
        })
    );

    context.subscriptions.push(
        vscode.window.onDidCloseTerminal((closed) => {
            if (loginTerminal && (closed === loginTerminal || closed.name === loginTerminal.name)) {
                loginTerminal = undefined;
                debounceKey('terminal-close', () => { void refreshAuthUI('terminal-closed'); }, 250);
            }
            if (closed.name === SETUP_TERMINAL_NAME || (pythonSetupTerminal && (closed === pythonSetupTerminal || closed.name === pythonSetupTerminal.name))) {
                pythonSetupTerminal = undefined;
                pythonInstallInProgress = false;
                void context.globalState.update(PY_INSTALL_KEY, false);
                try { agentOutput.appendLine('[Python] Dependency installation terminal closed. Verifying dependencies…'); } catch { /* noop */ }
                // Auto re-check Python dependencies on close
                void (async () => {
                    try {
                        const pythonPath = await getPythonPath();
                        const res = await checkPythonDeps(pythonPath);
                        if (res.ok) {
                            const kind = pendingAction?.kind;
                            vscode.window.showInformationMessage('Python dependencies ready.');
                            if (kind) {
                                agentOutput.appendLine(`[Python] Dependencies ready; resuming previous action: ${kind}`);
                            } else {
                                agentOutput.appendLine('Python deps OK (aiplatform[agent_engines,adk])');
                            }
                            await resumePendingAction();
                        } else {
                            vscode.window.showWarningMessage('Python dependencies still missing. Run "Verify Python Dependencies".');
                        }
                    } catch {
                        // ignore errors in background check
                    }
                })();
            }
        })
    );

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
        await refreshAuthUI('manual');
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
 export function deactivate() {
     try { AuthRefreshCoordinator.dispose(); } catch { /* noop */ }
     try { adcWatcher?.close(); } catch { /* noop */ }
 }
