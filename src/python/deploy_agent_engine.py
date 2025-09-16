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

def main():
    args = parse_args()
    # Guarded import of google-cloud-aiplatform and adk
    try:
        from vertexai.preview.agent_engines import AdkApp
        import vertexai
    except Exception as ex:
        eprint("ERROR: google-cloud-aiplatform with agent_engines/adk extras is not installed.")
        eprint("Please install with: pip install 'google-cloud-aiplatform[agent_engines,adk]'")
        sys.exit(2)

    try:
        eprint(f"[deploy] Initializing Vertex AI client for project={args.project} region={args.region} ...")
        vertexai.init(project=args.project, location=args.region)

        # Load agent from user module
        eprint(f"[deploy] Importing {args.module}:{args.symbol} ...")
        agent = load_agent(args.module, args.symbol)

        # Wrap into AdkApp
        eprint("[deploy] Wrapping agent with AdkApp ...")
        adk_app = AdkApp(agent)

        # Build config
        config = {
            "staging_bucket": args.staging_bucket,
            "requirements": ["google-cloud-aiplatform[agent_engines,adk]"] + list(args.extra_req or []),
        }

        from vertexai.preview.agent_engines import AgentEnginesClient
        client = AgentEnginesClient()

        if args.engine_id:
            name = normalize_engine_name(args.project, args.region, args.engine_id)
            eprint(f"[deploy] Updating existing engine: {name}")
            op = client.update(name=name, agent_engine=adk_app, config=config)
        else:
            display_name = getattr(agent, "name", None) or getattr(agent, "title", None) or "ADK Agent"
            eprint(f"[deploy] Creating new engine with displayName='{display_name}'")
            op = client.create(agent_engine=adk_app, config=config, display_name=display_name)

        eprint("[deploy] Waiting for operation to complete ...")
        result = op.result()  # wait

        # Try to obtain engine name from result
        engine_name = getattr(result, "name", None)
        if not engine_name:
            # fallback if result is dict-like
            try:
                engine_name = result.get("name")  # type: ignore
            except Exception:
                pass

        if not engine_name:
            # Try to fetch from op metadata
            try:
                md = op.metadata
                if isinstance(md, dict):
                    engine_name = md.get("name") or md.get("resourceName")
            except Exception:
                pass

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