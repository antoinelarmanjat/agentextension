import * as fs from 'fs';
import * as path from 'path';

// Import the cross-file resolution functions from the scanner library
import { findImportedAgents } from './agent-scanner-lib';

/**
 * AGENT FINDER UTILITIES
 * 
 * Main function to use: findAnyAgentLocation(fileName, agentName)
 * 
 * This unified function handles all cases:
 * - Root agents (defined in the same file)
 * - Direct sub-agents (defined in the same file)
 * - Nested sub-agents (defined in imported files)
 * 
 * Examples:
 * - findAnyAgentLocation('travel/travel_concierge/agent.py', 'root_agent') -> finds root agent
 * - findAnyAgentLocation('travel/travel_concierge/agent.py', 'poi_agent') -> finds nested sub-agent
 * - findAnyAgentLocation('agents/agent.py', 'get_the_task') -> finds direct sub-agent
 */

/**
 * Finds the line number where a specific agent is defined in a Python file
 * @param fileName - The name of the Python file to search in (e.g., "agent.py", "sequential.py")
 * @param agentName - The name of the agent to find (e.g., "get_the_task", "root_agent")
 * @returns The line number where the agent is defined, or 1 if not found
 */
export function findAgentLineNumber(fileName: string, agentName: string): number {
  try {
    const currentDir = process.cwd();
    const filePath = path.join(currentDir, fileName);
    
    if (!fs.existsSync(filePath)) {
      console.error(`File not found at: ${filePath}`);
      return 1;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // Pattern to match agent definitions
    // This will match patterns like:
    // agentName = LlmAgent(
    // agentName = SequentialAgent(
    // agentName = LoopAgent(
    // agentName = ParallelAgent(
    // agentName = Agent(
    const agentPattern = new RegExp(`^\\s*${agentName}\\s*=\\s*(LlmAgent|SequentialAgent|LoopAgent|ParallelAgent|Agent)\\s*\\(`, 'm');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (agentPattern.test(line)) {
        return i + 1; // Line numbers are 1-indexed
      }
    }
    
    // If not found, return 1
    return 1;
    
  } catch (error) {
    console.error('Error finding agent line number:', error);
    return 1;
  }
}

/**
 * Finds the line number where a specific agent is defined and returns additional context
 * @param fileName - The name of the Python file to search in
 * @param agentName - The name of the agent to find
 * @returns Object with line number and context information
 */
export function findAgentWithContext(fileName: string, agentName: string): {
  lineNumber: number;
  found: boolean;
  context?: string;
  agentType?: string;
} {
  try {
    const currentDir = process.cwd();
    const filePath = path.join(currentDir, fileName);
    
    if (!fs.existsSync(filePath)) {
      console.error(`File not found at: ${filePath}`);
      return { lineNumber: 1, found: false };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // Pattern to match agent definitions and capture the agent type
    const agentPattern = new RegExp(`^\\s*${agentName}\\s*=\\s*(LlmAgent|SequentialAgent|LoopAgent|ParallelAgent|Agent)\\s*\\(`, 'm');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = agentPattern.exec(line);
      if (match) {
        const agentType = match[1];
        
        // Get some context (the line itself and a few lines before/after)
        const startContext = Math.max(0, i - 2);
        const endContext = Math.min(lines.length, i + 3);
        const contextLines = lines.slice(startContext, endContext);
        const context = contextLines.join('\n');
        
        return {
          lineNumber: i + 1,
          found: true,
          context,
          agentType
        };
      }
    }
    
    // If not found, return default
    return { lineNumber: 1, found: false };
    
  } catch (error) {
    console.error('Error finding agent with context:', error);
    return { lineNumber: 1, found: false };
  }
}

/**
 * Lists all agents found in a specific Python file with their line numbers
 * @param fileName - The name of the Python file to search in
 * @returns Array of agent information
 */
