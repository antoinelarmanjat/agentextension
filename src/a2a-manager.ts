import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function generateAgentCard(context: vscode.ExtensionContext): Promise<{ hasCard: boolean; skillsCount: number; filePath: string }> {
  const wsFolders = vscode.workspace.workspaceFolders;
  if (!wsFolders || wsFolders.length === 0) {
    throw new Error('No workspace folder found.');
  }
  const root = wsFolders[0].uri.fsPath;

  const active = context.workspaceState.get('agentConfigurator.activeAgent') as { name: string; path?: string } | undefined;
  const agentName = active?.name?.trim() || '';
  const configs = (context.workspaceState.get('agentConfigurator.agentConfigs') as Record<string, { name: string; description: string; model: string }>) || {};
  const cfg = (agentName && configs[agentName]) || { name: agentName || 'Unnamed Agent', description: '', model: 'gemini-2.0' };

  const card = {
    name: cfg.name || agentName || 'Unnamed Agent',
    description: cfg.description || '',
    capabilities: { streaming: true },
    skills: [] as unknown[]
  };

  const destDir = path.join(root, '.well-known');
  const destFile = path.join(destDir, 'agent.json');

  await fs.promises.mkdir(destDir, { recursive: true });
  await fs.promises.writeFile(destFile, JSON.stringify(card, null, 2), 'utf8');

  return { hasCard: true, skillsCount: card.skills.length, filePath: destFile };
}

export async function checkA2A(context: vscode.ExtensionContext): Promise<{ hasCard: boolean; skillsCount: number; filePath?: string }> {
  // mark unused parameter to satisfy lint rules while keeping the required signature
  void context;

  const wsFolders = vscode.workspace.workspaceFolders;
  if (!wsFolders || wsFolders.length === 0) {
    return { hasCard: false, skillsCount: 0 };
  }
  const root = wsFolders[0].uri.fsPath;
  const file = path.join(root, '.well-known', 'agent.json');

  try {
    const txt = await fs.promises.readFile(file, 'utf8');
    const obj = JSON.parse(txt);
    const skills = Array.isArray(obj.skills) ? obj.skills.length : 0;
    return { hasCard: true, skillsCount: skills, filePath: file };
  } catch {
    return { hasCard: false, skillsCount: 0 };
  }
}