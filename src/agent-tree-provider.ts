import * as vscode from 'vscode';
import { scanAndComplementAgents } from './agent-scanner';
import type { AgentInfo, AgentReference } from './agent-scanner';
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
            if ('ref' in agent) { // It's an AgentReference
                const foundAgent = this.findAgentByName(agent.ref || agent.id);
                return new AgentVarTreeItem(agent.ref || agent.id, foundAgent, this.context, agent.file || '', this.workspaceRoot);
            } else { // It's an AgentInfo
                return new AgentVarTreeItem(agent.id, agent as AgentInfo, this.context, agent.file, this.workspaceRoot);
            }
        }));
    } else if (element instanceof AgentToolsTreeItem) {
        return Promise.resolve(element.subAgents.map(agent => {
            if ('ref' in agent) { // It's an AgentReference
                const foundAgent = this.findAgentByName(agent.ref || agent.id);
                return new AgentVarTreeItem(agent.ref || agent.id, foundAgent, this.context, agent.file || '', this.workspaceRoot);
            } else { // It's an AgentInfo
                return new AgentVarTreeItem(agent.id, agent as AgentInfo, this.context, agent.file, this.workspaceRoot);
            }
        }));
    } else if (element instanceof AgentVarTreeItem) {
        const agent = element.agentInfo;
        if (!agent) {
            return Promise.resolve([new vscode.TreeItem('Agent not found')]);
        }
        const properties = Object.keys(agent.args)
            .filter(key => key !== 'sub_agents' && key !== 'tools' && key !== 'agent_tools')
            .map(key => {
                const value = agent.args[key as keyof typeof agent.args];
                let displayValue: string;
                if (typeof value === 'object' && value !== null) {
                    if ('kind' in value && value.kind === 'ref' && 'ref' in value) {
                        displayValue = `${value.ref}`;
                        if ('resolved' in value && value.resolved === false) {
                            displayValue += ' (unresolved)';
                        }
                    } else {
                        displayValue = JSON.stringify(value);
                    }
                } else {
                    displayValue = String(value);
                }
                const item = new vscode.TreeItem(`${key}: ${displayValue}`);
                if (key === 'model') {
                    item.iconPath = new vscode.ThemeIcon('chip');
                } else if (key === 'instruction') {
                    item.iconPath = new vscode.ThemeIcon('note');
                } else if (key === 'description') {
                    item.iconPath = new vscode.ThemeIcon('book');
                } else if (key === 'name') {
                    item.iconPath = new vscode.ThemeIcon('tag');
                }
                return item;
            });
        
        const children: vscode.TreeItem[] = [...properties];
        if (agent.args.tools && agent.args.tools.length > 0) {
            children.push(new ToolsTreeItem('tools', agent.args.tools.map((t: any) => t.id || t.ref).filter((name: string | undefined) => name !== undefined) as string[], element.filePath));
        }

        if (agent.args.sub_agents && agent.args.sub_agents.length > 0) {
            const subAgentsNode = new SubAgentsTreeItem('sub_agents', agent.args.sub_agents as (AgentInfo | AgentReference)[], this.context, element.filePath);
            children.push(subAgentsNode);
        }

        if (agent.args.agent_tools && agent.args.agent_tools.length > 0) {
            const agentToolsNode = new AgentToolsTreeItem('agent_tools', agent.args.agent_tools as (AgentInfo | AgentReference)[], this.context, element.filePath, new vscode.ThemeIcon('robot'));
            children.push(agentToolsNode);
        }

        return Promise.resolve(children);

    } else if (element instanceof ToolsTreeItem) {
        return Promise.resolve(element.toolNames.map(toolName => new ToolTreeItem(toolName, element.filePath)));
    } else {
      // Root level
      return Promise.resolve(this.rootAgents.map(agent => new AgentVarTreeItem(agent.id, agent, this.context, agent.file, this.workspaceRoot)));
    }

    return Promise.resolve([]);
  }

  async refresh(): Promise<void> {
    this.rootAgents = [];
    this._onDidChangeTreeData.fire();
    if (this.workspaceRoot) {
        try {
            this.rootAgents = await scanAndComplementAgents(this.workspaceRoot, this.context.extensionPath);
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
    const findIn = (agents: (AgentInfo | AgentReference)[]): AgentInfo | undefined => {
        for (const item of agents) {
            if (item.kind !== 'ref') {
                // It's an AgentInfo
                if (item.id === name) {
                    return item as AgentInfo;
                }
                // Recurse
                const subItems: (AgentInfo | AgentReference)[] = [];
                if (item.args.sub_agents) subItems.push(...item.args.sub_agents);
                if (item.args.tools) subItems.push(...item.args.tools);
                if (item.args.agent_tools) subItems.push(...item.args.agent_tools);
                
                const found = findIn(subItems);
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
        const label = agentInfo ? (agentInfo.args.name || varName) : `${varName} (unknown)`;
        super(label, agentInfo ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.id = this.varName;
        this.iconPath = new vscode.ThemeIcon('robot');
        this.command = {
            command: 'agent-inspector.findAgent',
            title: 'Find Agent',
            arguments: [this.filePath, this.varName]
        };
        this.contextValue = 'agentItem';
    }
}

class SubAgentsTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly subAgents: (AgentInfo | AgentReference)[],
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
            arguments: [this.filePath, this.label]
        };
    }
}

class AgentToolsTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly subAgents: (AgentInfo | AgentReference)[],
        private readonly context: vscode.ExtensionContext,
        public readonly filePath: string,
        iconPath?: vscode.ThemeIcon
    ) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = iconPath || new vscode.ThemeIcon('folder');
        this.contextValue = this.label;
    }
}

