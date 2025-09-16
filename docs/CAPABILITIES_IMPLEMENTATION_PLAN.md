Implementation Plan for "Agent Configurator" VS Code Extension
==============================================================

Overview
--------

This plan outlines a complete design for the **Agent Configurator** VS Code extension, which will streamline configuring and deploying Google Agent Development Kit (ADK) agents. The extension will provide an intuitive UI (in VS Code’s Activity Bar) to configure agent settings, manage deployment to Vertex AI Agent Engine, integrate with Vertex AI Memory Bank, and ensure Agent-to-Agent (A2A) compatibility. It will leverage VS Code’s Extension API with Node.js/TypeScript for the UI and control flow, and use Python (via the ADK and Vertex AI SDK) for heavy-lifting tasks like deployment and agent validation where appropriate. We place strong emphasis on using **Google Application Default Credentials (ADC)** for authentication (via gcloud CLI or service account keys) and on secure handling of any credentials. Key design elements (status bar indicators, Activity Bar icons, etc.) will mirror the Google Cloud Code extension for a familiar cloud development experience.

UI for Agent Configuration (Activity Bar Panel & Webview)
---------------------------------------------------------

*   **Activity Bar View Container:** The extension will contribute a new icon to VS Code’s Activity Bar (e.g. a robot or cloud-agent icon). This is achieved by adding a **View Container** contribution in the extension manifest. The container (e.g. `"id": "agentConfigurator"` with title "Agents") will host custom views for agent configuration[code.visualstudio.com](https://code.visualstudio.com/api/ux-guidelines/activity-bar#:~:text=Activity%20Bar)[code.visualstudio.com](https://code.visualstudio.com/api/ux-guidelines/activity-bar#:~:text=,to%20open%20a%20Webview%20Panel). Following VS Code guidelines, we’ll use a distinct icon that matches the style of default icons (e.g. a codicon or custom SVG) and a clear name (like “Agent Config”)[code.visualstudio.com](https://code.visualstudio.com/api/ux-guidelines/activity-bar#:~:text=%E2%9C%94%EF%B8%8F%20Do).
    
*   **Agent Configuration Panel (Webview View):** Inside the view container, we will implement a **Webview-based panel** to provide a rich UI for configuring an agent. Using `vscode.window.registerWebviewViewProvider`, we can create a webview that is docked in the sidebar (Activity Bar panel) instead of a separate window. The webview will load an HTML/JS UI built with a front-end framework or plain HTML forms. This UI will allow the user to **view and edit each ADK agent’s settings** (for example: agent name, description, model, tools/skills, etc.). It will present a form with input fields populated from the agent’s current configuration and allow edits.
    
    *   _Implementation:_ The extension’s TypeScript code will provide the HTML content (potentially from a `webview/build` directory if using a bundler) and use the VS Code Webview API to communicate. For instance, on webview load, the extension can call `webview.postMessage({ type: 'init', data: agentConfig })` to send the current agent settings to populate the form. When the user changes values or clicks a button (e.g. “Save” or “Deploy”), the webview JS will send messages back (`vscode.postMessage({ type: 'update', data: {...} })`). The extension will listen to these via `webviewView.webview.onDidReceiveMessage` and handle them accordingly.
        
    *   _Why Webview:_ A webview allows a flexible, responsive form UI far beyond what basic TreeView or QuickPick inputs can offer. We can include dropdowns for models, multi-select for tools, and rich text instructions. It’s appropriate here because configuring an agent involves multiple fields and possibly dynamic validation, which a webview can handle with familiar HTML/JS code[code.visualstudio.com](https://code.visualstudio.com/api/ux-guidelines/activity-bar#:~:text=,to%20open%20a%20Webview%20Panel).
        
*   **Alternative (TreeView List):** Optionally, we could use a Tree View to list agents and their sub-items (status, config, etc.) using `vscode.window.createTreeView`. For example, if a workspace has multiple ADK agent definitions, each could appear as a tree item. Selecting one could reveal child nodes (like “Model: gemini-2.0”, “Memory: Attached”, “A2A: Enabled”) and allow context menu actions (like “Deploy” or “Edit”). However, for editing complex agent properties, a TreeView alone is limited. The likely approach is a **hybrid**: use a Tree or list view to select an agent, and show detailed config in a webview form on the side or in a separate panel when editing.
    
*   **UI Form Contents:** The configuration webview will include:
    
    *   Basic agent metadata fields: **Name, Description, Instruction prompt, Model** selection, etc. (If the ADK agent is defined in code, these correspond to properties of the `Agent` or `LlmAgent` object).
        
    *   **Tools/Skills configuration:** A list of tools the agent can use (from the agent’s code). This could be displayed as a checklist or list of tool names and descriptions. The UI can read from the agent definition (perhaps via Python introspection or a descriptor file) to list available tools.
        
    *   **Memory settings:** Options to enable or configure Memory Bank usage – for instance a toggle or indicator if Vertex AI Memory is linked, and controls to attach/detach memory (discussed more below).
        
    *   **A2A settings:** Indicators for Agent-to-Agent readiness (is an Agent Card present? how many skills defined?) and a button to auto-generate missing A2A metadata if needed.
        
    *   **Deploy/Run controls:** Buttons to deploy the agent to Vertex AI or to start/stop it, with status shown (disabled/enabled based on current state).
        
*   **Dynamic Updates:** As the user edits fields, we’ll ensure those changes can be saved back to the agent’s source. If the agent is defined in Python code, direct two-way editing is tricky (we’d have to edit the Python file). Instead, the extension might maintain a separate config (like a JSON or YAML) representing the agent’s settings. One approach: generate an **“agent config” JSON** in the workspace that mirrors the code. The webview edits update this JSON, and the extension can prompt the user to also update the Python code accordingly. (We can’t automatically refactor Python AST easily in this plan, so possibly the extension will treat the JSON as authoritative for deployment settings, while the Python code is the logic.)
    
    *   Another approach: simply use the UI to override certain settings at deployment time (e.g. use a different model than the code defaults, without modifying code). This may be acceptable if the ADK deployment API allows passing a modified config.
        
*   **Persistence of UI State:** The extension will persist any explicit configuration outside the code using VS Code’s storage (workspace state or a config file). For example, if the user sets a preferred Vertex region or staging bucket, those can be saved so the UI remains pre-filled next time.
    

Deployment to Vertex AI Agent Engine (Start/Stop Capabilities)
--------------------------------------------------------------

*   **Deployment Workflow:** The extension provides a **“Deploy”** command (accessible via a button in the UI and the Command Palette). This triggers deploying the selected ADK agent to the Vertex AI Agent Engine service on Google Cloud[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=adk_app%20%3D%20AdkApp)[google.github.io](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=Once%20you%20are%20satisfied%20with,line%20tool). Under the hood, deployment involves packaging the agent’s code, uploading it, and creating or updating a managed agent instance in Vertex AI. We will utilize the Vertex AI SDK (Python) or ADK CLI to perform these steps:
    
    *   **Using Python SDK:** Upon deploy, the extension will spawn a **Python process** (ensuring the environment has `google-cloud-aiplatform[adk,agent_engines]` installed). The Python script will do what the official docs describe: call `vertexai.Client(project=..., location=...)`, wrap the agent object in `AdkApp`, then call `client.agent_engines.create(...)` or `.update(...)`[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=,aiplatform%5Bagent_engines%2Cadk%5D%22%5D)[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=,name%2C%20agent_engine%3Dadk_app%2C%20config). This creates a new Agent Engine instance if none exists (with a fresh Memory Bank) or updates an existing one, respectively. The code from Google’s quickstart can be adapted directly[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=,aiplatform%5Bagent_engines%2Cadk%5D%22%5D)[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=,name%2C%20agent_engine%3Dadk_app%2C%20config). We’ll include a Cloud Storage staging bucket in the config as required (the user will be prompted to provide a GCS bucket name on first use, which we’ll store). The extension monitors the Python process output for progress or errors. We can surface logs in a VS Code Output Channel (e.g. “Agent Configurator”) and show a notification when deployment succeeds or fails.
        
        *   On success, the Python script will output the new **Agent Engine resource name** (e.g. `projects/<proj>/locations/<region>/reasoningEngines/<ID>`). The extension captures this and stores it as the **current deployed Engine ID** for the agent[google.github.io](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=print%28f,projects%2F%7BPROJECT_NUMBER%7D%2Flocations%2F%7BLOCATION%7D%2FreasoningEngines%2F%7BRESOURCE_ID). This ID is crucial for later interactions.
            
        *   _Note:_ Instead of writing a custom script each time, we could bundle a small Python helper in the extension or use the ADK CLI. The **ADK CLI** offers an `adk deploy agent_engine ...` command[google.github.io](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=You%20can%20deploy%20from%20your,is%20discoverable) that could be invoked via Node’s `child_process.exec`. This might simplify deployment (packaging logic handled by CLI). However, using the SDK directly gives us more control and integration (and avoids needing the user to install the CLI separately).
            
    *   **Start/Stop Controls:** Once deployed, the agent is effectively “running” on the Agent Engine. We will show its status in the UI (for example, a green light or “Deployed: Yes” with the engine ID). To support “stop”, we provide a **“Stop Agent”** button/command. Stopping an agent likely means **deleting** the deployed Agent Engine instance (there isn’t a pause for the managed service, so deletion is how to stop incurring costs)[google.github.io](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=Step%207%3A%20Clean%20up%C2%B6). The extension will call `client.agent_engines.delete(name=...)` or use the resource handle’s `.delete()` method (with `force=True` to also remove sessions)[google.github.io](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=After%20you%20have%20finished%2C%20it,on%20your%20Google%20Cloud%20account). This will shut down the agent runtime (and, as noted in docs, also delete associated sessions or resources unless we choose to preserve memory)[google.github.io](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=After%20you%20have%20finished%2C%20it,on%20your%20Google%20Cloud%20account). We’ll confirm with the user (yes/no dialog) before deletion to avoid accidental loss.
        
        *   After a stop, the UI status will update to “Not deployed” (and possibly offer a re-deploy option). The stored engine ID can be cleared or kept (if we anticipate reusing it via update, though once deleted it’s invalid).
            
    *   **Update vs Create on Deploy:** If an Engine ID is already stored for this agent (meaning it was deployed before), the extension will ask if the user wants to **update** that existing instance (to reuse its memory store) or deploy a fresh instance. By default, we can update in place for iterative development: calling `agent_engines.update(name=<existing>, agent_engine=AdkApp(...))` uses the existing Engine (including its Memory Bank)[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=,name%2C%20agent_engine%3Dadk_app%2C%20config). This accelerates re-deployment and preserves long-term memory. The UI might have a toggle or separate command “Deploy (New Instance)” if the user explicitly wants a new clean deployment.
        
*   **Integration with VS Code Tasks/Progress:** Deployment can take some time (it builds a container etc.). We will use VS Code’s progress notification API to inform the user. For example, `vscode.window.withProgress` with `Location.Notification` can show “Deploying agent to Vertex AI…” with an indeterminate progress bar. The extension can update status (like step messages from the Python output) if needed. On completion, we show a success message with the agent’s ID.
    
*   **Post-Deployment Actions:** After deploying, besides updating the UI status, we could offer quick actions:
    
    *   “Open in Cloud Console” – open the Vertex AI console to the Agent Engine section (since the Agent Engine UI can show deployment status and logs[google.github.io](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=Monitoring%20and%20Verification)).
        
    *   “Test Agent” – possibly initiate a test query via the extension (though full chat with agent may be outside this extension’s scope, we could send a simple query using the Vertex AI API or direct ADK).
        
    *   “Attach Memory” – if not already handled (see next section).
        

Integration with Vertex AI Memory Bank
--------------------------------------

*   **Memory Bank Concepts:** Vertex AI Memory Bank provides long-term conversational memory for agents, keyed by user ID[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/overview#:~:text=Vertex%20AI%20Agent%20Engine%20Memory,session%20continuity)[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/overview#:~:text=%2A%20Similarity%20search,scope). In Agent Engine, each agent instance typically has an **associated Memory Bank** by default. When we deploy an ADK agent to a new Agent Engine, the instance comes with an empty Memory Bank ready to use[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=,aiplatform%5Bagent_engines%2Cadk%5D%22%5D). If we deploy by updating an existing Engine, the agent retains access to that engine’s existing memories[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=,name%2C%20agent_engine%3Dadk_app%2C%20config). Our extension will make this Memory Bank linkage clear to the user and provide tools to manage it:
    
    *   When deploying **new**: The extension will note that a new Memory Bank is created (implicitly). We can show in the UI “Memory: New (empty)” after first deploy.
        
    *   When **updating** an agent: UI will indicate “Memory: Attached” (meaning the agent is connected to an existing memory store with potentially some data). We’ll surface the engine ID as the memory identifier since Memory Bank is scoped to the agent engine instance.
        
*   **Linking Existing Memory:** The extension will let users deploy an agent in a way that **reuses an existing Memory Bank**. For example, if they have an agent already deployed (Engine ID X) and want to deploy a new version of that agent code but keep the accumulated memory, they should update X rather than create a new engine. In the “Deploy” workflow, if an Engine ID is already stored for the agent, we default to update (reuse memory)[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=,name%2C%20agent_engine%3Dadk_app%2C%20config). If the user wants to attach this agent to a different memory (say, use the memory from another agent’s instance), they could provide that other instance’s ID. We might include an **“Advanced: Link to another Memory Bank”** field where the user can input an Engine ID to update. This effectively means “deploy my agent code onto the specified existing engine (thus adopting its memory)”. We will need to warn if the engine is running a different agent; updating it will replace the agent code but preserve memory data.
    
    *   We can assist by listing existing Agent Engine instances in the project (by calling `client.agent_engines.list()` via Python or invoking `gcloud` command to list them). A dropdown of existing agent names/IDs could be shown for selection.
        
*   **Creating Memory Bank for Local Testing:** In some cases, a developer might want to use Memory Bank while running the agent **locally (not deployed)**. The ADK allows this by using `VertexAiMemoryBankService` in the runner, which requires an Agent Engine ID to store/retrieve memories[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=). Our extension can simplify this setup:
    
    *   Provide a command **“Create Memory Bank (for local use)”** that behind the scenes deploys a minimal placeholder agent to Agent Engine just to obtain a Memory Bank ID. However, a cleaner way is to let the user create an agent engine instance via the API without necessarily using it for queries. This might not be directly supported without an agent, so the workaround is deploying the agent then not really using it beyond memory. This is somewhat edge, so we might skip automatic creation.
        
    *   Alternatively, if the agent is already deployed once, we can just use that ID for local sessions. The extension can detect the engine ID and help the user configure the ADK Runner to use it. For example, after deployment, we could insert a snippet or set an environment variable that the local code picks up: `os.environ["AGENT_ENGINE_ID"] = "<ID>"`. Or instruct the user to call `VertexAiMemoryBankService(project, location, agent_engine_id=ID)` in their code[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=). These instructions can be shown as a tooltip or in documentation within the extension.
        
*   **UI Indication and Controls:** The Activity Bar view will have a section for Memory Bank. For example:
    
    *   If memory is active: “**Memory Bank:** Connected (Engine `<ID>`)".
        
    *   If memory is not yet used: “**Memory Bank:** None” or “Not enabled”.
        
    *   A button or link “Configure Memory” that opens options: e.g. **Attach** (choose an engine to use for memory) or **Create New** (deploy new agent engine).
        
    *   Possibly a view of memory entries (though retrieving actual memory content might be out of scope). We might at most open the Google Cloud Console’s Memory Bank UI for the user (since Google now provides a UI in console[discuss.google.dev](https://discuss.google.dev/t/new-memory-bank-ui-is-now-available-in-vertex-ai-agent-engine/264765#:~:text=Engine%20discuss,LIVE%20in%20the%20Cloud%20Console)).
        
*   **Memory Bank Creation/Attachment Implementation:**
    
    *   For **attach existing**: we’ll prompt for an Engine ID or offer a list. Then on deployment, instead of creating new, we call update on that ID (as described). If the agent was not previously deployed anywhere, we can still use update if the user supplies an ID of some other engine, effectively swapping in this agent’s code there.
        
    *   For **new memory**: deploying a new agent engine is essentially how to get a new memory. So “Create new Memory Bank” will just deploy the agent to a new Engine (perhaps even if it’s already deployed elsewhere). It results in a second instance, which might not be the common path. We’ll clarify usage to the user to avoid confusion (most will either update or create one instance and stick to it).
        
*   **Memory and Agent Code Integration:** If the agent’s code doesn’t already have a Memory Tool or service configured, the extension can warn or help add it. For example, if the agent doesn’t include `PreloadMemoryTool` or doesn’t override memory\_service, it might not actually use Memory Bank at runtime[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=1,memories%20in%20the%20system%20instruction)[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=2.%20Create%20a%20,defining%20your%20own%20ADK%20runtime). We can detect this by scanning the agent code for usage of memory (e.g. `VertexAiMemoryBankService` or memory tools). If missing, the extension can offer to **insert a Memory tool** into the agent (like adding `adk.tools.preload_memory_tool.PreloadMemoryTool()` to its tool list in code)[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=1,memories%20in%20the%20system%20instruction)[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=4.%20%20,tools%3D%5Badk.tools.preload_memory_tool.PreloadMemoryTool%28%29%5D). Alternatively, we inform the user in the UI (“Memory Bank is linked but your agent is not using it – consider adding a Memory tool to your agent’s tool list”). This ensures the agent actually takes advantage of the Memory Bank integration.
    
*   **Citation:** In summary, by using the Engine API’s create/update, we automatically manage Memory Bank: _“The Agent Engine instance will also include an empty Memory Bank”_ when created, and updating an existing engine means _“the agent will have access to the instance’s existing memories”_[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=,aiplatform%5Bagent_engines%2Cadk%5D%22%5D)[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=,name%2C%20agent_engine%3Dadk_app%2C%20config). This behavior is leveraged by our extension to let the user choose between new or existing memory contexts as part of deployment.
    

Agent-to-Agent (A2A) Compatibility Checks
-----------------------------------------

*   **Understanding A2A:** Agent-to-Agent Protocol (A2A) is an open standard that lets AI agents discover and communicate with each other via standardized descriptors and endpoints[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=A2A%20allows%20agents%20to%3A)[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=The%20A2A%20protocol%20facilitates%20this,their%20capabilities%20and%20connection%20information). Two key components of making an agent A2A-compatible are:
    
    1.  An **Agent Card** – a JSON metadata document (often served at `/.well-known/agent.json`) that describes the agent’s identity, capabilities, and skills[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=The%20A2A%20protocol%20facilitates%20this,their%20capabilities%20and%20connection%20information)[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=control%20over%20what%20you%20want,Python%20SDK%20under%20the%20hood).
        
    2.  **Agent Skills** – discrete abilities or APIs the agent exposes, listed as part of the Agent Card (with an `id`, description, and maybe input/output examples for each skill)[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=,actions%20to%20achieve%20complex%20goals)[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=An%20,get_exchange_rate).
        
*   **Why It Matters:** If the developer plans to have agents call each other (multi-agent systems), each agent should advertise what it can do. Our extension will assist by checking that the agent has the necessary A2A descriptors and offering to generate them if not:
    
    *   We will parse or inspect the project to see if an **Agent Card JSON** exists (commonly `agent.json` or similar in the project). If not, or if it’s incomplete, a warning will show: “Agent Card not found – required for A2A.”
        
    *   We will also check if the agent’s code defines any **skills**. In ADK terms, if using the A2A SDK, the developer might have created `AgentSkill` and `AgentCard` objects in code[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=An%20,get_exchange_rate)[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=,capabilities%3DAgentCapabilities%28streaming%3DTrue%29%2C%20skills%3D%5Bskill), or used `to_a2a()` which auto-generates an Agent Card from the agent definition[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=control%20over%20what%20you%20want,Python%20SDK%20under%20the%20hood). If none of these are present, it means A2A isn’t configured.
        
*   **Auto-Generation of Agent Card/Skills:** To simplify the process:
    
    *   The extension can leverage the **A2A Python SDK** (or ADK’s `to_a2a`) to generate an Agent Card. For example, we can write a Python routine that imports the user’s agent (perhaps by running the agent’s module) and uses `google.adk.a2a.utils.to_a2a(agent)` to produce an A2A-enabled app, which under the hood will create an Agent Card object[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=control%20over%20what%20you%20want,Python%20SDK%20under%20the%20hood). Instead of serving it, we can intercept the generated card. The `to_a2a` function likely returns a FastAPI app that includes the card data; if accessible, we can extract the card (or we could run the app locally and fetch `/.well-known/agent.json` from it). This might be complex, so a more direct approach: use the **A2A SDK models**. We can programmatically create an `AgentCard` by instantiating its fields:
        
        *   Name and description from the agent (the ADK agent object has `name` and `description` attributes).
            
        *   Skills from the agent’s tools. If the agent’s tools are standard functions or ADK tools, we can map each to an `AgentSkill`. For instance, if a tool is a function `get_weather`, we can set `id="get_weather"`, name from the function name or docstring, and description either from a docstring or a placeholder explaining the tool’s purpose. Tags can be default (like `["tools"]`)[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=An%20,get_exchange_rate).
            
        *   Capabilities – we know if the agent supports streaming or other features (e.g. ADK’s use of streaming – we could default to streaming=True since many agents do).
            
        *   Preferred modes (text input/output are typical)[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=,capabilities%3DAgentCapabilities%28streaming%3DTrue%29%2C%20skills%3D%5Bskill).
            
    *   The extension can provide a **“Generate Agent Card”** command. This will run the above logic (via Python) to produce an Agent Card JSON. We then present the JSON to the user by either:
        
        *   Opening it in a new editor tab (in-memory, allowing them to review and save).
            
        *   Or automatically saving to a default path in the workspace (like `.well-known/agent.json` or `agent_card.json`), then informing the user.
            
        *   The user can then deploy this card to a hosting environment if they plan to run an A2A server (for Vertex Agent Engine, the agent isn’t automatically exposed via A2A; A2A is more for agents running as independent services, e.g., via `uvicorn` as in ADK examples).
            
    *   The extension can also **auto-generate Agent Skills** if none are defined. This might involve scanning the agent’s code for tool functions. For example, if in code we find functions or ADK Tool classes, we infer one skill per tool. These auto-generated skills might have generic descriptions (“Skill for function X – description not provided”) which the user should refine. The extension could highlight those fields in the UI for the user to edit (e.g. in the webview form, list generated skills and allow editing their name/description/tags).
        
*   **Validation Checks:** Whenever the user tries to enable A2A mode or deploy in a context where A2A is expected, we run checks:
    
    *   Ensure the agent has a **name and description** (non-empty) – required for Agent Card.
        
    *   Ensure at least one **skill** is defined if the agent has any tool functionality. If no obvious skill, we warn that the agent will have nothing to advertise (we could still generate a default “conversation” skill representing it can chat, but it’s better to list actual tools).
        
    *   If an Agent Card JSON exists but is outdated (maybe the agent’s capabilities changed), we might suggest re-generating it.
        
    *   These checks can be run on demand via an **“A2A Compatibility Check”** command or automatically when preparing for deployment if an A2A setting is toggled.
        
*   **A2A UI Elements:** In the Activity panel UI, we might have a section labeled **“Agent2Agent Compatibility”**. It could display:
    
    *   “Agent Card: ✅ Present” or “❌ Not found”,
        
    *   “Skills: X skills defined” or “❌ None defined”.
        
    *   If not OK, a button “Auto-generate card” (or separate “Generate Agent Card” and “Generate Skills” actions). If OK, maybe a “View Agent Card” to open the JSON.
        
    *   We will also include a short explanation in the UI (tooltip or documentation link) about what Agent Cards and Skills are, given not all users will be familiar. For example: _“Agent Card is a JSON file advertising this agent’s capabilities and skills for A2A interoperability[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=The%20A2A%20protocol%20facilitates%20this,their%20capabilities%20and%20connection%20information). Generate one to enable other agents to discover and invoke this agent.”_
        
*   **Leverage ADK for A2A:** If the agent is intended to run as an A2A server (not just in Agent Engine), the developer would use `to_a2a()` in their code (as shown in ADK examples)[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=control%20over%20what%20you%20want,Python%20SDK%20under%20the%20hood). Our extension can detect usage of `to_a2a` or `uvicorn` run commands. If it finds them, it knows an Agent Card is likely auto-generated at runtime. In such cases, we can still allow export of that card. Perhaps a **“Fetch Agent Card from running agent”** if the agent is currently running locally. But that’s an edge scenario; our main focus is static generation when needed.
    
*   In summary, the extension ensures that if multi-agent communication is desired, the user is guided to have the proper A2A metadata. This prevents situations where an agent tries to call another but can’t discover any skills due to missing Agent Card[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=,actions%20to%20achieve%20complex%20goals)[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=The%20A2A%20protocol%20facilitates%20this,their%20capabilities%20and%20connection%20information). By offering automated generation using the A2A SDK, we make it easy to create a standard-compliant Agent Card containing the agent’s skills and connection info (like URL if running as server)[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=The%20A2A%20protocol%20facilitates%20this,their%20capabilities%20and%20connection%20information)[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=,capabilities%3DAgentCapabilities%28streaming%3DTrue%29%2C%20skills%3D%5Bskill).
    

Authentication via Google Application Default Credentials (ADC)
---------------------------------------------------------------

*   **Strict ADC Usage:** The extension will _not_ implement a custom OAuth flow or ask for raw credentials. Instead, it relies on Google’s Application Default Credentials (ADC) system for authorization to Google Cloud. This ensures we leverage existing and secure authentication methods:
    
    *   Users can authenticate by running `gcloud auth application-default login` externally, which will handle OAuth in the browser and save credentials to the ADC location on their machine[google.github.io](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=2,following%20command%20in%20your%20terminal). This is the recommended approach in Google’s docs and will update the ADC that Google SDKs use[cloud.google.com](https://cloud.google.com/code/docs/vscode/install#:~:text=Authenticate%20credentials%20for%20Google%20Cloud).
        
    *   Alternatively, users who have a Google Cloud Service Account JSON key can use that. The extension will allow them to **provide a service account key file** (via an open file dialog) – which we then load as ADC for the extension’s processes.
        
*   **Auth Status Bar Item:** To make auth status visible (and similar to Cloud Code’s UX), we will include a **VS Code Status Bar item** showing the active GCP account and project. For example, a left-side status bar item with a cloud icon and text like “GCP: user@gmail.com (Project XYZ)”[cloud.google.com](https://cloud.google.com/code/docs/vscode/install#:~:text=Change%20the%20active%20Google%20Cloud,project). This mirrors Cloud Code, where the status bar shows the active account and project and is clickable for options[cloud.google.com](https://cloud.google.com/code/docs/vscode/install#:~:text=If%20you%20aren%27t%20signed%20in,these%20steps%20to%20sign%20in)[cloud.google.com](https://cloud.google.com/code/docs/vscode/install#:~:text=1,click%20the%20active%20project%20name). _In Cloud Code’s status bar, clicking the project name opens a project switcher[cloud.google.com](https://cloud.google.com/code/docs/vscode/install#:~:text=Change%20the%20active%20Google%20Cloud,project), and clicking the sign-in area starts authentication[cloud.google.com](https://cloud.google.com/code/docs/vscode/install#:~:text=If%20you%20aren%27t%20signed%20in,these%20steps%20to%20sign%20in). We’ll emulate that behavior._
    
    *   **Sign-in via gcloud:** If no ADC is detected (the extension can attempt a test API call on startup to see if credentials are valid), the status bar might show “GCP: Not Authenticated \[Sign in\]”. Clicking it can prompt: “Run gcloud auth login” or open an external link with instructions. We could even automate this by spawning `gcloud auth application-default login` in a terminal. VS Code’s `Terminal` API can open a new terminal and run the command, so the user can complete the auth flow. Once done, we detect that ADC is now present and update the status.
        
    *   **Using a Service Account key:** We will add an option (perhaps in a dropdown if the user clicks the status bar item or a command palette entry) to **“Use Service Account Credentials”**. This triggers a file picker for a JSON file. After the user selects a file, we load it (the JSON contains a service account email and private key). We then configure the extension to use it:
        
        *   The Node.js Google Cloud libraries will pick up ADC from environment. We can set the `GOOGLE_APPLICATION_CREDENTIALS` env var in our extension process to point to that JSON file path[google.github.io](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=2,following%20command%20in%20your%20terminal). We can also set it for any spawned Python processes so they automatically use it. We will **not** print this path or content in any logs. The file itself remains wherever the user had it; we won’t copy it into our extension (to avoid handling sensitive key material).
            
        *   Alternatively, we could read the JSON and use Google’s Auth library to authorize, but storing the raw key in memory is sensitive. It’s safer to rely on the well-tested ADC mechanism by just pointing to the file.
            
*   **Security for Credentials:** Because credentials are highly sensitive, we incorporate these measures:
    
    *   Do not store service account JSON content on disk or in plain text settings. If we need to remember which file was used, we might store the _file path_ (which is not as sensitive as the content) in the extension’s global state. Even that can be optional – the user might prefer to pick it each session. If we do store a path, we will allow clearing it easily (e.g. a “Sign Out” action).
        
    *   If storing any token or key, use VS Code’s **Secret Storage** API to encrypt it. For example, if we extract an access token (not needed for ADC, but say we did OAuth), we’d store it via `context.secrets.store('googleToken', token)` which is encrypted and saved in the OS keychain[medium.com](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=Think%20of%20it%20like%20a,your%20system%E2%80%99s%20secure%20credential%20store). SecretStorage ensures data is safe (on Mac it’s in Keychain, Windows Credential Manager, etc.)[medium.com](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=The%20storage%20location%20varies%20by,each%20system%E2%80%99s%20native%20secure%20storage).
        
    *   We will **never commit credentials into source control or logs**. The extension’s logging (Output Channel) will be careful to sanitize error messages – e.g. if a JSON key is invalid, the error might include the path but not the key contents.
        
    *   On the Python side, the ADC is automatically handled by Google’s client libraries, which use the ADC file or env var. We won’t manually pass credentials in code, avoiding accidental exposure.
        
*   **Active Account Info:** For user convenience, we’d like to display which account is active. With ADC via gcloud user login, the ADC file typically contains a refresh token tied to the user’s Google account. We can attempt to read the email from gcloud. For example, running `gcloud auth list --filter=status:ACTIVE --format=value(account)` would yield the active account email. We can run this in a child process and update the status bar text. For service account JSON, the `client_email` field can be read to get the account identity. We’ll show that (e.g. “Service Account: name@project.iam.gserviceaccount.com”).
    
    *   _Note:_ Cloud Code’s status bar actually integrates with the Google OAuth flow they implement (which updates ADC)[cloud.google.com](https://cloud.google.com/code/docs/vscode/install#:~:text=Authenticate%20credentials%20for%20Google%20Cloud), but since we rely on external auth, we’ll simply reflect whatever ADC is in use. This is in line with Cloud Code’s approach of using your gcloud credentials[marketplace.visualstudio.com](https://marketplace.visualstudio.com/items?itemName=GoogleCloudTools.cloudcode#:~:text=,that%20are%20meaningful%20to%20you) (they highlight a _“simplified authentication workflow that uses your Google Cloud credentials”_[marketplace.visualstudio.com](https://marketplace.visualstudio.com/items?itemName=GoogleCloudTools.cloudcode#:~:text=,that%20are%20meaningful%20to%20you)).
        
*   **Project Selection:** Along with authentication, the Google Cloud **Project ID** is important (it’s needed for API calls and deployment). We will let the user configure the active project:
    
    *   If the user has run gcloud, there’s often a default project set. We can attempt to read `gcloud config get-value project`. However, for clarity, our extension will have its own notion of active project (which might override gcloud’s if needed).
        
    *   The status bar item will display the project name next to the account[cloud.google.com](https://cloud.google.com/code/docs/vscode/install#:~:text=1,click%20the%20active%20project%20name), and clicking it opens a quick-pick list of projects. We can retrieve projects by using the Resource Manager API (with the ADC credentials) or invoking `gcloud projects list`. For performance, we might just allow manual entry of a project ID (with a history of recently used).
        
    *   The **Project selection** UI will be similar to Cloud Code: a quick pick where the user selects from available projects, or enters one. After selection, we update the status bar text and store the choice (likely in workspaceState for that project, or globalState if we want it persistent across workspaces) so it’s remembered.
        
    *   This project ID will be used whenever we call Vertex AI SDK (we pass it to `vertexai.Client(project=...)`).
        
*   **Service Account Key Storage:** If a user uses a JSON key, we might want to persist that choice across sessions (so they don’t have to pick file every time). We have two options:
    
    *   Store the **path** in `context.globalState` (which is persisted across VS Code restarts)[medium.com](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=Global%20State). On next activation, if the file exists at that path, we can auto-set ADC from it. We must ensure to handle errors (file moved or permission issues).
        
    *   Alternatively, store the file’s content in `context.secrets`. This is secure, but storing the entire JSON might be slightly heavy (though likely fine) and requires converting the JSON to a string. It’s doable and ensures if the original file is lost, we still have creds, but it might be overkill. We likely stick to storing the path (less sensitive).
        
    *   The user can always re-enter if needed, which might be acceptable given it’s infrequent.
        
*   **Sign Out/Revoke:** Provide a **“Sign Out”** action. For user ADC (gcloud login), we can call `gcloud auth application-default revoke` which removes the stored ADC credentials. For a service account, “sign out” would simply clear the stored path/secret and unset env var. After sign-out, the status bar updates to “Not Authenticated” and the extension will refuse to deploy or list projects until re-authenticated.
    
*   **Permissions:** The extension will assume the credentials used have adequate permissions:
    
    *   To deploy an agent: requires roles like Vertex AI User or specific Agent Engine permissions (and access to Cloud Storage for staging). We will handle errors if permissions are lacking by showing the error message returned by Google (and perhaps linking to documentation for required roles).
        
    *   For Memory Bank: same credentials cover it because Memory Bank is part of Vertex AI. If using a user’s ADC, ensure they have Vertex AI access. If using a service account, inform the user to grant the necessary IAM roles (we might document that in the README).
        
*   **Testing ADC:** We might on extension startup run a quick test (like `vertexai.init()` or list projects) to validate credentials. If it fails (no credentials or expired), we proactively prompt to authenticate.
    
*   By sticking strictly to ADC, we align with Google’s recommended auth flow for local development. This avoids having to embed any client secrets in our extension and leverages the user’s existing login session[google.github.io](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=2,following%20command%20in%20your%20terminal). It’s simpler and more secure (Cloud Code does something similar by integrating with gcloud and ADC for local use[cloud.google.com](https://cloud.google.com/code/docs/vscode/install#:~:text=Authenticate%20credentials%20for%20Google%20Cloud)).
    

UI Design and Cloud Code Parallels
----------------------------------

_Figure: The Cloud Code extension uses a status bar item (bottom left) to display the active Google Cloud account and project._ Our Agent Configurator will follow similar design patterns to integrate seamlessly into VS Code. Key UI elements include:

*   **Status Bar Indicators:** A status bar item will show the active Google account and project context, just as Cloud Code does (e.g. “🌐 user@example.com • my-project” with a cloud icon)[cloud.google.com](https://cloud.google.com/code/docs/vscode/install#:~:text=1,click%20the%20active%20project%20name). This item will update in real-time when the user switches projects or logs in/out. Clicking it opens a menu for auth and project options:
    
    *   If not logged in: “Sign in to Google Cloud” (which triggers ADC login as discussed).
        
    *   If logged in: options to **Sign Out** and **Switch Project**. The “Switch Project” will list projects similar to Cloud Code’s project picker[cloud.google.com](https://cloud.google.com/code/docs/vscode/install#:~:text=1,click%20the%20active%20project%20name). We’ll include the current project at top and list others with their Project ID and name for clarity.
        
    *   Possibly show the current GCP region as well if relevant (for Vertex AI, the user might choose a region like us-central1). This could be part of the project display or a separate status item. We might default to a region (us-central1) but allow changing it via a command or setting.
        
*   **Activity Bar Icon:** We will contribute an icon to VS Code’s Activity Bar for our extension (likely appearing along with Explorer, Search, Source Control, etc.). Cloud Code, for example, adds its icon (Google Cloud logo) to the Activity Bar[cloud.google.com](https://cloud.google.com/code/docs/vscode/install#:~:text=4,Code). Our icon should represent an AI agent or Google Vertex AI. Perhaps a robot head or sparkles (if using codicons, maybe `codicon-debug-alt` as a robot icon). The icon will open our **Agent Configurator View**.
    
*   **Agent Configurator View:** In the Activity side panel (once our icon is clicked), the user will see the custom view we implement. The layout of this view could be structured as follows:
    
    *   **Authentication/Project Section:** At the top, a small section showing “Account: \[account/email\]” and “Project: \[project-id\]” with edit buttons or clickable text. This duplicates the status bar info but in the panel we have more room to include an explicit “Change” button. Also, if no auth, a prominent **“Connect to Google Cloud”** button could appear here.
        
    *   **Agent List/Selector:** Next, if multiple agents are detected in the workspace, we list them here. If only one, we simply show that one as selected. Each agent entry might show its name and perhaps path. The user can select which agent’s configuration to work on (the form below would switch context accordingly). We can detect agents by scanning for ADK usage in code (e.g. find `google.adk.Agent(` or subclass of `LlmAgent`).
        
    *   **Agent Status & Actions:** For the currently selected agent, show a status line: e.g. “Status: Not Deployed” or “Status: Deployed (Engine ID 12345) – Running”. If deployed, perhaps a green dot indicator. Next to this, an action button “Deploy” (or “Update Deployment” if already deployed) and “Stop” (if running). These map to the deployment commands discussed.
        
    *   **Memory Bank Section:** A line indicating memory: e.g. “Memory Bank: Attached (using Engine 12345)” or “Memory Bank: None”. If attached, perhaps a link “Open in Console” to view Memory Bank entries in GCP console (since the Memory Bank UI is now available there[discuss.google.dev](https://discuss.google.dev/t/new-memory-bank-ui-is-now-available-in-vertex-ai-agent-engine/264765#:~:text=Engine%20discuss,LIVE%20in%20the%20Cloud%20Console)). If none, a button “Enable Memory” (which might just prompt deployment, since deploying always enables memory by default – so this is more relevant for local usage).
        
    *   **A2A Section:** Lines for A2A: “Agent Card: ✔ Present” or “✘ Missing”; “Skills: 3 defined” or “✘ No skills”. If issues, buttons “Generate Card” and/or “Generate Skills” as discussed. If all good, maybe a “View Card” button. This section educates the user that these are needed for multi-agent interoperability[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=The%20A2A%20protocol%20facilitates%20this,their%20capabilities%20and%20connection%20information).
        
    *   **Agent Config Form:** Beneath the status info, the detailed configuration form (the webview) will be displayed. This form contains multiple fields grouped in collapsible sections:
        
        *   _Basic Settings:_ Name, Description, Model (with a dropdown of available model identifiers like `gemini-2.0`, etc.), and possibly the hyperparameters if any (temperature, etc., though ADK largely handles model selection only).
            
        *   _Tools/Skills:_ A listing of the tools integrated. Possibly each tool can be toggled on/off or configured. (For instance, if the agent has optional tools, user can deselect one to disable it and the extension could reflect that by commenting it out in code or by configuring deployment to exclude it – however ADK doesn’t have a simple toggle API, so this might be read-only info unless we edit code).
            
        *   _Memory Settings:_ If memory is enabled, show which type (Vertex Memory vs none). Not much to configure here except maybe the retention or TTL, which currently might not be exposed via ADK (Memory Bank TTL settings exist in the service but not sure if ADK exposes it). We likely just inform the user memory is always on for deployed agents and uses user\_id scopes automatically.
            
        *   _Advanced (Deployment):_ Project, Region, Engine ID, Staging Bucket – these are deployment parameters. We could allow changing the target region or bucket here. Project is usually global in extension, but we might let advanced users override (e.g. deploy this agent to a different project than the one set globally).
            
        *   _Advanced (Environment):_ Perhaps allow setting env variables for the agent runtime or configuring requirements. By default, our deployment uses `requirements: ["google-cloud-aiplatform[agent_engines,adk]"]` to ensure the runtime has ADK installed[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=agent_engine%20%3D%20client.agent_engines.create%28%20agent_engine%3Dadk_app%2C%20config%3D,aiplatform%5Bagent_engines%2Cadk%5D%22%5D%20%7D). If the user’s agent requires additional pip packages, we could provide a field to list those (e.g. “Extra requirements: numpy==1.25”). We would then include them in the deployment config.
            
*   **Visual Design:** We will keep the design simple and consistent with VS Code’s theming:
    
    *   Use VS Code’s CSS variables in the webview to match light/dark themes (for text, background, etc.).
        
    *   Use icons sparingly (maybe a cloud icon near project, a key icon near account, etc., or use text labels for clarity).
        
    *   Group items logically with headings. Possibly use accordions or tabs in the webview if too much content.
        
    *   Ensure the panel is scrollable if needed (some forms might be long).
        
*   **Cloud Code Inspiration:** By modeling on Cloud Code’s extension, we benefit from known UX patterns. For example:
    
    *   Cloud Code’s activity bar view (Cloud Code has an Explorer with sections for Cloud Run, Kubernetes, etc.). Our extension is smaller in scope, so likely a single view is enough, but we can still organize sub-sections as described.
        
    *   Cloud Code uses notifications and the Output channel for logs (like streaming logs from a deployment)[marketplace.visualstudio.com](https://marketplace.visualstudio.com/items?itemName=GoogleCloudTools.cloudcode#:~:text=,that%20are%20meaningful%20to%20you). Similarly, our extension will have an Output channel for deployment logs and maybe agent logs (if we decide to capture any runtime output).
        
    *   Cloud Code also integrates with VS Code’s terminal (for Cloud Shell or kubectl). We might use the terminal to run gcloud commands for authentication or if the user wants to run an ADK CLI command manually. For instance, a “Open Cloud Shell Proxy” could be an idea if connecting to an A2A server on Cloud Run, but that’s beyond our main scope.
        
*   **Responsiveness:** The UI will be designed to avoid freezing VS Code’s UI thread. All heavy operations (deployment, API calls) will be offloaded to child processes (Python or gcloud CLI) or done asynchronously. The webview will communicate asynchronously with the extension host. This ensures the VS Code window remains responsive as the user navigates or edits other files.
    
*   **Accessibility:** We’ll label form fields clearly and consider keyboard navigation (the webview form should allow tabbing through inputs). If possible, we’ll test with screen readers to ensure text labels are meaningful.
    
*   **Internationalization:** Not explicitly required now, but we’ll keep strings in a central place for potential localization.
    

In essence, the extension’s UI will feel like a natural extension of VS Code, with a **sidebar panel for agent control** and a **status bar** indicator, very much like how Cloud Code integrates cloud controls into VS Code’s UI[cloud.google.com](https://cloud.google.com/code/docs/vscode/install#:~:text=If%20you%20aren%27t%20signed%20in,these%20steps%20to%20sign%20in)[cloud.google.com](https://cloud.google.com/code/docs/vscode/install#:~:text=1,click%20the%20active%20project%20name). This provides users with immediate feedback and control over their Google ADK agents without leaving the editor.

Security Considerations
-----------------------

*   **Credential Handling:** As mentioned, the extension is designed so that we **never handle raw credentials beyond what’s necessary**. By using ADC, the actual credentials (OAuth tokens or service account keys) are managed by Google’s SDKs and not exposed in our extension logic. If the user opts for a service account JSON:
    
    *   We will treat that file with care: only its file path is used to set `GOOGLE_APPLICATION_CREDENTIALS`. We do not open or parse the JSON unless needed to extract the account email for display. Even if we parse it (to show the service account email in the UI), we will immediately discard the sensitive `private_key` field after use. We will not log or transmit the file content.
        
    *   If multiple users use the same machine, the ADC file and any service account keys should be protected by OS permissions. We’ll remind users to store service account keys in secure locations (not in the workspace). The extension’s documentation will advise deleting or revoking keys if compromised.
        
    *   **Secret Storage:** For any secret that must be stored (for example, if in future we integrate another API token), we will use `context.secrets` which stores data in the OS secure keychain[medium.com](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=The%20storage%20location%20varies%20by,each%20system%E2%80%99s%20native%20secure%20storage). This ensures encryption at rest. The Medium article on VS Code storage emphasizes that secret storage is essential for things like API keys[medium.com](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=Secret%20Storage)[medium.com](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=Think%20of%20it%20like%20a,your%20system%E2%80%99s%20secure%20credential%20store), and we adhere to that practice.
        
*   **Extension Permissions:** We will ensure the extension’s package.json only requests needed VS Code capabilities. We do not need access to the user’s file system beyond workspace file reading (which is granted by default for workspace files). Accessing external resources (like making API calls) is done via Node/Python libraries, which operate under the user’s network privileges. We trust Google’s libraries to handle network security (HTTPS etc.).
    
*   **Running User Code:** A potential security risk is that generating Agent Cards or deploying might involve importing and executing the user’s agent code (especially if we auto-run `to_a2a` on their agent). Running arbitrary user code can be dangerous (the code could do anything). However, since this extension is for the agent developer themselves, running their code is presumably safe from their perspective (they wrote it). We will isolate this execution in a separate Python process to avoid any effect on the extension process. We could even run it in a subprocess with limited privileges if necessary. But typically, VS Code extensions allow running user code as part of build tasks etc., so this is acceptable as long as the user trusts their own code. We will not run any code that we download from elsewhere automatically.
    
*   **Network Calls and Data:** All network calls (to Google Cloud APIs) will go over HTTPS via the official SDK, so data in transit is secure. We won’t transmit any user code or data to non-Google endpoints. The only data sent out is what’s required for deployment (the agent’s code to Google’s servers) and API requests to manage the agent. This is analogous to using gcloud or Cloud Console manually.
    
*   **Resource Cleanup:** We help the user avoid unintended cloud resource usage (which has cost implications). For example, if they deploy an agent and then remove the workspace, that agent might still be running incurring cost. Our extension will include a **“Clean Up”** reminder. For instance, when the VS Code workspace closes or the extension is deactivated, we could prompt “You have 1 agent still deployed. Do you want to stop it?” (This might be optional or just documented). Also in our documentation, we’ll mention how to manually delete agents via console or our UI to avoid charges[google.github.io](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=Step%207%3A%20Clean%20up%C2%B6).
    
*   **Logging:** We will keep extension logs (Output Channel) free of sensitive info. If we print a command like the Python snippet, we will scrub any credentials or keys. If an error occurs that includes a stack trace, we review it for secrets before showing. Generally, Google APIs errors won’t include secrets, but the service account email might appear (which is fine).
    
*   **Dependencies:** We will use well-known libraries (Google Cloud SDK, ADK, A2A SDK). We need to ensure the extension either relies on the user to have these pip modules or we bundle minimal parts. Likely we assume the developer has `google-cloud-aiplatform` and `google-adk` installed in their Python environment. If not, we can prompt them to install (perhaps using pip). It’s safer to let the user manage their environment (reduces our bundling responsibility and respects virtualenvs).
    
*   **User Context & State:** Any context we store (engine IDs, project IDs) will be stored in VS Code’s local storage (globalState or workspaceState) which is not encrypted but is local to the machine[medium.com](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=When%20you%20use%20global%20state%2C,This%20means%20the%20data%20survives)[medium.com](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=Workspace%20State). We will not store anything highly sensitive there. Engine IDs and project IDs are not secrets, so that’s fine. If we store the path to a key file, that is somewhat sensitive (indirectly). We may consider storing that in secret storage out of caution, or simply not storing it at all and requiring re-selection each time (which might be fine because authentication isn’t needed super frequently after initial setup).
    
*   **Testing & Hardening:** We’ll test scenarios where:
    
    *   The user provides wrong credentials or no permissions – extension should catch API errors and show friendly error (e.g. “Deployment failed: permission denied. Please ensure your account has the Vertex AI Admin role on project X.”).
        
    *   Network is down – extension should handle exceptions (perhaps retry or instruct user to check connection).
        
    *   Large agent code or dependencies – ensure we don’t block or run into timeouts. The Python deployment could take minutes; we’ll make sure our progress indicator doesn’t vanish. We might increase any child process timeout if needed.
        
    *   Cancel deploy – if user closes VS Code during deployment or presses a cancel on progress (if we offer it), ensure the child process is killed to not leave stray processes.
        

By addressing these points, we maintain user trust. The extension essentially acts as a local tool orchestrating cloud actions, and we ensure it does so safely and transparently (no hidden data collection, etc.). Security is woven throughout, from using ADC for auth (so the user never directly gives us credentials)[google.github.io](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=2,following%20command%20in%20your%20terminal) to storing secrets properly and cleaning up resources responsibly.

Persistence of User Context (Projects, Agents, Engine IDs)
----------------------------------------------------------

*   **Why Persist:** Agent development is iterative; users will often work with the same agent and cloud project repeatedly. Persisting context means the extension can “remember” their last used settings and reduce repetitive input. We identify a few key pieces of context to store:
    
    1.  **Active Google Cloud Project** – so the user doesn’t have to select the project on every VS Code open. This is likely tied to the workspace (different projects for different codebases).
        
    2.  **Active Agent** – if multiple agents are present, which one was last focused. Or if only one, just recall that one.
        
    3.  **Last Deployed Engine ID** – so that we know if an agent is already deployed and can use update. This ID is per agent (and per project potentially).
        
    4.  **User’s chosen Region and Bucket** – these typically remain constant for a project.
        
    5.  **Auth Method** – e.g. if using a service account key, remember the path.
        
*   **Where to Store:** We have two storage scopes provided by VS Code:
    
    *   **Workspace State:** Data kept per workspace (project) on the user’s machine[medium.com](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=Workspace%20State). This is ideal for things like project ID, because if the user opens a different codebase in another window, that might be a different project. We will store `workspaceState.update('gcpProject', projectId)` and maybe `workspaceState.update('region', 'us-central1')`, etc. Also, the mapping of agent -> lastEngineId can be stored here (especially since agent code belongs to this workspace).
        
    *   **Global State:** Data available across all workspaces for this user[medium.com](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=Global%20State). Good for things like last account used or service account path, as those might be reused across projects. Also, if the extension needs to show something across workspaces (like a global setting).
        
    *   In our case, **project and agent specifics go to workspaceState**, and **account/auth info goes to globalState**. For example:
        
        *   On login, store `globalState.update('authMode','ADC')` and if service account, `globalState.update('saPath', '/home/user/key.json')` (though as discussed we might not store path in plaintext; we could encrypt it by storing in secrets and just store a flag that a secret is set).
            
        *   On project switch, `workspaceState.update('projectId','my-gcp-project')`.
            
        *   When user selects a region or bucket, store those in workspaceState (they are tied to project typically).
            
        *   On successful deployment, `workspaceState.update('engineId:<agentName>', engineId)` or maintain a dictionary in state for agent IDs. This way, next time we know “Agent X was deployed as Engine 123 previously”.
            
        *   Active agent selection: if user had agent “alpha” open, store `workspaceState.update('activeAgent','alpha')`. So when they reopen, the extension can auto-select that agent in the UI.
            
*   **Using VS Code Memento APIs:** Both globalState and workspaceState provide a Memento API (key-value store). We will use that as it’s straightforward and persistent on disk by VS Code (global in `state.vscdb` and workspace in the workspace storage DB)[medium.com](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=,Restarting%20your%20computer)[medium.com](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=The%20workspace%20state%20of%20each,within%20the%20designated%20workspace%20directory). This saves us from managing our own files.
    
*   **Restoring State on Activation:** When the extension activates (on VS Code startup or when a relevant file is opened), we read the stored states:
    
    *   If a projectId is stored, we set that as current (and update status bar).
        
    *   If none, maybe default to gcloud’s config default (we can query gcloud).
        
    *   If an engineId for an agent exists, we might not automatically mark it as “deployed” because the agent might have been stopped outside VS Code. However, we could call the Vertex AI API to check if that engine still exists. For simplicity, we might assume it exists until proven otherwise. We could list engines and verify the ID is in the list. This is a quick call we can do on startup (requires credentials ready).
        
    *   Set activeAgent if stored; otherwise, if we discover agents in workspace, pick the first by default.
        
*   **Example:** Suppose last session user deployed “OrderBot” agent to engine ID 456 in project “my-project”. They close VS Code and later reopen. On activation, extension does:
    
    *   Reads globalState: finds they were logged in with ADC as user X and had project “my-project” in this workspace.
        
    *   It automatically calls `vertexai` SDK or REST to check if engine 456 exists (we could call `client.agent_engines.get("projects/my-project/locations/us-central1/reasoningEngines/456")`). If it exists, great – we update UI: “OrderBot – Deployed (Engine 456)”. If not (maybe it was deleted via Console), we update our state to remove it (so it doesn’t attempt to update a non-existent engine).
        
    *   The extension UI now shows everything as it was, so the user can quickly either update or stop that deployment as needed.
        
*   **Persisted Settings vs Commands:** Some context could also be stored in VS Code Settings (settings.json). For example, project ID or default region could be an extension setting. However, since these are likely to change based on user context and we want to update them programmatically, the state API is more convenient than writing to settings.json. Settings are more for user preferences. We might include a few configurable settings like “Default Region” or “Path to gcloud CLI” in case it’s not in PATH. But those would be optional.
    
*   **Edge Cases:** If multiple workspaces are open in one VS Code window (multi-root workspace), workspaceState is shared across them (IIRC it’s per window). That could complicate if the user opened two different agent projects in one window. In such scenario, our extension would treat them as one context. This is rare and we might not explicitly handle it beyond documenting that one should open separate windows for separate projects to avoid confusion.
    
*   **Cleanup of State:** We will remove or update state keys as needed. For instance, if user signs out, we might clear any stored account info. If they change project, update the project key. If an agent is removed from the workspace (file deleted), we might remove its engineId entry. This requires listening to file events or when the user actively removes an agent from our UI.
    
*   **Secret Storage for Tokens:** While globalState can hold non-sensitive context, any actual token or credential would go to `context.secrets`. For example, if we ever obtain a short-lived access token (we usually don’t need to because SDK handles it), we wouldn’t store it at all, just keep in memory. But if we did, we’d use secrets.
    
*   **Example of using SecretStorage:** If we stored a service account JSON content (we prefer not to), we’d do `context.secrets.store('serviceAccountKey', actualJsonString)`. Later retrieve by `context.secrets.get('serviceAccountKey')` when needed[medium.com](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=Think%20of%20it%20like%20a,your%20system%E2%80%99s%20secure%20credential%20store). But as noted, better to store only minimal reference (like path) in state and let the environment variable handle actual usage.
    
*   With context persistence in place, the extension feels “stateful” in a helpful way – remembering user’s choices and cloud resources across sessions so they don’t have to reconfigure each time. This leads to a smoother workflow.
    

Commands and Communication Structure
------------------------------------

*   **Command Definitions:** We will define a set of VS Code commands (in `package.json` under the `contributes.commands` section) for all major actions. These can be executed via UI elements or the Command Palette. Tentative list:
    
    *   `agentConfigurator.openPanel`: Show the Agent Configurator view (if not already visible). Possibly not needed if view is always available via Activity Bar.
        
    *   **Authentication Commands:**
        
        *   `agentConfigurator.gcloudLogin`: Trigger ADC login via gcloud CLI (opens a terminal or runs the command).
            
        *   `agentConfigurator.selectServiceAccount`: Open file picker to choose a service account key and set it.
            
        *   `agentConfigurator.signOut`: Revoke/clear credentials.
            
        *   `agentConfigurator.switchProject`: Prompt and switch the active GCP project.
            
    *   **Agent Deployment Commands:**
        
        *   `agentConfigurator.deployAgent`: Deploy the currently selected agent (create or update Agent Engine). We may have sub-commands or options for “deploy new” vs “deploy update”, but this can be handled in code logic (if engineId exists, decide update vs new based on user prompt).
            
        *   `agentConfigurator.stopAgent`: Stop (delete) the deployed agent. If multiple agents, ensure it’s clear which one; in context, it’ll apply to selected agent.
            
        *   `agentConfigurator.viewLogs`: (Optional) Open Output Channel to show deployment logs or agent logs.
            
    *   **Memory Commands:**
        
        *   `agentConfigurator.attachMemory`: Let user pick an existing Engine ID to use for memory (and then call update deployment).
            
        *   `agentConfigurator.createMemoryInstance`: Possibly same as deploy new (since memory tied to engine).
            
        *   `agentConfigurator.openMemoryConsole`: Open the browser to Vertex AI Memory Bank UI (URL could be constructed from project and region).
            
    *   **A2A Commands:**
        
        *   `agentConfigurator.generateAgentCard`: Run the generation for Agent Card JSON.
            
        *   `agentConfigurator.openAgentCard`: Open the Agent Card file if exists in workspace.
            
        *   `agentConfigurator.checkCompatibility`: Run the compatibility check and output a summary (perhaps in Output or a modal).
            
        *   Possibly `agentConfigurator.startA2AServer`: If we integrate with running the agent locally as an A2A server (this might open a terminal running `uvicorn agent:a2a_app`).
            
    *   **Misc:**
        
        *   `agentConfigurator.refreshView`: In case we need to manually refresh the panel (the TreeDataProvider or Webview). TreeDataProviders usually have a `refresh()` we can call; for webview we can just re-post state.
            
*   **Registering Commands:** In extension activation (TypeScript), we use `context.subscriptions.push(vscode.commands.registerCommand('agentConfigurator.deployAgent', handlerFunction))` for each command. The handler functions implement the logic, often by calling into helper modules or initiating the Python backend.
    
*   **Communication with Webview:** As noted, the webview UI will not directly call Node functions; it will send messages. The extension will handle those messages in the `resolveWebviewView` (for a WebviewView) or the WebviewPanel’s message handler. For example:
    
    *   Webview form “Deploy” button -> calls `vscode.postMessage({ command: 'deploy' })`.
        
    *   Extension hears it and simply calls the same logic as `agentConfigurator.deployAgent` command (we can factor that logic so both UI triggers and Command Palette triggers use the same code path).
        
    *   Conversely, the extension can push data to webview. For instance, after deployment, we might want to notify the webview to update the status display within it. We can do `panel.webview.postMessage({ event: 'deploymentComplete', engineId: ... })`. The webview JS will listen (via `window.addEventListener('message', ...)`) and update the DOM accordingly (e.g. show “Deployed ✅”).
        
    *   We will define a clear message schema, e.g. `type MessageFromWebview = { command: string, data?: any }` and `type MessageToWebview = { event: string, data?: any }`. This avoids confusion.
        
*   **Extension <-> Python Communication:** When invoking Python for tasks:
    
    *   The simplest method is to spawn a child process via Node’s `spawn` or `exec`. For example: `spawn('python', ['deploy_agent.py', '--project', proj, ...])`. We will gather output from stdout and stderr. We may use line buffering or real-time streaming:
        
        *   For real-time feedback, as the Python prints logs (like uploading... done, deploying... done), we append those to the Output channel live[google.github.io](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=from%20vertexai%20import%20agent_engines). The user can watch it if they open the “Agent Configurator” output. We can also parse certain outputs; e.g., find the engine ID in the output using a regex and capture it.
            
    *   Alternatively, we can implement a more structured IPC. For instance, the Python script could output JSON messages or we could even open a local socket/pipe. But that’s overkill unless we needed a persistent Python service (which we likely do not; each operation can be a separate process).
        
    *   For Agent Card generation, similarly spawn a Python process. Possibly we write a temp script file that imports the agent and outputs the JSON to stdout. We have to be mindful of where the agent code is (in the workspace) – we may need to manipulate `PYTHONPATH` or run the process with `cwd` in the workspace folder so it can import the agent module.
        
    *   We will ensure to catch errors from the Python processes. If `spawn` exits with non-zero code, we capture stderr and show it to user.
        
    *   If needed, the extension might use Node.js libraries for some tasks (like listing projects via a Google Cloud Node SDK) to avoid too many Python calls. But given ADK is Python-centric, using Python for those parts is fine.
        
*   **User Commands vs Automatic:** Some commands (like deploy, stop, generate card) are user-initiated. Others might be internal (like check compatibility might run automatically on certain events). We will differentiate these in code. E.g., on agent selection change, we can automatically run a compatibility check in background and update the UI (instead of requiring a manual command).
    
*   **Command Availability:** We can use **VS Code Context Keys** to enable/disable commands or UI elements. For example, disable “Deploy” if not authenticated, or disable “Stop” if agent not running. In a TreeView, we can control via `when` clauses (for context values set on tree items). In a webview, we manually control the button states by logic.
    
*   **Integration with VS Code API Features:**
    
    *   _Notifications:_ For success/failure, we’ll use `vscode.window.showInformationMessage` or `.showErrorMessage`. E.g., “Agent deployed successfully to Engine 456[google.github.io](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=print%28f,projects%2F%7BPROJECT_NUMBER%7D%2Flocations%2F%7BLOCATION%7D%2FreasoningEngines%2F%7BRESOURCE_ID).” (and maybe offer a “Copy ID” or “Open in Console” button in that message).
        
    *   _Progress UI:_ Already discussed with `withProgress` for long tasks.
        
    *   _Tree View Refresh:_ If we implement any tree view listing (like listing all deployed agents in the project), we will refresh it after deployments or deletions. For instance, if we had a “Deployed Agents” tree and the user stops one, we’d remove it from the list and call `treeDataProvider.refresh()`.
        
    *   _Task integration:_ Unlikely, but we could register a Task type for “Deploy agent” that could be run as a build task. That might be more complexity than needed. We focus on direct commands instead.
        
*   **Extensibility:** We design the commands so they could be called from elsewhere too. For instance, if the user right-clicks a Python file that defines an agent, we could add a context menu “Deploy this ADK Agent” (via a CodeLens or context menu contribution). That would call our deploy command with that file’s agent. We might not implement that initially, but our command could accept an argument (like the file path or agent name) to allow this in future.
    
*   **Messaging Example:**
    
    *   The user fills out some config in the webview and clicks “Deploy”. The webview sends message {command: 'deploy', config: {...}}. The extension receives it, uses the data (like updated model or tool selection) to maybe tweak the deployment (e.g., if the user changed model in UI, we might pass that to the Python deployment script to override the code’s model). Then extension executes the deploy: shows progress, calls Python, awaits result. When done, extension updates its state and sends a message back to webview: {event: 'deployed', engineId: '456', status: 'success'}. The webview receives it, could display a green check or simply refresh the status text. We also show a toast notification “Deployed to Vertex AI (Engine 456)”.
        
    *   If the webview is not open (say user ran “Deploy” from Command Palette), we still perform the same underlying function. The UI panel will update next time it’s visible (because we stored state).
        
*   **Source Citations (for dev reference):**
    
    *   VS Code’s Status Bar and Activity Bar guidelines help ensure we implement UI correctly[code.visualstudio.com](https://code.visualstudio.com/api/ux-guidelines/activity-bar#:~:text=Activity%20Bar)[code.visualstudio.com](https://code.visualstudio.com/api/ux-guidelines/activity-bar#:~:text=,to%20open%20a%20Webview%20Panel).
        
    *   Cloud Code’s approach to auth and context inspires our design (e.g., using ADC and showing account/project)[cloud.google.com](https://cloud.google.com/code/docs/vscode/install#:~:text=Authenticate%20credentials%20for%20Google%20Cloud)[marketplace.visualstudio.com](https://marketplace.visualstudio.com/items?itemName=GoogleCloudTools.cloudcode#:~:text=,that%20are%20meaningful%20to%20you).
        
    *   The ADK/Agent Engine docs give us the exact calls and behaviors to integrate (create/update calls include Memory Bank implicitly, delete with force cleans up)[cloud.google.com](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=,aiplatform%5Bagent_engines%2Cadk%5D%22%5D)[google.github.io](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=Step%207%3A%20Clean%20up%C2%B6).
        
    *   A2A codelabs and docs inform how we generate Agent Cards and what fields to include[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=The%20A2A%20protocol%20facilitates%20this,their%20capabilities%20and%20connection%20information)[codelabs.developers.google.com](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=control%20over%20what%20you%20want,Python%20SDK%20under%20the%20hood).
        

By structuring our extension with clear commands and message passing, we ensure a modular architecture. The VS Code UI (Activity Bar panel, status bar, etc.) is loosely coupled with the back-end logic (Python processes handling cloud interactions). This separation makes it easier to maintain and test each part. For instance, we can unit-test the TypeScript command handlers by mocking the Python calls, and test the Python scripts independently by running them with sample inputs.

Finally, the user will interact with a cohesive tool: they can configure an agent, deploy it, monitor it, and integrate memory & multi-agent features all from within VS Code. The commands and UI elements we defined all contribute to this seamless workflow, while our emphasis on security and context persistence ensures it’s safe and convenient.

Citations

[

![](https://www.google.com/s2/favicons?domain=https://code.visualstudio.com&sz=32)

Activity Bar | Visual Studio Code Extension API

https://code.visualstudio.com/api/ux-guidelines/activity-bar

](https://code.visualstudio.com/api/ux-guidelines/activity-bar#:~:text=Activity%20Bar)[

![](https://www.google.com/s2/favicons?domain=https://code.visualstudio.com&sz=32)

Activity Bar | Visual Studio Code Extension API

https://code.visualstudio.com/api/ux-guidelines/activity-bar

](https://code.visualstudio.com/api/ux-guidelines/activity-bar#:~:text=,to%20open%20a%20Webview%20Panel)[

![](https://www.google.com/s2/favicons?domain=https://code.visualstudio.com&sz=32)

Activity Bar | Visual Studio Code Extension API

https://code.visualstudio.com/api/ux-guidelines/activity-bar

](https://code.visualstudio.com/api/ux-guidelines/activity-bar#:~:text=%E2%9C%94%EF%B8%8F%20Do)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Quickstart with Agent Development Kit  |  Generative AI on Vertex AI  |  Google Cloud

https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk

](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=adk_app%20%3D%20AdkApp)[

![](https://www.google.com/s2/favicons?domain=https://google.github.io&sz=32)

Agent Engine - Agent Development Kit

https://google.github.io/adk-docs/deploy/agent-engine/

](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=Once%20you%20are%20satisfied%20with,line%20tool)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Quickstart with Agent Development Kit  |  Generative AI on Vertex AI  |  Google Cloud

https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk

](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=,aiplatform%5Bagent_engines%2Cadk%5D%22%5D)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Quickstart with Agent Development Kit  |  Generative AI on Vertex AI  |  Google Cloud

https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk

](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=,name%2C%20agent_engine%3Dadk_app%2C%20config)[

![](https://www.google.com/s2/favicons?domain=https://google.github.io&sz=32)

Agent Engine - Agent Development Kit

https://google.github.io/adk-docs/deploy/agent-engine/

](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=print%28f,projects%2F%7BPROJECT_NUMBER%7D%2Flocations%2F%7BLOCATION%7D%2FreasoningEngines%2F%7BRESOURCE_ID)[

![](https://www.google.com/s2/favicons?domain=https://google.github.io&sz=32)

Agent Engine - Agent Development Kit

https://google.github.io/adk-docs/deploy/agent-engine/

](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=You%20can%20deploy%20from%20your,is%20discoverable)[

![](https://www.google.com/s2/favicons?domain=https://google.github.io&sz=32)

Agent Engine - Agent Development Kit

https://google.github.io/adk-docs/deploy/agent-engine/

](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=Step%207%3A%20Clean%20up%C2%B6)[

![](https://www.google.com/s2/favicons?domain=https://google.github.io&sz=32)

Agent Engine - Agent Development Kit

https://google.github.io/adk-docs/deploy/agent-engine/

](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=After%20you%20have%20finished%2C%20it,on%20your%20Google%20Cloud%20account)[

![](https://www.google.com/s2/favicons?domain=https://google.github.io&sz=32)

Agent Engine - Agent Development Kit

https://google.github.io/adk-docs/deploy/agent-engine/

](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=Monitoring%20and%20Verification)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Vertex AI Agent Engine Memory Bank overview  |  Generative AI on Vertex AI  |  Google Cloud

https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/overview

](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/overview#:~:text=Vertex%20AI%20Agent%20Engine%20Memory,session%20continuity)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Vertex AI Agent Engine Memory Bank overview  |  Generative AI on Vertex AI  |  Google Cloud

https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/overview

](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/overview#:~:text=%2A%20Similarity%20search,scope)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Quickstart with Agent Development Kit  |  Generative AI on Vertex AI  |  Google Cloud

https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk

](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=)[

![](https://www.google.com/s2/favicons?domain=https://discuss.google.dev&sz=32)

NEW: Memory Bank UI is now available in Vertex AI Agent Engine

https://discuss.google.dev/t/new-memory-bank-ui-is-now-available-in-vertex-ai-agent-engine/264765

](https://discuss.google.dev/t/new-memory-bank-ui-is-now-available-in-vertex-ai-agent-engine/264765#:~:text=Engine%20discuss,LIVE%20in%20the%20Cloud%20Console)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Quickstart with Agent Development Kit  |  Generative AI on Vertex AI  |  Google Cloud

https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk

](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=1,memories%20in%20the%20system%20instruction)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Quickstart with Agent Development Kit  |  Generative AI on Vertex AI  |  Google Cloud

https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk

](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=2.%20Create%20a%20,defining%20your%20own%20ADK%20runtime)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Quickstart with Agent Development Kit  |  Generative AI on Vertex AI  |  Google Cloud

https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk

](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=4.%20%20,tools%3D%5Badk.tools.preload_memory_tool.PreloadMemoryTool%28%29%5D)[

![](https://www.google.com/s2/favicons?domain=https://codelabs.developers.google.com&sz=32)

Getting Started with MCP, ADK and A2A  |  Google Codelabs

https://codelabs.developers.google.com/codelabs/currency-agent

](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=A2A%20allows%20agents%20to%3A)[

![](https://www.google.com/s2/favicons?domain=https://codelabs.developers.google.com&sz=32)

Getting Started with MCP, ADK and A2A  |  Google Codelabs

https://codelabs.developers.google.com/codelabs/currency-agent

](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=The%20A2A%20protocol%20facilitates%20this,their%20capabilities%20and%20connection%20information)[

![](https://www.google.com/s2/favicons?domain=https://codelabs.developers.google.com&sz=32)

Getting Started with MCP, ADK and A2A  |  Google Codelabs

https://codelabs.developers.google.com/codelabs/currency-agent

](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=control%20over%20what%20you%20want,Python%20SDK%20under%20the%20hood)[

![](https://www.google.com/s2/favicons?domain=https://codelabs.developers.google.com&sz=32)

Getting Started with MCP, ADK and A2A  |  Google Codelabs

https://codelabs.developers.google.com/codelabs/currency-agent

](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=,actions%20to%20achieve%20complex%20goals)[

![](https://www.google.com/s2/favicons?domain=https://codelabs.developers.google.com&sz=32)

Getting Started with MCP, ADK and A2A  |  Google Codelabs

https://codelabs.developers.google.com/codelabs/currency-agent

](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=An%20,get_exchange_rate)[

![](https://www.google.com/s2/favicons?domain=https://codelabs.developers.google.com&sz=32)

Getting Started with MCP, ADK and A2A  |  Google Codelabs

https://codelabs.developers.google.com/codelabs/currency-agent

](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=,capabilities%3DAgentCapabilities%28streaming%3DTrue%29%2C%20skills%3D%5Bskill)[

![](https://www.google.com/s2/favicons?domain=https://codelabs.developers.google.com&sz=32)

Getting Started with MCP, ADK and A2A  |  Google Codelabs

https://codelabs.developers.google.com/codelabs/currency-agent

](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=The%20A2A%20protocol%20facilitates%20this,their%20capabilities%20and%20connection%20information)[

![](https://www.google.com/s2/favicons?domain=https://google.github.io&sz=32)

Agent Engine - Agent Development Kit

https://google.github.io/adk-docs/deploy/agent-engine/

](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=2,following%20command%20in%20your%20terminal)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Install the Cloud Code for VS Code extension  |  Google Cloud

https://cloud.google.com/code/docs/vscode/install

](https://cloud.google.com/code/docs/vscode/install#:~:text=Authenticate%20credentials%20for%20Google%20Cloud)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Install the Cloud Code for VS Code extension  |  Google Cloud

https://cloud.google.com/code/docs/vscode/install

](https://cloud.google.com/code/docs/vscode/install#:~:text=Change%20the%20active%20Google%20Cloud,project)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Install the Cloud Code for VS Code extension  |  Google Cloud

https://cloud.google.com/code/docs/vscode/install

](https://cloud.google.com/code/docs/vscode/install#:~:text=If%20you%20aren%27t%20signed%20in,these%20steps%20to%20sign%20in)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Install the Cloud Code for VS Code extension  |  Google Cloud

https://cloud.google.com/code/docs/vscode/install

](https://cloud.google.com/code/docs/vscode/install#:~:text=1,click%20the%20active%20project%20name)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Install the Cloud Code for VS Code extension  |  Google Cloud

https://cloud.google.com/code/docs/vscode/install

](https://cloud.google.com/code/docs/vscode/install#:~:text=If%20you%20aren%27t%20signed%20in,these%20steps%20to%20sign%20in)[

![](https://www.google.com/s2/favicons?domain=https://google.github.io&sz=32)

Agent Engine - Agent Development Kit

https://google.github.io/adk-docs/deploy/agent-engine/

](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=2,following%20command%20in%20your%20terminal)[

![](https://www.google.com/s2/favicons?domain=https://medium.com&sz=32)

VS Code Extension Storage Explained: The What, Where, and How | by Krithika Nithyanandam | Medium

https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea

](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=Think%20of%20it%20like%20a,your%20system%E2%80%99s%20secure%20credential%20store)[

![](https://www.google.com/s2/favicons?domain=https://medium.com&sz=32)

VS Code Extension Storage Explained: The What, Where, and How | by Krithika Nithyanandam | Medium

https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea

](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=The%20storage%20location%20varies%20by,each%20system%E2%80%99s%20native%20secure%20storage)[

![](https://www.google.com/s2/favicons?domain=https://marketplace.visualstudio.com&sz=32)

Google Cloud Code - Visual Studio Marketplace

https://marketplace.visualstudio.com/items?itemName=GoogleCloudTools.cloudcode

](https://marketplace.visualstudio.com/items?itemName=GoogleCloudTools.cloudcode#:~:text=,that%20are%20meaningful%20to%20you)[

![](https://www.google.com/s2/favicons?domain=https://medium.com&sz=32)

VS Code Extension Storage Explained: The What, Where, and How | by Krithika Nithyanandam | Medium

https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea

](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=Global%20State)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Install the Cloud Code for VS Code extension  |  Google Cloud

https://cloud.google.com/code/docs/vscode/install

](https://cloud.google.com/code/docs/vscode/install#:~:text=4,Code)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

Quickstart with Agent Development Kit  |  Generative AI on Vertex AI  |  Google Cloud

https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk

](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=agent_engine%20%3D%20client.agent_engines.create%28%20agent_engine%3Dadk_app%2C%20config%3D,aiplatform%5Bagent_engines%2Cadk%5D%22%5D%20%7D)[

![](https://www.google.com/s2/favicons?domain=https://marketplace.visualstudio.com&sz=32)

Google Cloud Code - Visual Studio Marketplace

https://marketplace.visualstudio.com/items?itemName=GoogleCloudTools.cloudcode

](https://marketplace.visualstudio.com/items?itemName=GoogleCloudTools.cloudcode#:~:text=,that%20are%20meaningful%20to%20you)[

![](https://www.google.com/s2/favicons?domain=https://medium.com&sz=32)

VS Code Extension Storage Explained: The What, Where, and How | by Krithika Nithyanandam | Medium

https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea

](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=Secret%20Storage)[

![](https://www.google.com/s2/favicons?domain=https://medium.com&sz=32)

VS Code Extension Storage Explained: The What, Where, and How | by Krithika Nithyanandam | Medium

https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea

](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=When%20you%20use%20global%20state%2C,This%20means%20the%20data%20survives)[

![](https://www.google.com/s2/favicons?domain=https://medium.com&sz=32)

VS Code Extension Storage Explained: The What, Where, and How | by Krithika Nithyanandam | Medium

https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea

](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=Workspace%20State)[

![](https://www.google.com/s2/favicons?domain=https://medium.com&sz=32)

VS Code Extension Storage Explained: The What, Where, and How | by Krithika Nithyanandam | Medium

https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea

](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=,Restarting%20your%20computer)[

![](https://www.google.com/s2/favicons?domain=https://medium.com&sz=32)

VS Code Extension Storage Explained: The What, Where, and How | by Krithika Nithyanandam | Medium

https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea

](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=The%20workspace%20state%20of%20each,within%20the%20designated%20workspace%20directory)[

![](https://www.google.com/s2/favicons?domain=https://google.github.io&sz=32)

Agent Engine - Agent Development Kit

https://google.github.io/adk-docs/deploy/agent-engine/

](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=from%20vertexai%20import%20agent_engines)

All Sources

[

![](https://www.google.com/s2/favicons?domain=https://code.visualstudio.com&sz=32)

code.visualstudio

](https://code.visualstudio.com/api/ux-guidelines/activity-bar#:~:text=Activity%20Bar)[

![](https://www.google.com/s2/favicons?domain=https://cloud.google.com&sz=32)

cloud.google

](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk#:~:text=adk_app%20%3D%20AdkApp)[

![](https://www.google.com/s2/favicons?domain=https://google.github.io&sz=32)

google.github

](https://google.github.io/adk-docs/deploy/agent-engine/#:~:text=Once%20you%20are%20satisfied%20with,line%20tool)[

![](https://www.google.com/s2/favicons?domain=https://discuss.google.dev&sz=32)

discuss.google

](https://discuss.google.dev/t/new-memory-bank-ui-is-now-available-in-vertex-ai-agent-engine/264765#:~:text=Engine%20discuss,LIVE%20in%20the%20Cloud%20Console)[

![](https://www.google.com/s2/favicons?domain=https://codelabs.developers.google.com&sz=32)

codelabs...rs.google

](https://codelabs.developers.google.com/codelabs/currency-agent#:~:text=A2A%20allows%20agents%20to%3A)[

![](https://www.google.com/s2/favicons?domain=https://medium.com&sz=32)

medium

](https://medium.com/@krithikanithyanandam/vs-code-extension-storage-explained-the-what-where-and-how-3a0846a632ea#:~:text=Think%20of%20it%20like%20a,your%20system%E2%80%99s%20secure%20credential%20store)[

![](https://www.google.com/s2/favicons?domain=https://marketplace.visualstudio.com&sz=32)

marketpl...ualstudio

](https://marketplace.visualstudio.com/items?itemName=GoogleCloudTools.cloudcode#:~:text=,that%20are%20meaningful%20to%20you)