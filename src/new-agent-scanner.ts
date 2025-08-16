import * as fs from 'fs';
import * as path from 'path';

export interface AgentReference {
    name?: string | null;
    file?: string | null;
    line_number?: number;
    type?: string | null;
}

export interface AgentInfo {
    file: string;
    variable: string;
    line_number?: number;
    name?: string;
    type?: string;
    description?: string;
    instruction?: string;
    sub_agents?: AgentReference[];
    tools?: AgentReference[];
    agent_tools?: AgentReference[];
    before_agent_callback?: string;
    model?: string;
    agentBlock?: string;
    debugInfo?: {
        agentBlock?: string;
        toolsMatch: any,
        toolsContent?: string | null,
        toolsList?: string[] | null,
        toolsRegex?: any
    };
}

function findDefinition(name: string, allAgentFiles: string[]): AgentReference | null {
    for (const file of allAgentFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            // Regex to find variable assignments for different agent types
            const definitionRegex = new RegExp(String.raw`\b(${name})\s*=\s*(Agent|SequentialAgent|LlmAgent|ParallelAgent|LoopAgent|BaseAgent|Tool)\(`, 'g');
            const match = definitionRegex.exec(lines[i]);
            if (match) {
                return { name, file, line_number: i + 1, type: match[2] };
            }
        }
    }
    return null;
}

