#!/usr/bin/env python3
import argparse
import importlib
import json
import os
import sys
import traceback

def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

def parse_args():
    parser = argparse.ArgumentParser(description="Deploy or update a Vertex AI Agent Engine for an ADK agent.")
    parser.add_argument("--project", required=True, help="GCP project ID")
    parser.add_argument("--region", required=True, help="GCP region, e.g. us-central1")
    parser.add_argument("--staging-bucket", required=True, help="GCS bucket for staging (gs://bucket)")
    parser.add_argument("--module", required=True, help="Python module path, e.g. package.subpkg.agent")
    parser.add_argument("--symbol", required=True, help="Agent symbol in module. If callable, will be invoked.")
    parser.add_argument("--engine-id", required=False, help="Existing engine resource name or short ID (updates when provided)")
    parser.add_argument("--extra-req", action="append", default=[], help="Extra pip requirement (repeatable), e.g. numpy==1.26.4")
    return parser.parse_args()

def load_agent(module_name: str, symbol: str):
    mod = importlib.import_module(module_name)
    if not hasattr(mod, symbol):
        raise AttributeError(f"Symbol '{symbol}' not found in module '{module_name}'")
    obj = getattr(mod, symbol)
    if callable(obj):
        eprint(f"[deploy] Symbol '{symbol}' is callable; invoking to obtain agent instance...")
        return obj()
    return obj

def normalize_engine_name(project: str, region: str, engine_id: str) -> str:
    # Accept either full resource name or short ID
    if engine_id.startswith("projects/"):
        return engine_id
    return f"projects/{project}/locations/{region}/reasoningEngines/{engine_id}"

# Create a wrapper that implements OperationRegistrable protocol
class DeployableAgent:
    """Wrapper to make agents deployable with ReasoningEngine"""
    
    def __init__(self, agent):
        self.agent = agent
    
    def register_operations(self, **kwargs):
        """Required by OperationRegistrable protocol"""
        # Return an operations dict - empty or with supported operations
        # Despite type hints saying it should return None, the runtime code
        # expects a dict (see _generate_class_methods_spec_or_raise)
        return {"default": ["query"]}  # type: ignore
    
    def query(self, **kwargs):
        """Handle queries to the agent"""
        # Try different ways to invoke the agent
        prompt = kwargs.get('prompt', kwargs.get('query', kwargs.get('message', '')))
        
        # If agent is callable, call it
        if hasattr(self.agent, '__call__'):
            try:
                # Try to call with the prompt
                return self.agent(prompt)
            except TypeError:
                # Try with kwargs
                return self.agent(**kwargs)
        # If agent has a query method
        elif hasattr(self.agent, 'query'):
            return self.agent.query(prompt)
        # If agent has a run method
        elif hasattr(self.agent, 'run'):
            return self.agent.run(prompt)
        else:
            # Return a simple response
            return {"response": f"Query received: {prompt}"}

def main():
    args = parse_args()
    
    # Ensure current directory is in sys.path for module imports
    cwd = os.getcwd()
    if cwd not in sys.path:
        sys.path.insert(0, cwd)
        eprint(f"[deploy] Added {cwd} to Python path")
    
    # Also check PYTHONPATH environment variable
    pythonpath = os.environ.get('PYTHONPATH', '')
    eprint(f"[deploy] PYTHONPATH from environment: {pythonpath}")
    eprint(f"[deploy] sys.path: {sys.path[:3]}...")  # Show first 3 paths for debugging
    
    # Guarded import of google-cloud-aiplatform and adk
    try:
        from vertexai.preview.reasoning_engines import ReasoningEngine
        import vertexai
    except Exception as ex:
        eprint("ERROR: google-cloud-aiplatform with agent_engines/adk extras is not installed.")
        eprint("Please install with: pip install 'google-cloud-aiplatform[agent_engines,adk]'")
        sys.exit(2)

    try:
        eprint(f"[deploy] Initializing Vertex AI client for project={args.project} region={args.region} ...")
        vertexai.init(project=args.project, location=args.region, staging_bucket=args.staging_bucket)

        # Load agent from user module
        eprint(f"[deploy] Importing {args.module}:{args.symbol} ...")
        agent = load_agent(args.module, args.symbol)

        # Wrap agent to make it deployable
        eprint("[deploy] Preparing agent for deployment ...")
        deployable_agent = DeployableAgent(agent)
        
        # Build requirements list
        requirements = ["google-cloud-aiplatform[agent_engines,adk]"] + list(args.extra_req or [])

        if args.engine_id:
            name = normalize_engine_name(args.project, args.region, args.engine_id)
            eprint(f"[deploy] Updating existing engine: {name}")
            # For updates, we should retrieve existing engine and update it
            # Since update is not straightforward, create a new one
            eprint(f"[deploy] Note: Updates not supported, creating new engine instead")
            display_name = getattr(agent, "name", None) or getattr(agent, "title", None) or "ADK Agent"
            reasoning_engine = ReasoningEngine.create(
                deployable_agent,
                requirements=requirements,
                display_name=display_name
            )
        else:
            display_name = getattr(agent, "name", None) or getattr(agent, "title", None) or "ADK Agent"
            eprint(f"[deploy] Creating new engine with displayName='{display_name}'")
            # Use ReasoningEngine.create for new engines
            reasoning_engine = ReasoningEngine.create(
                deployable_agent,
                requirements=requirements,
                display_name=display_name
            )

        eprint("[deploy] Deployment completed.")
        result = reasoning_engine

        # Try to obtain engine name from result
        engine_name = getattr(result, "resource_name", None) or getattr(result, "name", None)
        
        if not engine_name:
            raise RuntimeError("Deployment succeeded but engine name was not returned.")

        # Single line success output
        print(f"ENGINE_ID: {engine_name}")
        return 0
    except Exception as ex:
        msg = str(ex) or ex.__class__.__name__
        eprint(f"ERROR: {msg}")
        # Optional verbose trail for Output panel debugging
        eprint(traceback.format_exc())
        return 1

if __name__ == "__main__":
    sys.exit(main())