export function listAllAgents(fileName: string): Array<{
  name: string;
  lineNumber: number;
  type: string;
}> {
  try {
    const currentDir = process.cwd();
    const filePath = path.join(currentDir, fileName);
    
    if (!fs.existsSync(filePath)) {
      console.error(`File not found at: ${filePath}`);
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const agents: Array<{ name: string; lineNumber: number; type: string }> = [];
    
    // Pattern to match all agent definitions
    const agentPattern = /^\s*(\w+)\s*=\s*(LlmAgent|SequentialAgent|LoopAgent|ParallelAgent|Agent)\s*\(/m;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = agentPattern.exec(line);
      if (match) {
        const agentName = match[1];
        const agentType = match[2];
        
        agents.push({
          name: agentName,
          lineNumber: i + 1,
          type: agentType
        });
      }
    }
    
    return agents;
    
  } catch (error) {
    console.error('Error listing agents:', error);
    return [];
  }
}

/**
 * Lists all agents found in multiple Python files with their line numbers
 * @param fileNames - Array of Python file names to search in
 * @returns Array of agent information with file information
 */
export function listAllAgentsInFiles(fileNames: string[]): Array<{
  fileName: string;
  name: string;
  lineNumber: number;
  type: string;
}> {
  const allAgents: Array<{ fileName: string; name: string; lineNumber: number; type: string }> = [];
  
  for (const fileName of fileNames) {
    const agents = listAllAgents(fileName);
    for (const agent of agents) {
      allAgents.push({
        fileName,
        ...agent
      });
    }
  }
  
  return allAgents;
}

/**
 * Finds the line number where a specific tool function is defined in a Python file
 * @param fileName - The name of the Python file to search in
 * @param toolName - The name of the tool function to find (e.g., "exit_loop", "file_list")
 * @returns The line number where the tool function is defined, or 1 if not found
 */
export function findToolLineNumber(fileName: string, toolName: string): number {
  try {
    const currentDir = process.cwd();
    const filePath = path.join(currentDir, fileName);
    
    if (!fs.existsSync(filePath)) {
      console.error(`File not found at: ${filePath}`);
      return 1;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // Pattern to match function definitions
    // This will match patterns like:
    // def toolName(
    // def toolName():
    // def toolName(param1, param2):
    // def toolName(param1: type, param2: type):
    const functionPattern = new RegExp(`^\\s*def\\s+${toolName}\\s*\\(`, 'm');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (functionPattern.test(line)) {
        return i + 1; // Line numbers are 1-indexed
      }
    }
    
    // If not found, return 1
    return 1;
    
  } catch (error) {
    console.error('Error finding tool line number:', error);
    return 1;
  }
}

/**
 * Finds the line number where a specific tool function is defined and returns additional context
 * @param fileName - The name of the Python file to search in
 * @param toolName - The name of the tool function to find
 * @returns Object with line number and context information
 */
export function findToolWithContext(fileName: string, toolName: string, rootPath: string): {
  lineNumber: number;
  found: boolean;
  context?: string;
  functionSignature?: string;
} {
  try {
    const filePath = path.isAbsolute(fileName) ? fileName : path.join(rootPath, fileName);
    
    if (!fs.existsSync(filePath)) {
      console.error(`File not found at: ${filePath}`);
      return { lineNumber: 1, found: false };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // Pattern to match tool definitions, either as a function or a variable assignment.
    const toolPattern = new RegExp(`^\\s*(def\\s+${toolName}\\s*\\(|${toolName}\\s*=)`, 'm');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = toolPattern.exec(line);
      if (match) {
        const signatureMatch = line.match(new RegExp(`^\\s*def\\s+${toolName}\\s*\\(([^)]*)\\)`));
        const functionSignature = signatureMatch ? signatureMatch[1] : undefined;
        
        // Get some context (the line itself and a few lines before/after)
        const startContext = Math.max(0, i - 2);
        const endContext = Math.min(lines.length, i + 5); // Get more lines for function context
        const contextLines = lines.slice(startContext, endContext);
        const context = contextLines.join('\n');
        
        return {
          lineNumber: i + 1,
          found: true,
          context,
          functionSignature
        };
      }
    }
    
    // If not found, return default
    return { lineNumber: 1, found: false };
    
  } catch (error) {
    console.error('Error finding tool with context:', error);
    return { lineNumber: 1, found: false };
  }
}

/**
 * Finds all tools used by a specific agent and their line numbers
 * @param fileName - The name of the Python file to search in
 * @param agentName - The name of the agent to find tools for
 * @returns Array of tool information with line numbers
 */
export function findAgentTools(fileName: string, agentName: string): Array<{
  toolName: string;
  lineNumber: number;
  found: boolean;
  context?: string;
}> {
  try {
    const currentDir = process.cwd();
    const filePath = path.join(currentDir, fileName);
    
    if (!fs.existsSync(filePath)) {
      console.error(`File not found at: ${filePath}`);
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const tools: Array<{ toolName: string; lineNumber: number; found: boolean; context?: string }> = [];
    
    // First, find the agent and extract its tools
    const agentPattern = new RegExp(`^\\s*${agentName}\\s*=\\s*(LlmAgent|SequentialAgent|LoopAgent|ParallelAgent|Agent)\\s*\\(`, 'm');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (agentPattern.test(line)) {
        // Found the agent, now look for tools in the agent definition
        let j = i;
        while (j < lines.length && !lines[j].includes(')')) {
          const toolsMatch = lines[j].match(/tools\s*=\s*\[([^\]]+)\]/);
          if (toolsMatch) {
            const toolsStr = toolsMatch[1];
            const toolNames = toolsStr.split(',').map(tool => tool.trim()).filter(tool => tool.length > 0);
            
            // For each tool, find its function definition
            for (const toolName of toolNames) {
              const toolLineNumber = findToolLineNumber(fileName, toolName);
              const toolContext = findToolWithContext(fileName, toolName, process.cwd());
              
              tools.push({
                toolName,
                lineNumber: toolLineNumber,
                found: toolContext.found,
                context: toolContext.context
              });
            }
            break;
          }
          j++;
        }
        break;
      }
    }
    
    return tools;
    
  } catch (error) {
    console.error('Error finding agent tools:', error);
    return [];
  }
}

