#!/usr/bin/env python3
import argparse
import sys
import traceback

def eprint(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)

def parse_args():
    p = argparse.ArgumentParser(description="Delete a Vertex AI Agent Engine instance.")
    p.add_argument("--project", required=True, help="GCP project ID")
    p.add_argument("--region", required=True, help="GCP region, e.g. us-central1")
    p.add_argument("--engine-id", required=True, help="Engine full resource name or short ID")
    p.add_argument("--force", default="true", help="Force delete (default: true)")
    return p.parse_args()

def normalize_engine_name(project: str, region: str, engine_id: str) -> str:
    if engine_id.startswith("projects/"):
        return engine_id
    return f"projects/{project}/locations/{region}/reasoningEngines/{engine_id}"

def main():
    args = parse_args()
    try:
        import vertexai
        from vertexai.preview.agent_engines import AgentEnginesClient
    except Exception:
        eprint("ERROR: google-cloud-aiplatform with agent_engines extras not installed. Install: pip install 'google-cloud-aiplatform[agent_engines,adk]'")
        return 2

    try:
        vertexai.init(project=args.project, location=args.region)
        client = AgentEnginesClient()
        name = normalize_engine_name(args.project, args.region, args.engine_id)
        eprint(f"[delete] Deleting engine {name} (force={args.force}) ...")
        op = client.delete(name=name, force=str(args.force).lower() == "true")
        op.result()
        print(f"DELETED: {name}")
        return 0
    except Exception as ex:
        eprint(f"ERROR: {str(ex) or ex.__class__.__name__}")
        eprint(traceback.format_exc())
        return 1

if __name__ == "__main__":
    sys.exit(main())