function getAllAgentFiles(directory: string): string[] {
    const results: string[] = [];
    try {
        const files = fs.readdirSync(directory, { withFileTypes: true });
        for (const file of files) {
            const fullPath = path.join(directory, file.name);
            if (file.isDirectory()) {
                results.push(...getAllAgentFiles(fullPath));
            } else if (file.name.endsWith('.py')) {
                results.push(fullPath);
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${directory}:`, error);
    }
    return results;
}

export function findRootAgents(directory: string): string {
    const results: AgentInfo[] = [];
    const allAgentFiles = getAllAgentFiles(directory);

    for (const fullPath of allAgentFiles) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const agentRegex = new RegExp(String.raw`\broot_agent\s*=\s*(Agent|SequentialAgent|LlmAgent|ParallelAgent|LoopAgent|BaseAgent)\(`, 'g');
        let match;
        while ((match = agentRegex.exec(content)) !== null) {
            let openParens = 1;
            let endIndex = match.index + match[0].length;
            while (openParens > 0 && endIndex < content.length) {
                if (content[endIndex] === '(') {
                    openParens++;
                } else if (content[endIndex] === ')') {
                    openParens--;
                }
                endIndex++;
            }
            const agentBlock = content.substring(match.index, endIndex);

            const lines = content.substring(0, match.index).split('\n');
            const lineNumber = lines.length;

            const info: AgentInfo = { file: fullPath, variable: 'root_agent', line_number: lineNumber, type: match[1], agentBlock: agentBlock };

            const nameMatch = agentBlock.match(/name="([^"]+)"/);
            if (nameMatch) info.name = nameMatch[1];

            const modelMatch = agentBlock.match(/model="([^"]+)"/);
            if (modelMatch) info.model = modelMatch[1];

            const descriptionMatch = agentBlock.match(/description="""([\s\S]+?)"""/);
            if (descriptionMatch) {
                info.description = descriptionMatch[1].trim();
            } else {
                const descriptionSingleLineMatch = agentBlock.match(/description="([^"]+)"/);
                if (descriptionSingleLineMatch) info.description = descriptionSingleLineMatch[1];
            }

            const instructionMatch = agentBlock.match(/instruction=([^,)]+)/);
            if (instructionMatch) info.instruction = instructionMatch[1].trim();

            const subAgentsMatch = agentBlock.match(/sub_agents=\[([\s\S]+?)\]/);
            if (subAgentsMatch && subAgentsMatch[1]) {
                 const subAgentNames = subAgentsMatch[1].split(',').map(s => s.trim().replace(/,$/, '')).filter(s => s);
                 info.sub_agents = subAgentNames.map(name => {
                    const def = findDefinition(name, allAgentFiles);
                    return def ? def : { name: name, file: null, line_number: undefined, type: 'Agent' };
                 });
            }

            const toolsMatch = agentBlock.match(/tools=\[([\s\S]*?)\]/);
            if (toolsMatch && toolsMatch[1]) {
                const toolsContent = toolsMatch[1];
                info.tools = [];
                info.agent_tools = [];

                const itemRegex = /AgentTool\(agent=([a-zA-Z0-9_]+)\)|([a-zA-Z0-9_]+)/g;
                let itemMatch;

                while ((itemMatch = itemRegex.exec(toolsContent)) !== null) {
                    if (itemMatch[1]) {
                        const agentName = itemMatch[1].trim();
                        const agentDefinition = findDefinition(agentName, allAgentFiles);
                        if (agentDefinition) {
                            info.agent_tools.push(agentDefinition);
                        } else {
                            info.agent_tools.push({ name: agentName, file: null, line_number: undefined, type: 'Agent' });
                        }
                    } else if (itemMatch[2]) {
                        const toolName = itemMatch[2].trim();
                        const toolDefinition = findDefinition(toolName, allAgentFiles);
                        if (toolDefinition) {
                            info.tools.push(toolDefinition);
                        } else {
                            info.tools.push({ name: toolName, file: null, line_number: undefined, type: 'Tool' });
                        }
                    }
                }
            }

            const callbackMatch = agentBlock.match(/before_agent_callback=([^,)]+)/);
            if (callbackMatch) info.before_agent_callback = callbackMatch[1].trim();

            results.push(info);
        }
    }

    return JSON.stringify(results, null, 4);
}

function findAgent(agentName: string, filePath: string, allAgentFiles: string[]): string | null {
    const content = fs.readFileSync(filePath, 'utf-8');
    const agentRegex = new RegExp(String.raw`\b${agentName}\s*=\s*(Agent|SequentialAgent|LlmAgent|ParallelAgent|LoopAgent|BaseAgent|Tool)\(`, 'g');
    let match;
    if ((match = agentRegex.exec(content)) !== null) {
        let openParens = 1;
        let endIndex = match.index + match[0].length;
        while (openParens > 0 && endIndex < content.length) {
            if (content[endIndex] === '(') {
                openParens++;
            } else if (content[endIndex] === ')') {
                openParens--;
            }
            endIndex++;
        }
        const agentBlock = content.substring(match.index, endIndex);
        const lines = content.substring(0, match.index).split('\n');
        const lineNumber = lines.length;
        const info: AgentInfo = { file: filePath, variable: agentName, line_number: lineNumber, type: match[1], agentBlock: agentBlock };

        const nameMatch = agentBlock.match(/name="([^"]+)"/);
        if (nameMatch) info.name = nameMatch[1];

        const modelMatch = agentBlock.match(/model="([^"]+)"/);
        if (modelMatch) info.model = modelMatch[1];

        const descriptionMatch = agentBlock.match(/description="""([\s\S]+?)"""/);
        if (descriptionMatch) {
            info.description = descriptionMatch[1].trim();
        }

        const instructionMatch = agentBlock.match(/instruction=([^,)]+)/);
        if (instructionMatch) info.instruction = instructionMatch[1].trim();

        const subAgentsMatch = agentBlock.match(/sub_agents=\[([\s\S]+?)\]/);
        if (subAgentsMatch && subAgentsMatch[1]) {
            const subAgentNames = subAgentsMatch[1].split(',').map(s => s.trim().replace(/,$/, '')).filter(s => s);
            info.sub_agents = subAgentNames.map(name => {
                const def = findDefinition(name, allAgentFiles);
                return def ? def : { name: name, file: null, line_number: undefined, type: 'Agent' };
            });
        }

        const toolsMatch = agentBlock.match(/tools=\[([\s\S]*?)\]/);
        if (toolsMatch && toolsMatch[1]) {
            const toolsContent = toolsMatch[1];
            info.tools = [];
            info.agent_tools = [];

            const itemRegex = /AgentTool\(agent=([a-zA-Z0-9_]+)\)|([a-zA-Z0-9_]+)/g;
            let itemMatch;

            while ((itemMatch = itemRegex.exec(toolsContent)) !== null) {
                if (itemMatch[1]) {
                    const agentName = itemMatch[1].trim();
                    const agentDefinition = findDefinition(agentName, allAgentFiles);
                    if (agentDefinition) {
                        info.agent_tools.push(agentDefinition);
                    } else {
                        info.agent_tools.push({ name: agentName, file: null, line_number: undefined, type: 'Agent' });
                    }
                } else if (itemMatch[2]) {
                    const toolName = itemMatch[2].trim();
                    const toolDefinition = findDefinition(toolName, allAgentFiles);
                    if (toolDefinition) {
                        info.tools.push(toolDefinition);
                    } else {
                        info.tools.push({ name: toolName, file: null, line_number: undefined, type: 'Tool' });
                    }
                }
            }
        }

        const callbackMatch = agentBlock.match(/before_agent_callback=([^,)]+)/);
        if (callbackMatch) info.before_agent_callback = callbackMatch[1].trim();

        return JSON.stringify(info, null, 4);
    }

    return null;
}

export async function scanAndComplementAgents(directory: string): Promise<any[]> {
    const rootAgentsString = findRootAgents(directory);
    const rootAgents: AgentInfo[] = JSON.parse(rootAgentsString);
    const allAgentFiles = getAllAgentFiles(directory);

    const complementedRootAgents: AgentInfo[] = [];

    for (const rootAgent of rootAgents) {
        const complementedRootAgent = { ...rootAgent };

        if (complementedRootAgent.sub_agents) {
            complementedRootAgent.sub_agents = complementedRootAgent.sub_agents.map(subAgent => {
                const agentDetailsString = (subAgent.name && subAgent.file) ? findAgent(subAgent.name, subAgent.file, allAgentFiles) : null;
                if (agentDetailsString) {
                    const agentDetails = JSON.parse(agentDetailsString);
                    return { ...subAgent, ...agentDetails };
                }
                return subAgent;
            });
        }

        if (complementedRootAgent.tools) {
            complementedRootAgent.tools = complementedRootAgent.tools.map(tool => {
                const toolDetailsString = (tool.name && tool.file) ? findAgent(tool.name, tool.file, allAgentFiles) : null;
                if (toolDetailsString) {
                    const toolDetails = JSON.parse(toolDetailsString);
                    return { ...tool, ...toolDetails };
                }
                return tool;
            });
        }

        if (complementedRootAgent.agent_tools) {
            complementedRootAgent.agent_tools = complementedRootAgent.agent_tools.map(agentTool => {
                const agentToolDetailsString = (agentTool.name && agentTool.file) ? findAgent(agentTool.name, agentTool.file, allAgentFiles) : null;
                if (agentToolDetailsString) {
                    const agentToolDetails = JSON.parse(agentToolDetailsString);
                    return { ...agentTool, ...agentToolDetails };
                }
                return agentTool;
            });
        }

        complementedRootAgents.push(complementedRootAgent);
    }
    
    // Recursively remove 'agentBlock' from the final objects
    const cleanObject = (obj: any): any => {
        if (Array.isArray(obj)) {
            return obj.map(cleanObject);
        }
        if (obj !== null && typeof obj === 'object') {
            delete obj.agentBlock;

            for (const key in obj) {
                obj[key] = cleanObject(obj[key]);
            }
        }
        return obj;
    };
    
    return cleanObject(complementedRootAgents);
}

if (require.main === module) {
    const directory = '/Users/larmanjat/agentextension/travel_concierge';
    
    scanAndComplementAgents(directory).then(result => {
        console.log(JSON.stringify(result, null, 2));
    }).catch(error => {
        console.error("Error during scan and complement:", error);
    });
}

