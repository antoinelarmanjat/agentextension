# Agent Inspector Extension Overview

## Introduction

The Agent Inspector is a Visual Studio Code (VS Code) extension designed to assist developers in building and managing agents using Google's Agent Development Kit (ADK). It provides tools for scanning, visualizing, editing, running, and analyzing ADK agents, primarily focused on Python-based implementations. The extension integrates seamlessly into the VS Code workflow, offering a tree view for agent structures, command palette integrations, and support for running ADK web servers with real-time logging and AI-powered analysis.

The project is structured around a TypeScript-based extension core, Python scripts for agent analysis (leveraging Google's Gemini API), and an included example ADK agent project (`travel_concierge`). It targets developers creating multi-agent systems, such as conversational AI for tasks like travel planning, by simplifying discovery, navigation, and debugging of agent hierarchies.

Key technologies include:
- VS Code Extension API for UI and commands.
- Python ADK for agent definitions.
- Node.js dependencies like `dotenv` and `node-fetch` for environment handling.
- Gemini API for AI-assisted log analysis.

The extension activates on startup and requires a workspace with Python ADK code. It assumes a `.env` file for API keys (e.g., `GOOGLE_API_KEY`).

## Features

The extension offers a suite of features to streamline ADK agent development:

### Agent Scanning and Visualization
- **Directory Scanning**: The `Scan Directory for Agents` command (`agent-inspector.scanDirectory`) invokes a Python script (`src/analysis.py`) to parse workspace Python files for ADK agent definitions (e.g., `Agent(...)` instances). It extracts agent metadata like name, model, description, instructions, sub-agents, tools, and agent_tools.
- **Agent Tree View**: A dedicated "Agent Definitions" view in the Explorer sidebar displays a hierarchical tree of root agents, sub-agents, tools, and properties. 
  - Root agents are shown with robot icons; expandable nodes for sub-agents (folder icons), tools (tools icons), and agent_tools (robot folder icons).
  - Properties (e.g., `model`, `instruction`) are leaf nodes with thematic icons (e.g., chip for model, note for instruction).
  - Right-click context menus allow adding tools or agents directly to files.
- **Refresh Support**: The `Refresh Agent Definitions` command (`agent-inspector.refreshTree`) re-scans the workspace and updates the tree in real-time.

### Navigation and Editing
- **Find Agent/Tool**: Commands like `Find Agent` (`agent-inspector.findAgent`) and `Find Tool` (`agent-inspector.findTool`) prompt for file/agent names and jump to the definition in the editor, highlighting the line.
- **Add Tool/Agent**: `Add Tool` (`agent-inspector.addTool`) and `Add Agent` (`agent-inspector.addAgentTool`) insert boilerplate Python code (e.g., `def toolName(): pass` or `Agent(...)`) at the end of selected agent files, positioning the cursor for editing.
- **Integration**: Menu items in the editor title bar and tree view for quick access.

### Running and Debugging ADK Agents
- **Run ADK Web**: The `Run ADK Web` command (`agent-inspector.runAdkWebTopBar`) spawns a terminal to run `adk web --port 5000` in the `src/agent_with_dump` directory (or equivalent), capturing stdout/stderr logs via a Python processor (`src/python/process_log.py`). It sets environment variables from `.env` (e.g., API keys, Python path) and auto-opens `http://127.0.0.1:5000` after 5 seconds.
- **Stop ADK Web**: `Stop ADK Web` (`agent-inspector.stopAdkWeb`) terminates the process and updates UI context.
- **Logging**: Logs are saved to `logs/` with timestamped directories containing JSON files (e.g., `events.json`, `state.json`, agent-specific dumps). A status bar item (`View Logs`) opens a webview for interactive viewing.

### Log Analysis and AI Insights
- **Logs JSON Viewer**: A webview panel renders log JSON as an expandable tree (arrays/objects with details/summary elements). Supports polling for live updates (every 50s), file selection from log sessions, and appending new events without full reloads.
- **AI Analysis**: Integrated Gemini-powered analysis via `src/gemini_utils.py`. Users select predefined questions (e.g., "highlight state changes") or enter custom prompts; the webview sends requests to spawn Python processes that query Gemini on log content, displaying results in a pre block. Output is logged to the "ADK Web" channel.

These features assist development by providing visibility into complex agent hierarchies, facilitating iterative editing, and enabling runtime observation with AI summaries—reducing manual debugging for multi-agent systems.

## Codebase Structure

The project is organized into directories reflecting its hybrid TypeScript/Python nature:

- **Root Files**:
  - `package.json`: Extension metadata, commands (e.g., scanning, running, viewing logs), views (Agent Definitions tree), menus (editor/title, view/item/context), and scripts (build with Webpack, lint with ESLint, test with VS Code Test CLI).
  - `tsconfig.json`, `webpack.config.js`: TypeScript compilation and bundling to `dist/extension.js`.
  - `eslint.config.js`: Linting config.
  - `README.md`, `vsc-extension-quickstart.md`: Basic setup docs.
  - `.gitignore`, `.vscodeignore`: Git and packaging exclusions.
  - `agent_structure.json`: Likely a sample or cached agent structure.
  - `travel_concierge.tar.gz`: Archived example project.
  - `agent-inspector-0.0.1.vsix`: Built extension package.

- **src/**: Core extension and analysis logic.
  - **TypeScript Files** (`*.ts`):
    - `extension.ts`: Activation entrypoint; registers commands, tree provider, terminals, webviews; handles ADK web execution and log processing.
    - `agent-tree-provider.ts`: Implements `TreeDataProvider` for hierarchical agent display; resolves references, generates tree items for properties/sub-agents/tools.
    - `agent-scanner.ts`: Spawns Python for scanning (`analysis.py`); installs deps via `requirements.txt`; parses nested JSON output into `AgentInfo` arrays.
    - `agent-scanner-lib.ts`, `agent-finder.ts`, `new-agent-scanner.ts`, `run-new-scanner.ts`: Supporting scanner variants and agent/tool location finders (e.g., regex-based line detection).
  - **Python Files** (`*.py`):
    - `analysis.py`: Core scanner; likely uses AST or regex to extract ADK `Agent` calls, builds nested tree, outputs JSON (invokes Gemini for complementing unresolved refs?).
    - `gemini_utils.py`: Handles AI prompts on logs/files using Gemini API.
    - `agent_analyzer.py`, `new-agent-scanner.py`, `patch_agent.py`: Additional analyzers, possibly for diffs or patching.
    - `requirements.txt`: Python deps (e.g., `google-adk`, `google-generativeai` for Gemini).
  - **Subdirs**:
    - `agent_with_dump/`: Includes `analysis.py` copy; possibly for runtime dumping.
    - `python/`: `process_log.py` for parsing ADK logs to JSON.
    - `test/`: `extension.test.ts` for unit tests.

- **travel_concierge/**: Example ADK agent project (Python).
  - `agent.py`: Root agent definition using `google.adk.agents.Agent`; configures Gemini model, root instructions from `prompt.py`, and composes sub-agents (inspiration, planning, booking, pre_trip, in_trip, post_trip).
  - Sub-agent dirs (`sub_agents/*/agent.py`, `prompt.py`): Modular agents with specific instructions/tools.
  - `tools/`: Shared tools like `memory.py` (itinerary loading), `places.py`, `search.py`.
  - `shared_libraries/`: Types (`types.py`), constants (`constants.py`).
  - `profiles/`: JSON itineraries (e.g., Seattle example).
  - `requirements.txt`: ADK-specific deps.
  - `agents.code-workspace`: VS Code workspace config.
  - `logging_agent.py`, `prompt.py`: Logging and global prompts.
  - `scrapfile`: Temporary notes.

- **logs/**: Runtime-generated; timestamped dirs with JSON (e.g., `events.json`, `state.json`, agent dumps like `root_agent.json`).

- **docs/**: `OVERVIEW.md` for high-level docs.

- **.vscode/**: Extension settings.

The build process uses `npm run compile` (Webpack) and `vsce package` for `.vsix`. Dev deps include TypeScript, ESLint, VS Code types; runtime includes `dotenv` for env vars.

## Example Project

The `travel_concierge/` directory serves as a sample multi-agent ADK application: a travel concierge AI that orchestrates sub-agents for trip phases (inspiration, planning, booking, pre-trip, in-trip, post-trip). 

- **Root Agent** (`agent.py`): Entry point with Gemini-2.5-flash model; loads itineraries via `before_agent_callback`; routes to sub-agents based on user queries.
- **Sub-Agents**: Each handles a stage (e.g., `inspiration_agent` suggests ideas; `booking_agent` manages reservations). They use shared tools for search/places/memory.
- **Tools and Prompts**: Modular tools (e.g., Google Places API integration implied); stage-specific instructions in `prompt.py` files.
- **Usage**: Run via `adk web` to expose as a conversational interface; extension scans this to visualize the hierarchy (root → sub-agents → tools).

This example demonstrates ADK's composability, which the extension visualizes and aids in extending (e.g., adding tools).

## Future Directions

Potential enhancements include:
- Deeper Gemini integration for auto-generating agent code or resolving references dynamically.
- Support for more languages beyond Python (e.g., JS ADK if available).
- Advanced log visualization (e.g., timelines, error highlighting).
- Integration with ADK CLI for direct testing/debugging from the tree view.
- Export agent structures to diagrams (e.g., Mermaid flowcharts).

This extension bridges IDE tools with ADK, accelerating agent development cycles.