/**
 * Finds imported tools in a Python file
 * @param fileName - The name of the Python file to search in
 * @returns Array of imported tool information
 */
export function findImportedTools(fileName: string, rootPath: string): Array<{
  importedName: string;
  sourceFile: string;
  actualToolName: string;
  importStatement: string;
}> {
  try {
    const filePath = path.isAbsolute(fileName) ? fileName : path.join(rootPath, fileName);
    
    if (!fs.existsSync(filePath)) {
      console.error(`File not found at: ${filePath}`);
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const importedTools: Array<{
      importedName: string;
      sourceFile: string;
      actualToolName: string;
      importStatement: string;
    }> = [];
    
    // Pattern to match import statements for tools
    // This will match patterns like:
    // from travel_concierge.tools import custom_tool
    // from utils.tools import helper_tool
    const importPattern = /from\s+([\w.]+)\s+import\s+(\w+)/g;
    
    for (const line of lines) {
      let match;
      while ((match = importPattern.exec(line)) !== null) {
        const modulePath = match[1];
        const importedName = match[2];
        
        // Check if this looks like a tool import (contains 'tool' or 'utils')
        if (modulePath.includes('tool') || modulePath.includes('utils') || 
            importedName.includes('tool') || importedName.includes('helper')) {
          // Try to resolve the actual file path
          const sourceFile = resolveImportPath(modulePath, fileName, rootPath);
          
          importedTools.push({
            importedName,
            sourceFile,
            actualToolName: importedName, // Will be updated when we scan the source file
            importStatement: line.trim()
          });
        }
      }
    }
    
    return importedTools;
    
  } catch (error) {
    console.error('Error finding imported tools:', error);
    return [];
  }
}

/**
 * Resolves the file path for an import statement (reused from agent scanner)
 * @param modulePath - The module path from the import statement
 * @param currentFile - The current file being processed
 * @returns The resolved file path
 */
function resolveImportPath(modulePath: string, currentFile: string, rootPath: string): string {
    try {
        const currentFileDir = path.dirname(currentFile);
        
        // Handle relative imports from the current file's directory
        if (modulePath.startsWith('.')) {
            const resolvedPath = path.resolve(currentFileDir, modulePath.replace(/\./g, path.sep));
            if (fs.existsSync(resolvedPath + '.py')) {
                return resolvedPath + '.py';
            }
            if (fs.existsSync(path.join(resolvedPath, '__init__.py'))) {
                return path.join(resolvedPath, '__init__.py');
            }
        }

        // Handle absolute imports from the root of the project
        const modulePathAsFilePath = modulePath.replace(/\./g, path.sep);
        
        // Strategy 1: Search upwards from the current file to find the root of the module path
        let currentPath = currentFileDir;
        while (currentPath.startsWith(rootPath)) {
            const potentialRoot = currentPath.substring(0, currentPath.indexOf(modulePathAsFilePath.split(path.sep)[0]));
            const potentialPath = path.join(potentialRoot, modulePathAsFilePath) + '.py';
            if (fs.existsSync(potentialPath)) {
                return potentialPath;
            }
            const potentialPackagePath = path.join(potentialRoot, modulePathAsFilePath, 'agent.py');
            if (fs.existsSync(potentialPackagePath)) {
                return potentialPackagePath;
            }
            currentPath = path.dirname(currentPath);
        }

        // Strategy 2: Default to resolving from the workspace root
        const absolutePath = path.join(rootPath, modulePathAsFilePath) + '.py';
        if (fs.existsSync(absolutePath)) {
            return absolutePath;
        }
        const packagePath = path.join(rootPath, modulePathAsFilePath, 'agent.py');
        if (fs.existsSync(packagePath)) {
            return packagePath;
        }

        // Fallback for common project structures if direct resolution fails
        const travelConciergePath = path.join(rootPath, 'travel_concierge', modulePathAsFilePath) + '.py';
        if (fs.existsSync(travelConciergePath)) {
            return travelConciergePath;
        }

        return modulePath.replace(/\./g, path.sep) + '.py'; // Fallback
    } catch (error) {
        console.error('Error resolving import path:', error);
        return modulePath.replace(/\./g, path.sep) + '.py';
    }
}

/**
 * Finds the actual file location and line number where a tool function is defined,
 * handling both local definitions and imported tools
 * @param fileName - The name of the Python file to search in
  * @param toolName - The name of the tool function to find
 * @returns Object with actual file location and line number information
 */
export function findToolLocation(fileName: string, toolName: string, rootPath: string): {
  actualFileName: string;
  lineNumber: number;
  found: boolean;
  isImported: boolean;
  importStatement?: string;
  context?: string;
  functionSignature?: string;
} {
  try {
    const filePath = path.isAbsolute(fileName) ? fileName : path.join(rootPath, fileName);
    
    if (!fs.existsSync(filePath)) {
      console.error(`File not found at: ${filePath}`);
      return { 
        actualFileName: fileName, 
        lineNumber: 1, 
        found: false, 
        isImported: false 
      };
    }

    // First, check if the tool is defined locally in the file
    const localResult = findToolWithContext(fileName, toolName, rootPath);
    if (localResult.found) {
      return {
        actualFileName: fileName,
        lineNumber: localResult.lineNumber,
        found: true,
        isImported: false,
        context: localResult.context,
        functionSignature: localResult.functionSignature
      };
    }

    // If not found locally, check if it's an imported tool
    const importedTools = findImportedTools(fileName, rootPath);
    for (const importedTool of importedTools) {
      if (importedTool.importedName === toolName) {
        // Try to find the tool in the source file
        const sourceFileResult = findToolWithContext(importedTool.sourceFile, importedTool.actualToolName, rootPath);
        
        if (sourceFileResult.found) {
          return {
            actualFileName: importedTool.sourceFile,
            lineNumber: sourceFileResult.lineNumber,
            found: true,
            isImported: true,
            importStatement: importedTool.importStatement,
            context: sourceFileResult.context,
            functionSignature: sourceFileResult.functionSignature
          };
        } else {
          // Tool is imported but not found in source file (might be external library)
          return {
            actualFileName: importedTool.sourceFile,
            lineNumber: 1,
            found: false,
            isImported: true,
            importStatement: importedTool.importStatement
          };
        }
      }
    }

    // Tool not found locally or as imported
    return { 
      actualFileName: fileName, 
      lineNumber: 1, 
      found: false, 
      isImported: false 
    };
    
  } catch (error) {
    console.error('Error finding tool location:', error);
    return { 
      actualFileName: fileName, 
      lineNumber: 1, 
      found: false, 
      isImported: false 
    };
  }
}

/**
 * Enhanced version of findToolLineNumber that handles imported tools
 * @param fileName - The name of the Python file to search in
 * @param toolName - The name of the tool function to find
 * @returns Object with file name and line number where tool is actually defined
 */
export function findToolLineNumberCrossFile(fileName: string, toolName: string): {
  fileName: string;
  lineNumber: number;
  found: boolean;
  isImported: boolean;
} {
  const location = findToolLocation(fileName, toolName, process.cwd());
  return {
    fileName: location.actualFileName,
    lineNumber: location.lineNumber,
    found: location.found,
    isImported: location.isImported
  };
}

/**
 * Enhanced version of findToolWithContext that handles imported tools
 * @param fileName - The name of the Python file to search in
 * @param toolName - The name of the tool function to find
 * @returns Object with complete tool location and context information
 */
export function findToolWithContextCrossFile(fileName: string, toolName: string): {
  fileName: string;
  lineNumber: number;
  found: boolean;
  isImported: boolean;
  importStatement?: string;
  context?: string;
  functionSignature?: string;
} {
  const location = findToolLocation(fileName, toolName, process.cwd());
  return {
    fileName: location.actualFileName,
    lineNumber: location.lineNumber,
    found: location.found,
    isImported: location.isImported,
    importStatement: location.importStatement,
    context: location.context,
    functionSignature: location.functionSignature
  };
}

/**
 * Enhanced version of findAgentTools that handles imported tools
 * @param fileName - The name of the Python file to search in
 * @param agentName - The name of the agent to find tools for
 * @returns Array of tool information with actual file locations
 */
export function findAgentToolsCrossFile(fileName: string, agentName: string): Array<{
  toolName: string;
  fileName: string;
  lineNumber: number;
  found: boolean;
  isImported: boolean;
  importStatement?: string;
  context?: string;
  functionSignature?: string;
}> {
  try {
    const currentDir = process.cwd();
    const filePath = path.join(currentDir, fileName);
    
    if (!fs.existsSync(filePath)) {
      console.error(`File not found at: ${filePath}`);
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const tools: Array<{
      toolName: string;
      fileName: string;
      lineNumber: number;
      found: boolean;
      isImported: boolean;
      importStatement?: string;
      context?: string;
      functionSignature?: string;
    }> = [];
    
    // First, find the agent and extract its tools
    const agentPattern = new RegExp(`^\\s*${agentName}\\s*=\\s*(LlmAgent|SequentialAgent|LoopAgent|ParallelAgent|Agent)\\s*\\(`, 'm');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (agentPattern.test(line)) {
        // Found the agent, now look for tools in the agent definition
        let j = i;
        while (j < lines.length && !lines[j].includes(')')) {
          const toolsMatch = lines[j].match(/tools\s*=\s*\[([^\]]+)\]/);
          if (toolsMatch) {
            const toolsStr = toolsMatch[1];
            const toolNames = toolsStr.split(',').map(tool => tool.trim()).filter(tool => tool.length > 0);
            
            // For each tool, find its actual location (local or imported)
            for (const toolName of toolNames) {
              const toolLocation = findToolLocation(fileName, toolName, process.cwd());
              
              tools.push({
                toolName,
                fileName: toolLocation.actualFileName,
                lineNumber: toolLocation.lineNumber,
                found: toolLocation.found,
                isImported: toolLocation.isImported,
                importStatement: toolLocation.importStatement,
                context: toolLocation.context,
                functionSignature: toolLocation.functionSignature
              });
            }
            break;
          }
          j++;
        }
        break;
      }
    }
    
    return tools;
    
  } catch (error) {
    console.error('Error finding agent tools cross-file:', error);
    return [];
  }
}

