import google.generativeai as genai
import os

def query_gemini(prompt: str, filename: str) -> str:
    """
    Takes a string prompt and a filename, reads the file content, appends it to the prompt, and generates a response from
    the Gemini 2.5 Pro model using the combined prompt as input.
    
    Args:
        prompt (str): The input instructions or prompt for the model.
        filename (str): The path to the file to attach to the prompt.
    
    Returns:
        str: The generated response from the model.
    """
    api_key = os.getenv('GOOGLE_API_KEY')
    if not api_key:
        raise ValueError("GOOGLE_API_KEY environment variable is not set.")
    
    #print("Configuring Gemini API...")
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel('gemini-2.5-flash')
    #print("Reading file...")
    try:
        with open(filename, 'r') as f:
            file_content = f.read()
        #print("File read successfully.")
    except Exception as read_error:
        #print(f"Read failed: {str(read_error)}")
        raise
    #print("Generating content...")
    max_retries = 3
    for attempt in range(max_retries):
        try:
            full_prompt = prompt + "\n\nFile content:\n" + file_content
            response = model.generate_content(full_prompt)
            #print("Response received.")
            return response.text
        except Exception as gen_error:
            print(f"Generation attempt {attempt + 1} failed: {str(gen_error)}")
            if attempt == max_retries - 1:
                raise
            import time
            time.sleep(2 ** attempt)  # Exponential backoff
if __name__ == "__main__":
    import sys
    if len(sys.argv) != 3:
        print("Usage: python gemini_utils.py &lt;prompt&gt; &lt;filename&gt;", file=sys.stderr)
        sys.exit(1)
    prompt = sys.argv[1]
    filename = sys.argv[2]
    try:
        result = query_gemini(prompt, filename)
        print(result)
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)