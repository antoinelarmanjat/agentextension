# process_log.py
import sys
import argparse
from datetime import datetime

# Set up argument parsing
parser = argparse.ArgumentParser(description="Process log lines.")
parser.add_argument('--source', required=True, choices=['stdout', 'stderr'],
                    help='The source stream of the log lines.')
args = parser.parse_args()

# Your script now knows the origin of its input
source_stream = args.source

for line in sys.stdin:
    original_line = line.strip()
    
    # --- YOUR CUSTOM LOGIC GOES HERE ---
    
    # Add timestamp
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3]
    
    # Now you can differentiate
    if source_stream == 'stderr':
        processed_line = f"[{timestamp}][E] {original_line}"
    else: # from stdout
        if "DEBUG" in original_line:
             processed_line = f"[{timestamp}][P] {original_line}"
        else:
             processed_line = f"[{timestamp}] {original_line}"
    
    # --- END OF CUSTOM LOGIC ---

    print(processed_line, flush=True)

    