/**
 * Finds the actual file location and line number where an agent is defined,
 * handling both local definitions and imported agents
 * @param fileName - The name of the Python file to search in
 * @param agentName - The name of the agent to find
 * @returns Object with actual file location and line number information
 */
export function findAgentLocation(fileName: string, agentName: string): {
  actualFileName: string;
  lineNumber: number;
  found: boolean;
  isImported: boolean;
  importStatement?: string;
  context?: string;
  agentType?: string;
} {
  try {
    const currentDir = process.cwd();
    const filePath = path.join(currentDir, fileName);
    
    if (!fs.existsSync(filePath)) {
      console.error(`File not found at: ${filePath}`);
      return { 
        actualFileName: fileName, 
        lineNumber: 1, 
        found: false, 
        isImported: false 
      };
    }

    // First, check if the agent is defined locally in the file
    const localResult = findAgentWithContext(fileName, agentName);
    if (localResult.found) {
      return {
        actualFileName: fileName,
        lineNumber: localResult.lineNumber,
        found: true,
        isImported: false,
        context: localResult.context,
        agentType: localResult.agentType
      };
    }

    // If not found locally, check if it's an imported agent
    const importedAgents = findImportedAgents(fileName);
    for (const importedAgent of importedAgents) {
      if (importedAgent.importedName === agentName) {
        // Try to find the agent in the source file
        const sourceFileResult = findAgentWithContext(importedAgent.sourceFile, importedAgent.actualAgentName);
        
        if (sourceFileResult.found) {
          return {
            actualFileName: importedAgent.sourceFile,
            lineNumber: sourceFileResult.lineNumber,
            found: true,
            isImported: true,
            importStatement: importedAgent.importStatement,
            context: sourceFileResult.context,
            agentType: sourceFileResult.agentType
          };
        } else {
          // Agent is imported but not found in source file (might be external library)
          return {
            actualFileName: importedAgent.sourceFile,
            lineNumber: 1,
            found: false,
            isImported: true,
            importStatement: importedAgent.importStatement
          };
        }
      }
    }

    // Agent not found locally or as imported
    return { 
      actualFileName: fileName, 
      lineNumber: 1, 
      found: false, 
      isImported: false 
    };
    
  } catch (error) {
    console.error('Error finding agent location:', error);
    return { 
      actualFileName: fileName, 
      lineNumber: 1, 
      found: false, 
      isImported: false 
    };
  }
}

