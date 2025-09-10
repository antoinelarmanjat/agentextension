import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';

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
 
export function scanAndComplementAgents(workspaceRoot: string, extensionPath: string): Promise<AgentInfo[]> {
    return new Promise((resolve, reject) => {
        const requirementsPath = path.join(extensionPath, 'src', 'requirements.txt');
        const pipInstall = cp.spawn('python3', ['-m', 'pip', 'install', '-r', requirementsPath]);

        pipInstall.on('close', (pipCode) => {
            if (pipCode !== 0) {
                return reject(new Error(`pip install failed with code ${pipCode}`));
            }

            const pythonScriptPath = path.join(extensionPath, 'src', 'analysis.py');
            const pythonProcess = cp.spawn('python3', [pythonScriptPath], { cwd: workspaceRoot });

            let stdout = '';
            let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            stderr += data.toString();
        });

            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    console.error(`Python script exited with code ${code}`);
                    console.error(stderr);
                    return reject(new Error(`Python script failed with code ${code}: ${stderr}`));
                }

                try {
                    const nestedTreeRegex = /Nested tree for root_agent:([\s\S]*)/;
                    const match = stdout.match(nestedTreeRegex);
                    if (match && match[1]) {
                        const jsonOutput = match[1].trim();
                        const agentData = JSON.parse(jsonOutput);
                        // The output is a single root agent, but the tree provider expects an array.
                        resolve([agentData]);
                    } else {
                        console.error('Could not find nested tree in python script output.');
                        console.error('Full output:', stdout);
                        reject(new Error('Could not parse python script output.'));
                    }
                } catch (error) {
                    console.error('Error parsing JSON from python script:', error);
                    console.error('Raw stdout:', stdout);
                    reject(error);
                }
            });
        });
    });
}