import * as vscode from 'vscode';

type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'save'; data: { name: string; description: string; model: string } }
  | { type: 'deploy' }
  | { type: 'stop' }
  | { type: 'generateCard' }
  | { type: 'checkCompatibility' }
  | { type: 'saveModuleSymbol'; data: { module: string; symbol: string } }
  | { type: 'attachExistingEngine' }
  | { type: 'openMemoryConsole' };

type InitData = {
  name: string;
  description: string;
  model: string;
  engineId?: string;
  memory: { attached: boolean };
  a2a: { hasCard: boolean; skillsCount: number };
  projectId: string;
  region: string;
  account?: string;
  project?: string;
};

type ExtensionToWebviewMessage =
  | { type: 'init'; data: InitData }
  | { type: 'context'; data: { account?: string; project?: string } }
  | { type: 'deploymentComplete'; data: { engineId: string } }
  | { type: 'stopped'; data: { engineIdCleared: boolean } }
  | { type: 'engineLinked'; data: { engineId: string } }
  | { type: 'deploymentVerified'; data: { engineIdValid: boolean } }
  | { type: 'a2aUpdated'; data: { hasCard: boolean; skillsCount: number } };

export class AgentConfigPanel {
  public static readonly viewType = 'agentConfigurator.panel';
  private static currentPanel: AgentConfigPanel | undefined;

  public static createOrShow(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel,
    _state?: vscode.Memento
  ) {
    // mark unused for linting
    void _state;

    const column = vscode.ViewColumn.One;

    if (AgentConfigPanel.currentPanel) {
      AgentConfigPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      AgentConfigPanel.viewType,
      'Agent Config',
      column,
      {
        enableScripts: true,
        localResourceRoots: [context.extensionUri],
      }
    );

    AgentConfigPanel.currentPanel = new AgentConfigPanel(panel, context, output);
  }

  public static postMessage(message: ExtensionToWebviewMessage) {
    if (AgentConfigPanel.currentPanel) {
      AgentConfigPanel.currentPanel._panel.webview.postMessage(message);
    }
  }

