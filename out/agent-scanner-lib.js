"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHierarchicalStructure = exports.buildCrossFileHierarchy = exports.resolveAgentHierarchy = exports.findImportedAgents = exports.getScanSummary = exports.getFilesWithAgents = exports.scanSingleFile = exports.scanDirectory = exports.agentScanner = void 0;
const fs = require("fs");
const path = require("path");
const glob_1 = require("glob");
class AgentScannerLib {
    agentPatterns = {
        llmAgent: /(\w+)\s*=\s*LlmAgent\s*\(\s*([\s\S]*?)\s*\)/g,
        sequentialAgent: /(\w+)\s*=\s*SequentialAgent\s*\(\s*([\s\S]*?)\s*\)/g,
        loopAgent: /(\w+)\s*=\s*LoopAgent\s*\(\s*([\s\S]*?)\s*\)/g,
        parallelAgent: /(\w+)\s*=\s*ParallelAgent\s*\(\s*([\s\S]*?)\s*\)/g,
        agent: /(\w+)\s*=\s*Agent\s*\(\s*([\s\S]*?)\s*\)/g
    };
    findAgentDefinition(content, agentType) {
        const pattern = this.agentPatterns[agentType];
        const results = [];
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const name = match[1];
            let args = match[2];
            // Handle nested parentheses by finding the correct closing parenthesis
            let parenCount = 1;
            const startIndex = content.indexOf('(', match.index) + 1;
            let i = startIndex; // Start after the opening parenthesis
            while (parenCount > 0 && i < content.length) {
                const char = content[i];
                if (char === '(') {
                    parenCount++;
                }
                else if (char === ')') {
                    parenCount--;
                }
                i++;
            }
            if (parenCount === 0) {
                // Extract the complete arguments including nested parentheses
                args = content.substring(startIndex, i - 1); // -1 because we incremented i at the end
                results.push({ name, args });
            }
        }
        return results;
    }
    parseAgentArguments(args) {
        const result = {};
        // Extract name
        const nameMatch = args.match(/name\s*=\s*["']([^"']+)["']/);
        if (nameMatch) {
            result.name = nameMatch[1];
        }
        // Extract description
        const descMatch = args.match(/description\s*=\s*["']([^"']+)["']/);
        if (descMatch) {
            result.description = descMatch[1];
        }
        else {
            // Try multi-line description
            const descMatch2 = args.match(/description\s*=\s*["']{3}([\s\S]*?)["']{3}/);
            if (descMatch2) {
                result.description = descMatch2[1].trim();
            }
        }
        // Extract model
        const modelMatch = args.match(/model\s*=\s*([^,\s]+)/);
        if (modelMatch) {
            result.model = modelMatch[1];
        }
        // Extract instruction
        const instructionMatch = args.match(/instruction\s*=\s*["']{3}([\s\S]*?)["']{3}/);
        if (instructionMatch) {
            result.instruction = instructionMatch[1].trim();
        }
        else {
            // Try single quotes
            const instructionMatch2 = args.match(/instruction\s*=\s*["']([^"']+)["']/);
            if (instructionMatch2) {
                result.instruction = instructionMatch2[1];
            }
        }
        // Extract output_key
        const outputKeyMatch = args.match(/output_key\s*=\s*["']([^"']+)["']/);
        if (outputKeyMatch) {
            result.output_key = outputKeyMatch[1];
        }
        // Extract tools with better parsing for multi-line arrays
        const toolsMatch = args.match(/tools\s*=\s*\[([\s\S]*?)\]/);
        if (toolsMatch) {
            const toolsStr = toolsMatch[1];
            const tools = [];
            // Split by comma but handle nested parentheses and multi-line
            let currentTool = '';
            let parenCount = 0;
            for (let i = 0; i < toolsStr.length; i++) {
                const char = toolsStr[i];
                if (char === '(') {
                    parenCount++;
                }
                else if (char === ')') {
                    parenCount--;
                }
                if (char === ',' && parenCount === 0) {
                    // End of tool
                    const trimmedTool = currentTool.trim();
                    if (trimmedTool) {
                        tools.push(trimmedTool);
                    }
                    currentTool = '';
                }
                else {
                    currentTool += char;
                }
            }
            // Add the last tool
            const trimmedTool = currentTool.trim();
            if (trimmedTool) {
                tools.push(trimmedTool);
            }
            result.tools = tools;
        }
        // Extract sub_agents
        const subAgentsMatch = args.match(/sub_agents\s*=\s*\[([^\]]+)\]/);
        if (subAgentsMatch) {
            const subAgentsStr = subAgentsMatch[1];
            result.sub_agents = subAgentsStr.split(',').map(agent => agent.trim()).filter(agent => agent.length > 0);
        }
        // Extract max_iterations
        const maxIterationsMatch = args.match(/max_iterations\s*=\s*(\d+)/);
        if (maxIterationsMatch) {
            result.max_iterations = parseInt(maxIterationsMatch[1]);
        }
        // Extract include_contents
        const includeContentsMatch = args.match(/include_contents\s*=\s*["']([^"']+)["']/);
        if (includeContentsMatch) {
            result.include_contents = includeContentsMatch[1];
        }
        return result;
    }
    extractAgentTools(tools) {
        const regularTools = [];
        const agentTools = [];
        for (const tool of tools) {
            // Check if this is an AgentTool(agent=agent_name)
            const agentToolMatch = tool.match(/AgentTool\s*\(\s*agent\s*=\s*(\w+)\s*\)/);
            if (agentToolMatch) {
                agentTools.push(agentToolMatch[1]);
            }
            else {
                regularTools.push(tool);
            }
        }
        return { regularTools, agentTools };
    }
    scanFile(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const agents = {};
            let rootAgent = null;
            // Scan for all agent types
            for (const [agentType, pattern] of Object.entries(this.agentPatterns)) {
                const agentDefinitions = this.findAgentDefinition(content, agentType);
                for (const { name: variableName, args } of agentDefinitions) {
                    const agentInfo = {
                        name: variableName,
                        type: agentType.replace('Agent', ''),
                        ...this.parseAgentArguments(args)
                    };
                    // If this is the root_agent, mark it as root
                    if (variableName === 'root_agent') {
                        rootAgent = agentInfo;
                    }
                    agents[variableName] = agentInfo;
                }
            }
            // Process agents to extract agent tools and clean up references
            for (const agentName in agents) {
                const agent = agents[agentName];
                // Process sub_agents
                if (agent.sub_agents) {
                    agent.sub_agents = agent.sub_agents.map(subAgentName => {
                        // Remove any whitespace and comments
                        const cleanName = subAgentName.split('#')[0].trim();
                        return cleanName;
                    }).filter(name => name.length > 0); // Remove empty strings
                }
                // Process tools to extract agent tools
                if (agent.tools) {
                    const { regularTools, agentTools } = this.extractAgentTools(agent.tools);
                    agent.tools = regularTools;
                    if (agentTools.length > 0) {
                        agent.agent_tools = agentTools;
                        // Also add agent tools to sub_agents list
                        if (!agent.sub_agents) {
                            agent.sub_agents = [];
                        }
                        agent.sub_agents.push(...agentTools);
                    }
                }
            }
            const hasAgents = Object.keys(agents).length > 0;
            const agentCount = Object.keys(agents).length;
            return {
                filePath,
                fileName: path.basename(filePath),
                hierarchy: {
                    root: rootAgent || agents[Object.keys(agents)[0]] || { name: 'unknown', type: 'agent' },
                    agents
                },
                hasAgents,
                agentCount
            };
        }
        catch (error) {
            console.error(`Error scanning file ${filePath}:`, error);
            return {
                filePath,
                fileName: path.basename(filePath),
                hierarchy: {
                    root: { name: 'error', type: 'agent' },
                    agents: {}
                },
                hasAgents: false,
                agentCount: 0
            };
        }
    }
    /**
     * Scans a directory for Python files containing agents and returns the results
     * @param baseDirectory - The directory to scan (defaults to current working directory)
     * @returns Promise<DirectoryScanResult> - The scan results
     */
    async scanDirectory(baseDirectory = process.cwd()) {
        const scanTime = new Date().toISOString();
        const files = [];
        try {
            // Find all Python files in the directory and subdirectories
            const pythonFiles = await (0, glob_1.glob)('**/*.py', {
                cwd: baseDirectory,
                ignore: ['**/venv/**', '**/__pycache__/**', '**/.git/**', '**/node_modules/**']
            });
            let totalAgents = 0;
            let filesWithAgents = 0;
            for (const relativePath of pythonFiles) {
                const fullPath = path.join(baseDirectory, relativePath);
                const fileResult = this.scanFile(fullPath);
                // Only include files that actually have agents
                if (fileResult.hasAgents) {
                    files.push(fileResult);
                    filesWithAgents++;
                    totalAgents += fileResult.agentCount;
                }
            }
            return {
                scanTime,
                totalFiles: pythonFiles.length,
                filesWithAgents,
                totalAgents,
                files
            };
        }
        catch (error) {
            console.error('Error scanning directory:', error);
            return {
                scanTime,
                totalFiles: 0,
                filesWithAgents: 0,
                totalAgents: 0,
                files: []
            };
        }
    }
    /**
     * Scans a single file for agents and returns the results
     * @param filePath - The path to the Python file to scan
     * @returns FileAgentHierarchy - The scan results for the file
     */
    scanSingleFile(filePath) {
        return this.scanFile(filePath);
    }
    /**
     * Gets only the files that contain agents from a directory scan
     * @param baseDirectory - The directory to scan (defaults to current working directory)
     * @returns Promise<FileAgentHierarchy[]> - Array of files that contain agents
     */
    async getFilesWithAgents(baseDirectory = process.cwd()) {
        const result = await this.scanDirectory(baseDirectory);
        return result.files.filter(file => file.hasAgents);
    }
    /**
     * Gets a summary of the scan results
     * @param baseDirectory - The directory to scan (defaults to current working directory)
     * @returns Promise<{scanTime: string, totalFiles: number, filesWithAgents: number, totalAgents: number}>
     */
    async getScanSummary(baseDirectory = process.cwd()) {
        const result = await this.scanDirectory(baseDirectory);
        return {
            scanTime: result.scanTime,
            totalFiles: result.totalFiles,
            filesWithAgents: result.filesWithAgents,
            totalAgents: result.totalAgents
        };
    }
    /**
     * Finds all imported agents in a Python file
     * @param fileName - The name of the Python file to search in
     * @returns Array of imported agent information
     */
    findImportedAgents(fileName) {
        try {
            const currentDir = process.cwd();
            const filePath = path.join(currentDir, fileName);
            if (!fs.existsSync(filePath)) {
                console.error(`File not found at: ${filePath}`);
                return [];
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            const importedAgents = [];
            // Pattern to match import statements for agents
            // This will match patterns like:
            // from travel_concierge.sub_agents.inspiration.agent import inspiration_agent
            // from travel_concierge.sub_agents.booking.agent import booking_agent
            const importPattern = /from\s+([\w.]+)\s+import\s+(\w+)/g;
            for (const line of lines) {
                let match;
                while ((match = importPattern.exec(line)) !== null) {
                    const modulePath = match[1];
                    const importedName = match[2];
                    // Check if this looks like an agent import (ends with .agent or contains 'agent')
                    if (modulePath.includes('agent') || importedName.includes('agent')) {
                        // Try to resolve the actual file path
                        const sourceFile = this.resolveImportPath(modulePath, fileName);
                        importedAgents.push({
                            importedName,
                            sourceFile,
                            actualAgentName: importedName, // Will be updated when we scan the source file
                            importStatement: line.trim()
                        });
                    }
                }
            }
            return importedAgents;
        }
        catch (error) {
            console.error('Error finding imported agents:', error);
            return [];
        }
    }
    /**
     * Resolves the file path for an import statement
     * @param modulePath - The module path from the import statement
     * @param currentFile - The current file being processed
     * @returns The resolved file path
     */
    resolveImportPath(modulePath, currentFile) {
        try {
            const currentDir = process.cwd();
            const currentFileDir = path.dirname(path.join(currentDir, currentFile));
            // Handle relative imports
            if (modulePath.startsWith('.')) {
                const relativePath = modulePath.replace(/^\.+/, '');
                return path.join(currentFileDir, relativePath + '.py');
            }
            // Handle absolute imports - resolve relative to the current file's directory
            // For imports like "travel_concierge.sub_agents.planning.agent"
            // We need to find the actual file in the project structure
            const modulePathParts = modulePath.split('.');
            const potentialPaths = [
                // Try relative to current file directory
                path.join(currentFileDir, modulePathParts.join('/') + '.py'),
                // Try relative to project root
                path.join(currentDir, modulePathParts.join('/') + '.py'),
                // Try with travel/ prefix (common in this project)
                path.join(currentDir, 'travel', modulePathParts.join('/') + '.py'),
                // Try with travel/travel_concierge/ prefix
                path.join(currentDir, 'travel', 'travel_concierge', modulePathParts.slice(1).join('/') + '.py')
            ];
            // Check if any of these paths exist
            for (const potentialPath of potentialPaths) {
                if (fs.existsSync(potentialPath)) {
                    // Return relative path from current directory
                    return path.relative(currentDir, potentialPath);
                }
            }
            // If none found, return the most likely path
            return modulePathParts.join('/') + '.py';
        }
        catch (error) {
            console.error('Error resolving import path:', error);
            return modulePath + '.py';
        }
    }
    /**
     * Resolves an agent's complete hierarchy including imported sub-agents
     * @param fileName - The name of the Python file to search in
     * @param agentName - The name of the agent to resolve
     * @returns Complete agent hierarchy with imported agents resolved
     */
    async resolveAgentHierarchy(fileName, agentName) {
        try {
            // First, get the basic agent hierarchy
            const fileResult = this.scanFile(fileName);
            const agent = fileResult.hierarchy.agents[agentName];
            if (!agent) {
                return null;
            }
            // Find imported agents
            const importedAgents = this.findImportedAgents(fileName);
            // Build resolved agent info
            const resolvedAgent = {
                ...agent,
                filePath: fileResult.filePath,
                isImported: false
            };
            // Resolve imported sub-agents
            const resolvedAgents = {};
            resolvedAgents[agentName] = resolvedAgent;
            // Process imported agents
            for (const importedAgent of importedAgents) {
                try {
                    // Try to scan the source file
                    const sourceFileResult = this.scanFile(importedAgent.sourceFile);
                    // Find the actual agent in the source file
                    const actualAgent = sourceFileResult.hierarchy.agents[importedAgent.actualAgentName];
                    if (actualAgent) {
                        resolvedAgents[importedAgent.importedName] = {
                            ...actualAgent,
                            filePath: sourceFileResult.filePath,
                            importedAs: importedAgent.importedName,
                            isImported: true,
                            sourceFile: importedAgent.sourceFile
                        };
                    }
                }
                catch (error) {
                    console.error(`Error resolving imported agent ${importedAgent.importedName}:`, error);
                }
            }
            return {
                root: resolvedAgent,
                agents: resolvedAgents,
                importedAgents
            };
        }
        catch (error) {
            console.error('Error resolving agent hierarchy:', error);
            return null;
        }
    }
    /**
     * Builds complete cross-file agent hierarchy for the entire directory
     * @param baseDirectory - The directory to scan (defaults to current working directory)
     * @returns Promise<CompleteAgentHierarchy[]> - Complete hierarchies with imported agents resolved
     */
    async buildCrossFileHierarchy(baseDirectory = process.cwd()) {
        try {
            const result = await this.scanDirectory(baseDirectory);
            const completeHierarchies = [];
            for (const fileResult of result.files) {
                if (fileResult.hasAgents) {
                    // For each agent in the file, try to resolve its complete hierarchy
                    for (const agentName in fileResult.hierarchy.agents) {
                        const resolvedHierarchy = await this.resolveAgentHierarchy(fileResult.filePath, agentName);
                        if (resolvedHierarchy) {
                            completeHierarchies.push({
                                filePath: fileResult.filePath,
                                fileName: fileResult.fileName,
                                hierarchy: resolvedHierarchy,
                                hasAgents: fileResult.hasAgents,
                                agentCount: fileResult.agentCount,
                                importedAgentCount: resolvedHierarchy.importedAgents.length
                            });
                        }
                    }
                }
            }
            return completeHierarchies;
        }
        catch (error) {
            console.error('Error building cross-file hierarchy:', error);
            return [];
        }
    }
    /**
     * Creates a hierarchical structure where sub-agents are nested under their parent agents
     * @param scanResult - The result from scanDirectory
     * @returns A hierarchical structure with nested sub-agents
     */
    createHierarchicalStructure(scanResult) {
        const hierarchicalResult = {
            scanTime: scanResult.scanTime,
            totalFiles: scanResult.totalFiles,
            filesWithAgents: scanResult.filesWithAgents,
            totalAgents: scanResult.totalAgents,
            hierarchicalFiles: []
        };
        // Create a map of all agents across all files for cross-file lookups
        const allAgentsMap = new Map();
        for (const file of scanResult.files) {
            for (const [agentName, agent] of Object.entries(file.hierarchy.agents)) {
                allAgentsMap.set(agentName, { agent, filePath: file.filePath });
            }
        }
        for (const file of scanResult.files) {
            const hierarchicalFile = {
                filePath: file.filePath,
                fileName: file.fileName,
                hasAgents: file.hasAgents,
                agentCount: file.agentCount,
                hierarchy: this.buildNestedHierarchy(file.hierarchy, allAgentsMap)
            };
            hierarchicalResult.hierarchicalFiles.push(hierarchicalFile);
        }
        return hierarchicalResult;
    }
    /**
     * Builds a nested hierarchy for a single file
     * @param hierarchy - The flat hierarchy from scanFile
     * @param allAgentsMap - Map of all agents across all files
     * @returns A nested hierarchy structure
     */
    buildNestedHierarchy(hierarchy, allAgentsMap) {
        const rootAgent = hierarchy.root;
        const allAgents = hierarchy.agents;
        // Start with the root agent
        const nestedRoot = {
            name: rootAgent.name,
            type: rootAgent.type,
            description: rootAgent.description,
            model: rootAgent.model,
            instruction: rootAgent.instruction,
            output_key: rootAgent.output_key,
            tools: rootAgent.tools,
            agent_tools: rootAgent.agent_tools,
            sub_agents: []
        };
        // Process sub-agents recursively
        if (rootAgent.sub_agents) {
            for (const subAgentName of rootAgent.sub_agents) {
                const nestedSubAgent = this.buildNestedAgent(subAgentName, allAgentsMap);
                if (nestedSubAgent) {
                    nestedRoot.sub_agents.push(nestedSubAgent);
                }
            }
        }
        return nestedRoot;
    }
    /**
     * Recursively builds a nested agent structure
     * @param agentName - The name of the agent to process
     * @param allAgentsMap - Map of all agents across all files
     * @returns A nested agent structure
     */
    buildNestedAgent(agentName, allAgentsMap) {
        const agentData = allAgentsMap.get(agentName);
        if (!agentData) {
            return null;
        }
        const agent = agentData.agent;
        const nestedAgent = {
            name: agent.name,
            type: agent.type,
            description: agent.description,
            model: agent.model,
            instruction: agent.instruction,
            output_key: agent.output_key,
            tools: agent.tools,
            agent_tools: agent.agent_tools,
            sub_agents: []
        };
        // Process sub-agents recursively
        if (agent.sub_agents) {
            for (const subAgentName of agent.sub_agents) {
                const nestedSubAgent = this.buildNestedAgent(subAgentName, allAgentsMap);
                if (nestedSubAgent) {
                    nestedAgent.sub_agents.push(nestedSubAgent);
                }
            }
        }
        return nestedAgent;
    }
}
// Export the scanner instance and types
exports.agentScanner = new AgentScannerLib();
// Export individual functions for easier use
const scanDirectory = (baseDirectory) => exports.agentScanner.scanDirectory(baseDirectory);
exports.scanDirectory = scanDirectory;
const scanSingleFile = (filePath) => exports.agentScanner.scanSingleFile(filePath);
exports.scanSingleFile = scanSingleFile;
const getFilesWithAgents = (baseDirectory) => exports.agentScanner.getFilesWithAgents(baseDirectory);
exports.getFilesWithAgents = getFilesWithAgents;
const getScanSummary = (baseDirectory) => exports.agentScanner.getScanSummary(baseDirectory);
exports.getScanSummary = getScanSummary;
// Export new cross-file functions
const findImportedAgents = (fileName) => exports.agentScanner.findImportedAgents(fileName);
exports.findImportedAgents = findImportedAgents;
const resolveAgentHierarchy = (fileName, agentName) => exports.agentScanner.resolveAgentHierarchy(fileName, agentName);
exports.resolveAgentHierarchy = resolveAgentHierarchy;
const buildCrossFileHierarchy = (baseDirectory) => exports.agentScanner.buildCrossFileHierarchy(baseDirectory);
exports.buildCrossFileHierarchy = buildCrossFileHierarchy;
const createHierarchicalStructure = (scanResult) => exports.agentScanner.createHierarchicalStructure(scanResult);
exports.createHierarchicalStructure = createHierarchicalStructure;
//# sourceMappingURL=agent-scanner-lib.js.map