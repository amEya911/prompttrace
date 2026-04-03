import os
import json
from typing import Dict

class StorageEngine:
    def __init__(self):
        self.dir_path = self._resolve_project_root()
        # Changed to JSONL for append-only concurrent safety
        self.file_path = os.path.join(self.dir_path, 'traces.jsonl')
        self.memory_hash_map: Dict[str, int] = {}
        self._initialize()

    def _resolve_project_root(self) -> str:
        current_dir = os.getcwd()
        # Common project indicators enforcing a boundary state mirroring the TS 'package.json' fallback
        indicators = ['pyproject.toml', 'requirements.txt', 'setup.py', '.git', 'package.json']
        
        while True:
            for ind in indicators:
                if os.path.exists(os.path.join(current_dir, ind)):
                    return os.path.join(current_dir, '.prompttrace')
            
            parent = os.path.dirname(current_dir)
            if parent == current_dir:
                # Ultimate fallback gracefully isolating to root execution
                return os.path.join(os.getcwd(), '.prompttrace')
            
            current_dir = parent

    def _initialize(self):
        try:
            if not os.path.exists(self.dir_path):
                os.makedirs(self.dir_path, exist_ok=True)
            if not os.path.exists(self.file_path):
                with open(self.file_path, 'w') as f:
                    f.write('')
            else:
                # O(1) scale: no longer parsing the full file to populate memory cache.
                pass
        except Exception as e:
            print(f"[Prompttrace] Failed to initialize storage: {e}")

    def save_trace(self, trace_dict: dict):
        try:
            # Append-only operation ensuring cross-language thread safety
            line = json.dumps(trace_dict) + '\n'
            with open(self.file_path, 'a') as f:
                f.write(line)
                f.flush()
        except Exception as e:
            print(f"[Prompttrace] Failed to save trace: {e}")

    def register_and_get_hit_count(self, prompt_hash: str) -> int:
        hits = self.memory_hash_map.get(prompt_hash, 0)
        self.memory_hash_map[prompt_hash] = hits + 1
        return hits
