import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface AgentReference {
    id: string;
    kind: 'agent' | 'tool' | 'ref';
    file: string;
    line_start: number;
    line_end: number;
    args: { [key: string]: any };
    ref?: string;
    resolved?: boolean;
}

export interface AgentInfo {
    id: string;
    kind: 'agent' | 'tool';
    file: string;
    line_start: number;
    line_end: number;
    args: {
        name?: string;
        model?: string;
        description?: string;
        instruction?: any;
        sub_agents?: AgentReference[];
        tools?: AgentReference[];
        agent_tools?: AgentReference[];
        [key: string]: any;
    };
}

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
                return detected;
            }
        }

        return 'python3';
    } catch {
        return 'python3';
    }
}
 
export async function scanAndComplementAgents(workspaceRoot: string, extensionPath: string): Promise<AgentInfo[]> {
    const pythonPath = await getPythonPath();
    console.log('[Agent Scanner] Using Python path:', pythonPath);
    console.log('[Agent Scanner] Workspace root:', workspaceRoot);
    console.log('[Agent Scanner] Extension path:', extensionPath);
    
    // Create an output channel for debugging
    const output = vscode.window.createOutputChannel('Agent Scanner Debug');
    output.show();
    output.appendLine(`[Agent Scanner] Starting scan with Python: ${pythonPath}`);
    output.appendLine(`[Agent Scanner] Workspace: ${workspaceRoot}`);
    
    return new Promise((resolve, reject) => {
        const requirementsPath = path.join(extensionPath, 'src', 'requirements.txt');
        output.appendLine(`[Agent Scanner] Installing requirements from: ${requirementsPath}`);
        
        // Skip pip install and run directly to see if libcst is already installed
        function runAnalysisScript() {
            const pythonScriptPath = path.join(extensionPath, 'src', 'analysis.py');
            output.appendLine(`[Agent Scanner] Running analysis script: ${pythonScriptPath}`);
            
            const pythonProcess = cp.spawn(pythonPath, [pythonScriptPath], { cwd: workspaceRoot });

            let stdout = '';
            let stderr = '';

            pythonProcess.stdout.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                output.appendLine(`[STDOUT]: ${chunk}`);
            });

            pythonProcess.stderr.on('data', (data) => {
                const chunk = data.toString();
                stderr += chunk;
                output.appendLine(`[STDERR]: ${chunk}`);
            });

            pythonProcess.on('error', (error) => {
                output.appendLine(`[ERROR] Failed to start Python process: ${error.message}`);
                console.error('Failed to start Python process:', error);
                reject(new Error(`Failed to start Python process: ${error.message}`));
            });

            pythonProcess.on('close', (code) => {
                output.appendLine(`[Agent Scanner] Python process exited with code: ${code}`);
                
                if (code !== 0) {
                    console.error(`Python script exited with code ${code}`);
                    console.error('stderr:', stderr);
                    output.appendLine(`[ERROR] Python script failed. Check stderr above.`);
                    
                    // If libcst is not installed, provide helpful message
                    if (stderr.includes('ModuleNotFoundError') && stderr.includes('libcst')) {
                        output.appendLine('[ERROR] libcst module not found. Installing...');
                        // Try to install libcst
                        const pipInstall = cp.spawn(pythonPath, ['-m', 'pip', 'install', 'libcst'], { cwd: workspaceRoot });
                        
                        pipInstall.stdout.on('data', (data) => {
                            output.appendLine(`[PIP STDOUT]: ${data.toString()}`);
                        });
                        
                        pipInstall.stderr.on('data', (data) => {
                            output.appendLine(`[PIP STDERR]: ${data.toString()}`);
                        });
                        
                        pipInstall.on('close', (pipCode) => {
                            if (pipCode === 0) {
                                output.appendLine('[Agent Scanner] libcst installed successfully. Retrying analysis...');
                                // Retry analysis after installing
                                runAnalysisScript();
                            } else {
                                output.appendLine('[ERROR] Failed to install libcst');
                                reject(new Error(`Failed to install libcst: ${stderr}`));
                            }
                        });
                        
                        pipInstall.on('error', (error) => {
                            output.appendLine(`[ERROR] Failed to run pip: ${error.message}`);
                            reject(new Error(`Failed to run pip: ${error.message}`));
                        });
                        
                        return; // Exit early, will retry after install
                    }
                    
                    return reject(new Error(`Python script failed with code ${code}: ${stderr}`));
                }

                output.appendLine('[Agent Scanner] Parsing output...');
                output.appendLine(`[Agent Scanner] Full stdout length: ${stdout.length} chars`);

                try {
                    // First try to parse the entire output as JSON (in case the format changed)
                    try {
                        const agents = JSON.parse(stdout);
                        if (Array.isArray(agents)) {
                            output.appendLine(`[Agent Scanner] Found ${agents.length} agents (direct JSON array)`);
                            resolve(agents);
                            return;
                        }
                        if (agents && typeof agents === 'object') {
                            output.appendLine('[Agent Scanner] Found single agent (direct JSON object)');
                            resolve([agents]);
                            return;
                        }
                    } catch {
                        // Not direct JSON, try regex approach
                    }

                    // Try the nested tree regex approach
                    const nestedTreeRegex = /Nested tree for root_agent:([\s\S]*)/;
                    const match = stdout.match(nestedTreeRegex);
                    if (match && match[1]) {
                        const jsonOutput = match[1].trim();
                        output.appendLine(`[Agent Scanner] Found nested tree output, parsing JSON...`);
                        const agentData = JSON.parse(jsonOutput);
                        output.appendLine(`[Agent Scanner] Successfully parsed agent data`);
                        // The output is a single root agent, but the tree provider expects an array.
                        resolve([agentData]);
                    } else {
                        // Try to find flat registry
                        const flatRegistryRegex = /Flat registry:([\s\S]*?)(?:Nested tree|$)/;
                        const flatMatch = stdout.match(flatRegistryRegex);
                        if (flatMatch && flatMatch[1]) {
                            const flatJson = flatMatch[1].trim();
                            const registry = JSON.parse(flatJson);
                            if (registry.agents) {
                                const agentsList = Object.values(registry.agents) as AgentInfo[];
                                output.appendLine(`[Agent Scanner] Found ${agentsList.length} agents from flat registry`);
                                resolve(agentsList);
                                return;
                            }
                        }
                        
                        output.appendLine('[WARNING] Could not find expected output format');
                        output.appendLine('[WARNING] Looking for any Python files with Agent definitions...');
                        
                        // Return empty array instead of rejecting, so the tree still loads
                        resolve([]);
                    }
                } catch (error) {
                    console.error('Error parsing JSON from python script:', error);
                    output.appendLine(`[ERROR] Failed to parse JSON: ${error}`);
                    output.appendLine('[ERROR] Raw stdout (first 500 chars):');
                    output.appendLine(stdout.substring(0, 500));
                    
                    // Return empty array instead of rejecting
                    resolve([]);
                }
            });
        }
        
        // Try running the analysis directly first
        runAnalysisScript();
    });
}