/**
 * Enhanced version of findAgentLineNumber that handles imported agents
 * @param fileName - The name of the Python file to search in
 * @param agentName - The name of the agent to find
 * @returns Object with file name and line number where agent is actually defined
 */
export function findAgentLineNumberCrossFile(fileName: string, agentName: string): {
  fileName: string;
  lineNumber: number;
  found: boolean;
  isImported: boolean;
} {
  const location = findAgentLocation(fileName, agentName);
  return {
    fileName: location.actualFileName,
    lineNumber: location.lineNumber,
    found: location.found,
    isImported: location.isImported
  };
}

/**
 * Enhanced version of findAgentWithContext that handles imported agents
 * @param fileName - The name of the Python file to search in
 * @param agentName - The name of the agent to find
 * @returns Object with complete agent location and context information
 */
export function findAgentWithContextCrossFile(fileName: string, agentName: string): {
  fileName: string;
  lineNumber: number;
  found: boolean;
  isImported: boolean;
  importStatement?: string;
  context?: string;
  agentType?: string;
} {
  const location = findAgentLocation(fileName, agentName);
  return {
    fileName: location.actualFileName,
    lineNumber: location.lineNumber,
    found: location.found,
    isImported: location.isImported,
    importStatement: location.importStatement,
    context: location.context,
    agentType: location.agentType
  };
}

