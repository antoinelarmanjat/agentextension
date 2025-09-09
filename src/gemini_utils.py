import google.generativeai as genai
import os

def query_gemini(prompt: str, filename: str) -> str:
    """
    Takes a string prompt and a filename, uploads the file, and generates a response from
    Gemini 1.5 Pro model using both the prompt and the file content as input parts.
    
    Args:
        prompt (str): The input instructions or prompt for the model.
        filename (str): The path to the file to attach to the prompt.
    
    Returns:
        str: The generated response from the model.
    """
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        raise ValueError("GEMINI_API_KEY environment variable is not set.")
    
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-2.5-flash')
    uploaded_file = genai.upload_file(path=filename)
    response = model.generate_content([prompt, uploaded_file])
    return response.text