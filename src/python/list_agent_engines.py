#!/usr/bin/env python3
import argparse
import json
import sys
import traceback

def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

def parse_args():
    p = argparse.ArgumentParser(description="List Vertex AI Agent Engines in a project/region.")
    p.add_argument("--project", required=True, help="GCP project ID")
    p.add_argument("--region", required=True, help="GCP region, e.g. us-central1")
    return p.parse_args()

def main():
    args = parse_args()
    try:
        import vertexai
        from vertexai.preview.reasoning_engines import ReasoningEngine
    except Exception:
        eprint("ERROR: google-cloud-aiplatform with agent_engines extras not installed. Install: pip install 'google-cloud-aiplatform[agent_engines,adk]'")
        return 2

    try:
        vertexai.init(project=args.project, location=args.region)
        # Use ReasoningEngine.list() to get all engines
        engines = ReasoningEngine.list()
        out = []
        for eng in engines:
            # Extract resource_name and display_name
            name = getattr(eng, "resource_name", None) or getattr(eng, "name", None)
            display_name = getattr(eng, "display_name", None) or getattr(eng, "displayName", None)
            if isinstance(eng, dict):
                name = name or eng.get("resource_name") or eng.get("name")
                display_name = display_name or eng.get("displayName") or eng.get("display_name")
            if name:
                out.append({
                    "name": name,
                    "displayName": display_name or name
                })
        print(json.dumps(out, separators=(",", ":")))
        return 0
    except Exception as ex:
        eprint(f"ERROR: {str(ex) or ex.__class__.__name__}")
        eprint(traceback.format_exc())
        return 1

if __name__ == "__main__":
    sys.exit(main())