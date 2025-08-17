# Agent Inspector Extension

An extension for designing and managing ADK (Agent Development Kit) agents in Visual Studio Code.

## Features

This extension provides tools for working with ADK agents:

- **Agent Tree View**: Browse and inspect agent definitions in your workspace
- **ADK Web Button**: Launch ADK web interface with proper environment setup
- **Agent Management**: Add sub-agents, tools, and agent tools to your agent definitions
- **Agent Scanner**: Scan directories for agent files and definitions

## Usage

### Status Bar Buttons

- **ADK Web**: Launches ADK web interface in a webview panel

### Commands

- `Agent Inspector: Scan Directory for Agents`: Refresh the agent tree view
- `Agent Inspector: Find Agent`: Locate specific agents in files
- `Agent Inspector: Add Sub Agent`: Add a new sub-agent to an existing agent
- `Agent Inspector: Add Tool`: Add a tool to an agent
- `Agent Inspector: Add Agent Tool`: Add an agent tool definition

## Requirements

- Python 3.12 (specifically at `/Library/Frameworks/Python.framework/Versions/3.12/bin`)
- ADK (Agent Development Kit) installed
- Google API Key for agent functionality

## Installation

1. Install the extension from VSIX file
2. Reload VS Code window
3. The extension will activate automatically when working with agent files

## Release Notes

### 0.0.1

Initial release with core agent management features:
- Agent tree view
- Terminal and web interface integration
- Basic agent file manipulation tools