  private constructor(
    private readonly _panel: vscode.WebviewPanel,
    private readonly _context: vscode.ExtensionContext,
    private readonly _output: vscode.OutputChannel
  ) {
    this._panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri],
    };
    this._panel.webview.html = this.getHtmlForWebview(this._panel.webview);

    this._panel.onDidDispose(() => this.dispose(), null, this._context.subscriptions);

    this._panel.webview.onDidReceiveMessage(
      async (message: WebviewToExtensionMessage) => {
        switch (message.type) {
          case 'ready': {
            const init = this.getInitData();
            AgentConfigPanel.postMessage({ type: 'init', data: init });
            break;
          }
          case 'save': {
            const data = message.data;
            const name = (data?.name || '').trim();
            const desc = data?.description ?? '';
            const model = data?.model || 'gemini-2.0';

            const key = 'agentConfigurator.agentConfigs';
            const existing =
              (this._context.workspaceState.get(key) as Record<string, { name: string; description: string; model: string }>) ||
              {};
            const activeName = name || this.getActiveAgentName() || 'Unnamed Agent';
            existing[activeName] = {
              name: activeName,
              description: desc,
              model,
            };
            await this._context.workspaceState.update(key, existing);

            this._output.appendLine(`[Save] Saved config for agent "${activeName}" (model=${model})`);
            vscode.window.showInformationMessage('Agent configuration saved.');
            break;
          }
          case 'deploy': {
            await vscode.commands.executeCommand('agentConfigurator.deployAgent');
            break;
          }
          case 'stop': {
            await vscode.commands.executeCommand('agentConfigurator.stopAgent');
            break;
          }
          case 'generateCard': {
            await vscode.commands.executeCommand('agentConfigurator.generateAgentCard');
            break;
          }
          case 'checkCompatibility': {
            await vscode.commands.executeCommand('agentConfigurator.checkCompatibility');
            break;
          }
          case 'saveModuleSymbol': {
            const activeName = this.getActiveAgentName();
            if (!activeName) {
              vscode.window.showWarningMessage('No active agent selected.');
              break;
            }
            const moduleVal = (message.data?.module || '').trim();
            const symbolVal = (message.data?.symbol || 'agent').trim();
            if (!moduleVal) {
              vscode.window.showWarningMessage('Module cannot be empty. Not saved.');
              break;
            }
            const key = 'agentConfigurator.moduleSymbols';
            const existing = (this._context.workspaceState.get(key) as Record<string, { module: string; symbol: string }>) || {};
            existing[activeName] = { module: moduleVal, symbol: symbolVal || 'agent' };
            await this._context.workspaceState.update(key, existing);
            this._output.appendLine(`[Deploy] Saved module/symbol for "${activeName}" => ${moduleVal}:${symbolVal || 'agent'}`);
            vscode.window.showInformationMessage('Module and symbol saved.');
            break;
          }
          case 'attachExistingEngine': {
            await vscode.commands.executeCommand('agentConfigurator.attachMemory');
            break;
          }
          case 'openMemoryConsole': {
            await vscode.commands.executeCommand('agentConfigurator.openMemoryConsole');
            break;
          }
        }
      },
      undefined,
      this._context.subscriptions
    );
  }

  public dispose() {
    AgentConfigPanel.currentPanel = undefined;
  }

  private getActiveAgentName(): string | undefined {
    const active = this._context.workspaceState.get('agentConfigurator.activeAgent') as
      | { name: string; path?: string }
      | undefined;
    return active?.name;
  }

  private getInitData(): InitData {
    const ws = this._context.workspaceState;
    const active = ws.get('agentConfigurator.activeAgent') as { name: string; path?: string } | undefined;
    const name = active?.name || '';

    const configs =
      (ws.get('agentConfigurator.agentConfigs') as Record<string, { name: string; description: string; model: string }>) || {};
    const engineIds = (ws.get('agentConfigurator.engineIds') as Record<string, string>) || {};
    const projectId = (ws.get('agentConfigurator.projectId') as string) || '';
    const region = (ws.get('agentConfigurator.region') as string) || 'us-central1';

    const cfg = (name && configs[name]) || { name, description: '', model: 'gemini-2.0' };
    const engineId = name ? engineIds[name] : undefined;

    return {
      ...cfg,
      engineId,
      memory: { attached: !!engineId },
      a2a: { hasCard: false, skillsCount: 0 },
      projectId,
      region,
      // account/project context will be posted by extension when known
    };
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = `
      default-src 'none';
      img-src ${webview.cspSource} https:;
      style-src ${webview.cspSource} 'unsafe-inline';
      script-src 'nonce-${nonce}';
    `;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Config</title>
  <style>
    :root {
      --pad: 8px;
      --gap: 10px;
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border);
      --accent: var(--vscode-textLink-foreground);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
    }
    body {
      margin: 0;
      padding: var(--pad);
      font-family: var(--vscode-font-family);
      color: var(--fg);
      background: var(--bg);
    }
    h2 {
      margin: 0 0 var(--gap) 0;
      color: var(--accent);
      font-size: 14px;
      font-weight: 600;
    }
    .contextbar {
      border: 1px solid var(--border);
      padding: var(--pad);
      margin-bottom: var(--gap);
      border-radius: 4px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--gap);
      align-items: center;
    }
    .kvrow strong { margin-right: 6px; }
    .section {
      border: 1px solid var(--border);
      padding: var(--pad);
      margin-bottom: var(--gap);
      border-radius: 4px;
    }
    label {
      display: block;
      font-size: 12px;
      margin-bottom: 4px;
      opacity: 0.85;
    }
    input[type="text"], textarea, select {
      width: 100%;
      box-sizing: border-box;
      padding: 6px;
      color: var(--input-fg);
      background: var(--input-bg);
      border: 1px solid var(--border);
      border-radius: 3px;
      margin-bottom: var(--gap);
      font-size: 12px;
    }
    textarea { min-height: 72px; resize: vertical; }
    .row { display: flex; gap: var(--gap); flex-wrap: wrap; }
    .col { flex: 1 1 200px; min-width: 200px; }
    .readonly {
      padding: 6px;
      background: transparent;
      border: 1px dashed var(--border);
      border-radius: 3px;
      font-size: 12px;
    }
    .actions { display: flex; gap: var(--gap); flex-wrap: wrap; }
    button {
      padding: 6px 10px;
      background: var(--btn-bg);
      color: var(--btn-fg);
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }
    button.secondary {
      background: transparent;
      color: var(--accent);
      border: 1px solid var(--border);
    }
    small.hint { opacity: 0.7; font-size: 11px; }
  </style>