/**
 * Unified function to find any agent (root agent, direct sub-agent, or nested sub-agent) by searching through the hierarchical structure
 * @param rootFileName - The file containing the root agent
 * @param agentName - The name of the agent to find (can be root agent, direct sub-agent, or nested sub-agent)
 * @returns Object with the actual file name and line number where the agent is defined
 */
export function findAnyAgentLocation(rootFileName: string, agentName: string): {
  actualFileName: string;
  lineNumber: number;
  found: boolean;
  isImported: boolean;
  importStatement?: string;
  context?: string;
  agentType?: string;
} {
  try {
    // First, try to find the agent directly in the root file (handles root agents and direct sub-agents)
    const directResult = findAgentLocation(rootFileName, agentName);
    if (directResult.found) {
      return directResult;
    }

    // If not found directly, get all imported agents from the root file
    const importedAgents = findImportedAgents(rootFileName);
    
    // For each imported agent, check if it contains the sub-agent
    for (const importedAgent of importedAgents) {
      const sourceFileResult = findAgentWithContext(importedAgent.sourceFile, agentName);
      if (sourceFileResult.found) {
        return {
          actualFileName: importedAgent.sourceFile,
          lineNumber: sourceFileResult.lineNumber,
          found: true,
          isImported: true,
          importStatement: importedAgent.importStatement,
          context: sourceFileResult.context,
          agentType: sourceFileResult.agentType
        };
      }
    }

    // If still not found, return not found
    return { 
      actualFileName: rootFileName, 
      lineNumber: 1, 
      found: false, 
      isImported: false 
    };
    
  } catch (error) {
    console.error('Error finding agent location:', error);
    return { 
      actualFileName: rootFileName, 
      lineNumber: 1, 
      found: false, 
      isImported: false 
    };
  }
}

