from google.adk.agents import Agent
from google.adk.models import Message

class LoggingAgent(Agent):
    def invoke(self, message: Message) -> Message:
        self.log_event(
            "agent.invoke.start",
            {"message": message.content},
        )
        response = super().invoke(message)
        self.log_event(
            "agent.invoke.end",
            {"response": response.content},
        )
        return response