</head>
<body>
  <div class="contextbar">
    <div class="kvrow"><strong>Account:</strong> <span id="accountValue">Not Authenticated</span></div>
    <div class="kvrow"><strong>Project:</strong> <span id="projectValue">(no project)</span></div>
  </div>

  <div class="section">
    <h2>Agent Config</h2>
    <div class="row">
      <div class="col">
        <label for="agentName">Name</label>
        <input id="agentName" type="text" placeholder="Agent name" />
      </div>
      <div class="col">
        <label for="agentModel">Model</label>
        <select id="agentModel">
          <option value="gemini-2.5-pro">gemini-2.5-pro</option>
          <option value="gemini-2.5-flash">gemini-2.5-flash</option>
          <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
        </select>
      </div>
    </div>
    <label for="agentDesc">Description</label>
    <textarea id="agentDesc" placeholder="Short description of the agent"></textarea>
    <div class="actions">
      <button id="saveBtn">Save</button>
      <button id="deployBtn">Deploy</button>
      <button id="stopBtn" class="secondary" disabled>Stop</button>
      <button id="genCardBtn" class="secondary">Generate Agent Card</button>
      <button id="checkBtn" class="secondary">Check Compatibility</button>
    </div>
  </div>

  <div class="section">
    <h2>Deployment</h2>
    <div class="row">
      <div class="col">
        <label>Status</label>
        <div id="deployStatus" class="readonly">Not Deployed</div>
      </div>
      <div class="col">
        <label>Engine ID</label>
        <div class="readonly"><span id="engineIdValue">-</span></div>
      </div>
    </div>
    <div class="row">
      <div class="col">
        <label for="moduleInput">Module</label>
        <input id="moduleInput" type="text" placeholder="e.g. pkg.agent" />
      </div>
      <div class="col">
        <label for="symbolInput">Symbol</label>
        <input id="symbolInput" type="text" placeholder="agent" />
      </div>
      <div class="col" style="align-self: end;">
        <button id="saveModuleSymbolBtn" class="secondary">Save</button>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Memory Bank</h2>
    <div class="row">
      <div class="col">
        <label>Connection</label>
        <div id="memoryStatus" class="readonly">None</div>
      </div>
      <div class="col" style="align-self: end;">
        <button id="attachEngineBtn" class="secondary">Attach Existing Engine…</button>
        <button id="openMemoryBtn" class="secondary">Open Memory Console</button>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>A2A</h2>
    <div class="row">
      <div class="col">
        <label>Status</label>
        <div id="a2aStatus" class="readonly">Agent Card: Not found • Skills: 0</div>
      </div>
    </div>
    <small class="hint">Workspace project/region apply. Deployment uses Python helper scripts.</small>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function byId(id) { return document.getElementById(id); }

    function updateContext(account, project) {
      byId('accountValue').textContent = account && account.trim().length ? account : 'Not Authenticated';
      byId('projectValue').textContent = project && project.trim().length ? project : '(no project)';
    }

    function setDeployment(engineId) {
      const stopBtn = byId('stopBtn');
      if (engineId && engineId.trim().length) {
        byId('deployStatus').textContent = 'Deployed';
        byId('engineIdValue').textContent = engineId;
        stopBtn.removeAttribute('disabled');
        byId('memoryStatus').textContent = 'Connected (Engine ' + engineId + ')';
      } else {
        byId('deployStatus').textContent = 'Not Deployed';
        byId('engineIdValue').textContent = '-';
        stopBtn.setAttribute('disabled', 'true');
        byId('memoryStatus').textContent = 'None';
      }
    }

    function fillForm(data) {
      byId('agentName').value = data?.name || '';
      byId('agentDesc').value = data?.description || '';
      const modelSel = byId('agentModel');
      if (data?.model) modelSel.value = data.model;

      setDeployment(data?.engineId || '');

      const hasCard = !!(data?.a2a?.hasCard);
      const skills = (data?.a2a?.skillsCount) || 0;
      byId('a2aStatus').textContent = 'Agent Card: ' + (hasCard ? 'Present' : 'Not found') + ' • Skills: ' + skills;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg?.type === 'init') {
        fillForm(msg.data);
        updateContext(msg.data?.account, msg.data?.project);
      } else if (msg?.type === 'context') {
        updateContext(msg.data?.account, msg.data?.project);
      } else if (msg?.type === 'deploymentComplete') {
        setDeployment(msg.data?.engineId || '');
      } else if (msg?.type === 'stopped') {
        setDeployment('');
      } else if (msg?.type === 'engineLinked') {
        setDeployment(msg.data?.engineId || '');
      } else if (msg?.type === 'deploymentVerified') {
        if (!msg.data?.engineIdValid) {
          setDeployment('');
        }
      } else if (msg?.type === 'a2aUpdated') {
        const hasCard = !!(msg.data?.hasCard);
        const skills = (msg.data?.skillsCount) || 0;
        byId('a2aStatus').textContent = 'Agent Card: ' + (hasCard ? 'Present' : 'Not found') + ' • Skills: ' + skills;
      }
    });

    function currentConfig() {
      return {
        name: byId('agentName').value.trim(),
        description: byId('agentDesc').value,
        model: byId('agentModel').value
      };
    }

    byId('saveBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'save', data: currentConfig() });
    });
    byId('deployBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'deploy' });
    });
    byId('stopBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'stop' });
    });
    byId('genCardBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'generateCard' });
    });
    byId('checkBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'checkCompatibility' });
    });
    byId('saveModuleSymbolBtn').addEventListener('click', () => {
      const moduleVal = byId('moduleInput').value.trim();
      const symbolVal = byId('symbolInput').value.trim() || 'agent';
      vscode.postMessage({ type: 'saveModuleSymbol', data: { module: moduleVal, symbol: symbolVal } });
    });
    byId('attachEngineBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'attachExistingEngine' });
    });
    byId('openMemoryBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'openMemoryConsole' });
    });

    // Request initialization from extension
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let i = 0; i < 16; i++) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}