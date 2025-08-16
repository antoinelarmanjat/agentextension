
import json
import re
import os

def find_root_agents(directory):
    """
    Scans a directory for agent.py files and finds all variables that have a Google ADK definition called root_agent.

    Args:
        directory: The directory to scan.

    Returns:
        A JSON string with the results.
    """
    results = []
    for root, _, files in os.walk(directory):
        for file in files:
            if file == "agent.py":
                file_path = os.path.join(root, file)
                with open(file_path, "r") as f:
                    content = f.read()
                    matches = re.findall(r"(\w+)\s*=\s*(?:Agent|SequentialAgent|LlmAgent|ParallelAgent|LoopAgent|BaseAgent)\(", content)
                    for match in matches:
                        if match == "root_agent":
                            results.append({"file": file_path, "variable": match})
    return json.dumps(results, indent=4)

if __name__ == "__main__":
    directory = "/Users/larmanjat/agentextension"
    print(find_root_agents(directory))
