import json
import base64
import logging

from agent_with_dump.analysis import build_registry
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
    timestamp = datetime.now().strftime('%Y-%m-%d_%H-%M-%S-%f')[:-3]
    raw_output = {
        "agent": agent_name,
        "timestamp": timestamp,
        "session_id": session.id,
        
        #"state": session.state.to_dict() if hasattr(session.state, "to_dict") else dict(session.state),
        #"events": [
        #    {
        #        "id": event.id,
        #        "timestamp": str(event.timestamp),
        #        "author": event.author,
        #        "content": event.content,
        #        "invocation_id": event.invocation_id,
        #        "long_running_tool_ids": event.long_running_tool_ids,
        #        "actions": event.actions,
        #    }
        #    for event in session.events
        #],
    }
    output = safe_serialize(raw_output)

    raw_output_state = {
        "agent": agent_name,
        "timestamp": timestamp,
        "state": session.state.to_dict() if hasattr(session.state, "to_dict") else dict(session.state),
    }

    output_state = safe_serialize(raw_output_state)

    raw_output_events = {
        "agent": agent_name,
        "timestamp": timestamp,
         "events": [
            {
                "id": event.id,
                "timestamp": str(event.timestamp),
                "author": event.author,
                "content": event.content,
                "invocation_id": event.invocation_id,
                "long_running_tool_ids": event.long_running_tool_ids,
                "actions": event.actions,
            }
            for event in session.events
        ],
    }

    output_events = safe_serialize(raw_output_events)

    filename = os.path.join(log_dir, f"{agent_name}.json")
    #with open(filename, "a") as f:
    #    json.dump(output, f, indent=2)

    if os.path.exists(filename):
        with open(filename, "r+") as f:
            try:
                data = json.load(f)   # load existing list
            except json.JSONDecodeError:
                data = []  # file empty or corrupted
            data.append(output)
            f.seek(0)  # rewind
            json.dump(data, f, indent=2)
            f.truncate()  # remove leftover if new content is shorter
    else:
        with open(filename, "w") as f:
            json.dump([output], f, indent=2)

    filename_state = os.path.join(log_dir, f"state.json")
    #with open(filename_state, "a") as f:
    #    json.dump(output_state, f, indent=2)

    if os.path.exists(filename_state):
        with open(filename_state, "r+") as f:
            try:
                data = json.load(f)   # load existing list
            except json.JSONDecodeError:
                data = []  # file empty or corrupted
            data.append(output_state)
            f.seek(0)  # rewind
            json.dump(data, f, indent=2)
            f.truncate()  # remove leftover if new content is shorter
    else:
        with open(filename_state, "w") as f:
            json.dump([output_state], f, indent=2)

    filename_events = os.path.join(log_dir, f"events.json")
    #with open(filename_events, "a") as f:
    #    json.dump(output_events, f, indent=2)

    if os.path.exists(filename_events):
        with open(filename_events, "r+") as f:
            try:
                data = json.load(f)   # load existing list
            except json.JSONDecodeError:
                data = []  # file empty or corrupted
            data.append(output_events)
            f.seek(0)  # rewind
            json.dump(data, f, indent=2)
            f.truncate()  # remove leftover if new content is shorter
    else:
        with open(filename_events, "w") as f:
            json.dump([output_events], f, indent=2)

import importlib
from pathlib import Path  



def patch_agent(agent_obj, agent_name: str):
    """Attach a combined callback that includes the dumper for this agent."""
    original_cb = getattr(agent_obj, "after_agent_callback", None)

    async def combined_callback(callback_context: CallbackContext, _original_cb=original_cb):
        await dump_context_callback(callback_context, agent_name)
        if _original_cb is not None:
            await _original_cb(callback_context)

    agent_obj.after_agent_callback = combined_callback
    return agent_obj



def dynamic_import_agents(registry, patch_agent):
    project_root = Path(__file__).resolve().parent.parent
    imported_agents = {}
    i=0
    
    # Configure logging
    logging.basicConfig(filename='agent.log', level=logging.INFO,
                        format='%(asctime)s - %(levelname)s - %(message)s')
    for agent_id, agent in registry["agents"].items():
        if i == 0:
            logging.info(agent)
            file_path = Path(agent["file"])
            if not agent_id:
                continue

            # Convert file path -> module path relative to project root
            rel_path = file_path.relative_to(project_root)
            module_path = rel_path.with_suffix("")  # drop .py
            module_str = module_path.as_posix().replace('/', '.')

            logging.info(module_str)

            # Import module
            module = importlib.import_module(module_str)

            # Get the agent object
            obj = getattr(module, agent_id, None)
            if obj is None:
                logging.warning(f"⚠️ Could not find {agent_id} in {module_str}")
                continue

            # Patch the agent
            patched = patch_agent(obj, agent_id)
            imported_agents[agent_id] = patched
        i=i+1
 
    return imported_agents

# --- Patch both agents ---

#inspiration_agent = patch_agent(inspiration_agent, "inspiration_agent")
#booking_agent = patch_agent(booking_agent, "booking_agent")

# Expose only root_agent as `agent` for ADK entrypoint
import os
import sys
project_dir = os.environ.get('PROJECT_DIR')
timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
log_dir = os.path.join(project_dir, "logs", timestamp)
os.makedirs(log_dir, exist_ok=True)
sys.path.append(project_dir)
registry = build_registry(project_dir)['agents'].items()
print("AAAAAAA")
print(registry)

for item in registry:
    name = item[0]
    file = item[1]['file']
    kind = item[1]['kind']
    if (kind == 'agent') and (name =='root_agent'):
        file=os.path.relpath(file,project_dir)
        file_path = Path(file)
        file_path_no_suffix_no_slash=file_path.with_suffix("").as_posix().replace('/','.')
        module = importlib.import_module(file_path_no_suffix_no_slash)
        root_agent = getattr(module, name, None)
        root_agent = patch_agent(root_agent, name)
    else: # If not root_agent, then it's another agent, so we need to import it and patch it
        if (kind == 'agent'):
            file=os.path.relpath(file,project_dir)
            file_path = Path(file)
            file_path_no_suffix_no_slash=file_path.with_suffix("").as_posix().replace('/','.')
            module = importlib.import_module(file_path_no_suffix_no_slash)
            current_agent = getattr(module, name, None)
            current_agent = patch_agent(current_agent, name)


#print(registry["agents"]['root_agent']['file'])
#import_agents = dynamic_import_agents(registry, patch_agent)
#agent = import_agents['root_agent']

#from travel_concierge.agent import root_agent
#root_agent = patch_agent(root_agent, "root_agent")

os.chdir(project_dir)
agent = root_agent