/**
 * @deprecated Use findAnyAgentLocation instead. This function is kept for backward compatibility.
 * Finds the location of a sub-agent by searching through the hierarchical structure
 * @param rootFileName - The file containing the root agent
 * @param subAgentName - The name of the sub-agent to find
 * @returns Object with the actual file name and line number where the sub-agent is defined
 */
export function findSubAgentLocation(rootFileName: string, subAgentName: string): {
  actualFileName: string;
  lineNumber: number;
  found: boolean;
  isImported: boolean;
  importStatement?: string;
  context?: string;
  agentType?: string;
} {
  return findAnyAgentLocation(rootFileName, subAgentName);
}

/**
 * Lists all agents found in a file, including imported agents with their actual locations
 * @param fileName - The name of the Python file to search in
 * @returns Array of agent information with actual file locations
 */
export function listAllAgentsCrossFile(fileName: string): Array<{
  name: string;
  fileName: string;
  lineNumber: number;
  type: string;
  isImported: boolean;
  importStatement?: string;
}> {
  try {
    const currentDir = process.cwd();
    const filePath = path.join(currentDir, fileName);
    
    if (!fs.existsSync(filePath)) {
      console.error(`File not found at: ${filePath}`);
      return [];
    }

    const agents: Array<{
      name: string;
      fileName: string;
      lineNumber: number;
      type: string;
      isImported: boolean;
      importStatement?: string;
    }> = [];

    // First, get all local agents
    const localAgents = listAllAgents(fileName);
    for (const agent of localAgents) {
      agents.push({
        name: agent.name,
        fileName: fileName,
        lineNumber: agent.lineNumber,
        type: agent.type,
        isImported: false
      });
    }

    // Then, get all imported agents
    const importedAgents = findImportedAgents(fileName);
    for (const importedAgent of importedAgents) {
      // Try to find the actual agent in the source file
      const sourceFileResult = findAgentWithContext(importedAgent.sourceFile, importedAgent.actualAgentName);
      
      agents.push({
        name: importedAgent.importedName,
        fileName: importedAgent.sourceFile,
        lineNumber: sourceFileResult.found ? sourceFileResult.lineNumber : 1,
        type: sourceFileResult.agentType || 'Unknown',
        isImported: true,
        importStatement: importedAgent.importStatement
      });
    }

    return agents;
    
  } catch (error) {
    console.error('Error listing agents cross-file:', error);
    return [];
  }
}

