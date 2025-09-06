import json
import base64
from agent.agent import root_agent, doc_agent, mix_agent
from google.adk.agents.callback_context import CallbackContext
from datetime import datetime

def safe_serialize(obj):
    """Recursively convert ADK objects to something JSON-safe."""
    if obj is None:
        return None
    if isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, bytes):
        # convert raw bytes to base64 for safe JSON storage
        return {"__bytes__": base64.b64encode(obj).decode("utf-8")}
    if hasattr(obj, "dict"):  # Pydantic models
        return safe_serialize(obj.dict())
    if hasattr(obj, "__dict__"):
        return {k: safe_serialize(v) for k, v in obj.__dict__.items()}
    if isinstance(obj, (list, tuple)):
        return [safe_serialize(x) for x in obj]
    if isinstance(obj, dict):
        return {k: safe_serialize(v) for k, v in obj.items()}
    return str(obj)


async def dump_context_callback(callback_context: CallbackContext, agent_name: str):
    """Dump session state/events of a given agent into its own file."""
    session = callback_context._invocation_context.session
    raw_output = {
        "agent": agent_name,
        "session_id": session.id,
        "state": session.state.to_dict() if hasattr(session.state, "to_dict") else dict(session.state),
        "events": [
            {
                "id": event.id,
                "timestamp": str(event.timestamp),
                "author": event.author,
                "content": event.content,
                "actions": event.actions,
            }
            for event in session.events
        ],
    }
    output = safe_serialize(raw_output)

    filename = f"{str(datetime.now())}_agent_session_dump_{agent_name}.json"
    with open(filename, "w") as f:
        json.dump(output, f, indent=2)


def patch_agent(agent_obj, agent_name: str):
    """Attach a combined callback that includes the dumper for this agent."""
    original_cb = getattr(agent_obj, "after_agent_callback", None)

    async def combined_callback(callback_context: CallbackContext, _original_cb=original_cb):
        await dump_context_callback(callback_context, agent_name)
        if _original_cb is not None:
            await _original_cb(callback_context)

    agent_obj.after_agent_callback = combined_callback
    return agent_obj

import importlib
from pathlib import Path

def dynamic_import_agents(registry, patch_agent):
    imported_agents = {}

    for agent_id, agent in registry["agents"].items():
        file_path = Path(agent["file"])
        if not agent_id:
            continue

        # Convert file path -> module path
        module_path = file_path.with_suffix("")  # drop .py
        module_str = ".".join(module_path.parts)

        # Import module
        module = importlib.import_module(module_str)

        # Get the agent object
        obj = getattr(module, agent_id, None)
        if obj is None:
            print(f"⚠️ Could not find {agent_id} in {module_str}")
            continue

        # Patch the agent
        patched = patch_agent(obj, agent_id)
        imported_agents[agent_id] = patched

    return imported_agents

# --- Patch both agents ---
root_agent = patch_agent(root_agent, "root_agent")
doc_agent = patch_agent(doc_agent, "doc_agent")
mix_agent = patch_agent(mix_agent, "mix_agent")

# Expose only root_agent as `agent` for ADK entrypoint
agent = root_agent
