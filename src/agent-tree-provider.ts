import * as vscode from 'vscode';
import { scanAndComplementAgents } from './new-agent-scanner';
import type { AgentInfo, AgentReference } from './new-agent-scanner';
import * as path from 'path';

export class AgentTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private rootAgents: AgentInfo[] = [];

  constructor(private workspaceRoot: string, private context: vscode.ExtensionContext) {
    this.refresh();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage('No workspace root found.');
      return Promise.resolve([]);
    }

    if (element instanceof SubAgentsTreeItem) {
        return Promise.resolve(element.subAgents.map(agent => {
            if ('variable' in agent) { // It's an AgentInfo
                return new AgentVarTreeItem(agent.variable, agent, this.context, agent.file, this.workspaceRoot);
            } else { // It's an AgentReference
                const foundAgent = this.findAgentByName(agent.name);
                return new AgentVarTreeItem(agent.name, foundAgent, this.context, agent.file, this.workspaceRoot);
            }
        }));
    } else if (element instanceof AgentToolsTreeItem) {
        return Promise.resolve(element.subAgents.map(agent => {
            if ('variable' in agent) { // It's an AgentInfo
                return new AgentVarTreeItem(agent.variable, agent, this.context, agent.file, this.workspaceRoot);
            } else { // It's an AgentReference
                return new AgentVarTreeItem(agent.name, undefined, this.context, agent.file, this.workspaceRoot);
            }
        }));
    } else if (element instanceof AgentVarTreeItem) {
        const agent = element.agentInfo;
        if (!agent) {
            return Promise.resolve([new vscode.TreeItem('Agent not found')]);
        }
        const properties = Object.keys(agent)
            .filter(key => 
                key !== 'sub_agents' && 
                key !== 'agent_tools' && 
                key !== 'tools' && 
                key !== 'variable' && 
                key !== 'file' && 
                key !== 'line_number' && 
                key !== 'include_contents'
            )
            .map(key => {
                if (key === 'name') {
                    const item = new vscode.TreeItem(`${key}: ${agent[key as keyof AgentInfo]}`);
                    item.iconPath = new vscode.ThemeIcon('symbol-field', new vscode.ThemeColor('charts.blue'));
                    item.command = {
                        command: 'agent-inspector.findAgent',
                        title: 'Find Agent',
                        arguments: [path.relative(this.workspaceRoot, element.filePath), element.varName]
                    };
                    return item;
                }
                const item = new vscode.TreeItem(`${key}: ${agent[key as keyof AgentInfo]}`);
                switch (key) {
                    case 'type':
                        item.iconPath = new vscode.ThemeIcon('symbol-class', new vscode.ThemeColor('charts.green'));
                        break;
                    case 'model':
                        item.iconPath = new vscode.ThemeIcon('symbol-misc', new vscode.ThemeColor('charts.orange'));
                        break;
                    case 'instruction':
                        item.iconPath = new vscode.ThemeIcon('symbol-text', new vscode.ThemeColor('charts.purple'));
                        break;
                    case 'description':
                        item.iconPath = new vscode.ThemeIcon('note');
                        break;
                    case 'output_key':
                        item.iconPath = new vscode.ThemeIcon('key');
                        break;
                }
                return item;
            })
        
        const children: vscode.TreeItem[] = [...properties];
        if (agent.tools && agent.tools.length > 0) {
            children.push(new ToolsTreeItem('tools', agent.tools.map((t: AgentReference) => t.name).filter(name => name !== undefined) as string[], element.filePath));
        }

        if (agent.sub_agents && agent.sub_agents.length > 0) {
            const subAgentsNode = new SubAgentsTreeItem('sub_agents', agent.sub_agents as (AgentInfo | { name: string, file: string })[], this.context, element.filePath);
            children.push(subAgentsNode);
        }

        if (agent.agent_tools && agent.agent_tools.length > 0) {
            const agentToolsNode = new AgentToolsTreeItem('agent_tools', agent.agent_tools as (AgentInfo | { name: string, file: string })[], this.context, element.filePath, new vscode.ThemeIcon('robot'));
            children.push(agentToolsNode);
        }

        return Promise.resolve(children);

    } else if (element instanceof ToolsTreeItem) {
        return Promise.resolve(element.toolNames.map(toolName => new ToolTreeItem(toolName, element.filePath)));
    } else {
      // Root level
      return Promise.resolve(this.rootAgents.map(agent => new AgentVarTreeItem(agent.variable, agent, this.context, agent.file, this.workspaceRoot)));
    }

    return Promise.resolve([]);
  }

  async refresh(): Promise<void> {
    this.rootAgents = [];
    this._onDidChangeTreeData.fire();
    if (this.workspaceRoot) {
        try {
            this.rootAgents = await scanAndComplementAgents(this.workspaceRoot);
        } catch (error) {
            console.error('Error scanning and complementing agents:', error);
            this.rootAgents = [];
        }
    }
    this._onDidChangeTreeData.fire();
  }

  public getRootAgents(): AgentInfo[] {
    return this.rootAgents;
  }

  private findAgentByName(name: string): AgentInfo | undefined {
    const findIn = (agents: AgentInfo[]): AgentInfo | undefined => {
        for (const agent of agents) {
            if (agent.name === name) {
                return agent;
            }
            if (agent.sub_agents) {
                const found = findIn(agent.sub_agents as AgentInfo[]);
                if (found) {
                    return found;
                }
            }
        }
        return undefined;
    };
    return findIn(this.rootAgents);
  }
}



class AgentVarTreeItem extends vscode.TreeItem {
    constructor(
        public readonly varName: string,
        public readonly agentInfo: AgentInfo | undefined,
        private readonly context: vscode.ExtensionContext,
        public readonly filePath: string,
        private readonly workspaceRoot: string,
    ) {
        super(agentInfo?.name || varName, agentInfo ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.id = this.varName;
        this.iconPath = new vscode.ThemeIcon('robot');
        this.command = {
            command: 'agent-inspector.findAgent',
            title: 'Find Agent',
            arguments: [path.relative(this.workspaceRoot, this.filePath), this.varName]
        };
        this.contextValue = 'agentItem';
    }
}

class SubAgentsTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly subAgents: (AgentInfo | { name: string, file: string })[],
        private readonly context: vscode.ExtensionContext,
        public readonly filePath: string,
        iconPath?: vscode.ThemeIcon
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = iconPath || new vscode.ThemeIcon('folder');
        this.contextValue = this.label;
    }
}

class ToolsTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly toolNames: string[],
        public readonly filePath: string,
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('tools');
        this.contextValue = this.label;
    }
}

class ToolTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly filePath: string,
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('tool');
        this.command = {
            command: 'agent-inspector.findTool',
            title: 'Find Tool',
            arguments: [path.resolve(this.filePath), this.label]
        };
    }
}

class AgentToolsTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly subAgents: (AgentInfo | { name: string, file: string })[],
        private readonly context: vscode.ExtensionContext,
        public readonly filePath: string,
        iconPath?: vscode.ThemeIcon
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = iconPath || new vscode.ThemeIcon('folder');
        this.contextValue = this.label;
    }
}

