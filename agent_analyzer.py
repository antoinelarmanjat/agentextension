import os
import json
import vertexai
from vertexai.generative_models import GenerativeModel, Part

def analyze_repo(project_path):
    """
    Analyzes a Python repository to understand its agent structure and returns a JSON representation.

    :param project_path: The path to the project repository.
    :return: A JSON object representing the agent structure.
    """
    
    # Initialize Vertex AI
    vertexai.init(location="us-central1")
    
    # Load the Gemini Pro model
    model = GenerativeModel(model_name="gemini-2.5-flash")

    # Prepare the prompt
    prompt = """
    Using Google ADK, I created python agents. I need you to analyze the whole repository and to create a json file for the agent structure, together with their relative structure. 
    The base of the agent needs to be root_agent and all agents are sub agents or sub agent tools or tools.  

    For each agent, I want to see in the JSON file various features of each agent. For example, each agent has instructions, models, description, a name, a type, call_back, etc.. and of course, it is recursive with sub agents, tools, etc.. 

    For agents, tools, instructions, sometimes they are imported through different files, please take this into account and put everything together. 

    For every agent, agent_tool, tool I want to know the file name and the line number of their definition (where the agent is actually defined). Please also put this in the JSON structure. Comments/docstring in the file should be considered as regular lines in the line numbering, so if you have three lines of comments/doctstrings for example before the actual code, the first line of code should be 4.

    please  strictly follow this JSON structure (example only): 

    {"root_agent":{ 
              "name":"root_agent", 
              "type":"agent", 
              "file_path":"travel_concierge/agent.py", 
              "line_number": 23, 
              "description":"A Travel Conceirge using the services o", 
              "instructions":"Defines the prompts ....", 
              "sub_agents": [ 
                      "inspiration_agent": { 
                       "name": "inspiration_agent", 
                        "file_path":"travel_concierge/inspiration_agent.py", 
                          "line_number": 23, 
                          "type": "BaseAgent", 
                          "file_path": "travel_concierge/sub_agents/inspiration/agent.py", 
                          "line_number": 32, 
                          "characteristics": { 
                            "model": "gemini-1.5-flash", 
                            "description": "A travel insp", 
                             "tools": [ 
                                   "name":"map_tool", 
                                "file_path": "travel_concierge/sub_agents/tools/map.py", 
                                     "line_number": 32, 
                                   ] 
                        }, 
                     "booking_agent": { 
                       "name": "booking_agent", 
                        "file_path":"travel_conciergebooking_agent.py", 
                          "line_number": 23, 
                          "type": "LLMAgent", 
                          "file_path": "travel_concierge/sub_agents/booking/agent.py", 
                          "line_number": 2, 
                          "characteristics": { 
                            "model": "gemini-1.5-flash", 
                            "description": "A travel insp", 
                             "tools": [ 
                                   "name":"poi_tool", 
                                "file_path": "travel_concierge/sub_agents/tools/poi.py", 
                                     "line_number": 32, 
                                   ] 
                        } 
              ], 
              "tools":[ 
        "name":"poi_tool", 
                "file_path": "travel_concierge/sub_agents/tools/poi.py", 
                         "line_number": 32 
             ] 
     } 
     }
    """

    # Add all Python files to the prompt
    for root, _, files in os.walk(project_path):
        for file in files:
            if file.endswith(".py"):
                file_path = os.path.join(root, file)
                with open(file_path, "r") as f:
                    file_content = f.read()
                prompt += f"\n\n--- File: {file_path} ---\n\n{file_content}"

    # Generate the response
    print("Analyzing the repository... This may take a few minutes.")
    response = model.generate_content(prompt)
    
    # Extract the JSON from the response
    json_response = response.text.strip()
    if json_response.startswith("```json"):
        json_response = json_response[7:-4]
    
    return json.loads(json_response)

if __name__ == "__main__":
    project_path = "travel_concierge"
    agent_structure = analyze_repo(project_path)
    with open("agent_structure.json", "w") as f:
        json.dump(agent_structure, f, indent=2)
    print("Agent structure saved to agent_structure.json")