// Example usage and testing
if (require.main === module) {
  // Test with some example files and agent names
  const testCases = [
    { fileName: 'agents/agent.py', agentName: 'get_the_task' },
    { fileName: 'agents/agent.py', agentName: 'root_agent' },
    { fileName: 'agents/agent.py', agentName: 'update_files' },
    { fileName: 'sequential.py', agentName: 'content_pipeline' },
    { fileName: 'agents/agent.py', agentName: 'nonexistent_agent' },
    { fileName: 'nonexistent.py', agentName: 'some_agent' }
  ];
  
  // Test tool finding
  const toolTestCases = [
    { fileName: 'agents/agent.py', toolName: 'exit_loop' },
    { fileName: 'agents/agent.py', toolName: 'file_list' },
    { fileName: 'agents/agent.py', toolName: 'file_content' },
    { fileName: 'agents/agent.py', toolName: 'file_store' },
    { fileName: 'agents/agent.py', toolName: 'nonexistent_tool' }
  ];
  
  console.log('Testing agent finder:');
  console.log('=====================');
  
  for (const testCase of testCases) {
    const lineNumber = findAgentLineNumber(testCase.fileName, testCase.agentName);
    const context = findAgentWithContext(testCase.fileName, testCase.agentName);
    
    console.log(`\nFile: ${testCase.fileName}, Agent: ${testCase.agentName}`);
    console.log(`Line number: ${lineNumber}`);
    console.log(`Found: ${context.found}`);
    if (context.found) {
      console.log(`Type: ${context.agentType}`);
      console.log(`Context:\n${context.context}`);
    }
  }
  
  console.log('\n\nTesting tool finder:');
  console.log('==================');
  for (const testCase of toolTestCases) {
    const toolLineNumber = findToolLineNumber(testCase.fileName, testCase.toolName);
    const toolContext = findToolWithContext(testCase.fileName, testCase.toolName, process.cwd());
    
    console.log(`\nFile: ${testCase.fileName}, Tool: ${testCase.toolName}`);
    console.log(`Line number: ${toolLineNumber}`);
    console.log(`Found: ${toolContext.found}`);
    if (toolContext.found) {
      console.log(`Function signature: ${toolContext.functionSignature || 'N/A'}`);
      console.log(`Context:\n${toolContext.context}`);
    }
  }
  
  console.log('\n\nTesting agent tools finder:');
  console.log('==========================');
  const agentToolsTestCases = [
    { fileName: 'agents/agent.py', agentName: 'list_of_files_to_user' },
    { fileName: 'agents/agent.py', agentName: 'list_of_files_in_repository' },
    { fileName: 'agents/agent.py', agentName: 'identify_file_to_modify' },
    { fileName: 'agents/agent.py', agentName: 'perform_action_on_file' }
  ];
  
  for (const testCase of agentToolsTestCases) {
    const tools = findAgentTools(testCase.fileName, testCase.agentName);
    console.log(`\nFile: ${testCase.fileName}, Agent: ${testCase.agentName}`);
    console.log(`Tools found: ${tools.length}`);
    for (const tool of tools) {
      console.log(`  - ${tool.toolName}: Line ${tool.lineNumber} (Found: ${tool.found})`);
    }
  }
  
  console.log('\n\nAll agents in files:');
  console.log('==================');
  const allAgents = listAllAgentsInFiles(['agents/agent.py', 'sequential.py']);
  for (const agent of allAgents) {
    console.log(`${agent.fileName}: ${agent.name} (${agent.type}) - Line ${agent.lineNumber}`);
  }
} 