import libcst as cst
from libcst.metadata import MetadataWrapper, PositionProvider
from pathlib import Path
import json
import sys


class AgentExtractor(cst.CSTVisitor):
    METADATA_DEPENDENCIES = (PositionProvider,)

    def __init__(self, filename: str):
        self.filename = filename
        self.agents = []
        self.tools = []

    def visit_Assign(self, node: cst.Assign) -> None:
        # Capture variable name = Agent(...) or Tool(...)
        if isinstance(node.value, cst.Call) and isinstance(node.value.func, cst.Name):
            func_name = node.value.func.value
            if func_name in ("Agent", "Tool"):
                varname = None
                if len(node.targets) == 1 and isinstance(node.targets[0].target, cst.Name):
                    varname = node.targets[0].target.value

                pos = self.get_metadata(PositionProvider, node)
                data = {
                    "kind": func_name.lower(),
                    "id": varname,
                    "file": self.filename,
                    "line_start": pos.start.line,
                    "line_end": pos.end.line,
                    "args": {},
                }

                for arg in node.value.args:
                    if not arg.keyword:
                        continue
                    key = arg.keyword.value
                    value = self._extract_value(arg.value)
                    data["args"][key] = value

                if func_name == "Agent":
                    self.agents.append(data)
                else:
                    self.tools.append(data)

    def _extract_value(self, node):
        if isinstance(node, cst.SimpleString):
            return node.evaluated_value
        if isinstance(node, cst.Name):
            return {"kind": "ref", "ref": node.value}
        if isinstance(node, cst.Attribute):
            return {"kind": "ref", "ref": f"{node.value}.{node.attr.value}"}
        if isinstance(node, cst.List):
            return [self._extract_value(elt.value) for elt in node.elements]
        if isinstance(node, cst.Call) and isinstance(node.func, cst.Name):
            if node.func.value == "AgentTool":
                for arg in node.args:
                    if arg.keyword and arg.keyword.value == "agent":
                        inner = self._extract_value(arg.value)
                        return {"kind": "agent-tool", "ref": inner.get("ref")}
            return {"kind": "call", "name": node.func.value}
        return {"kind": "complex"}


def extract_from_file(path: Path):
    try:
        # Try UTF-8 first, then fallback to other encodings
        try:
            src = path.read_text(encoding='utf-8')
        except UnicodeDecodeError:
            try:
                src = path.read_text(encoding='latin-1')
            except UnicodeDecodeError:
                # Skip files we can't decode
                print(f"Warning: Skipping {path} due to encoding issues", file=sys.stderr)
                return [], []
        
        wrapper = MetadataWrapper(cst.parse_module(src))
        visitor = AgentExtractor(str(path))
        wrapper.visit(visitor)
        return visitor.agents, visitor.tools
    except Exception as e:
        print(f"Warning: Error processing {path}: {e}", file=sys.stderr)
        return [], []


def build_registry(base_path="."):
    agents, tools = [], []
    for pyfile in Path(base_path).rglob("*.py"):
        # Skip virtual environment directories
        if '.venv' in str(pyfile) or 'venv' in str(pyfile):
            continue
        # Skip hidden files and macOS metadata files
        if pyfile.name.startswith('.'):
            continue
        a, t = extract_from_file(pyfile)
        agents.extend(a)
        tools.extend(t)

    # Registry indexed by id for resolution
    registry = {
        "agents": {a["id"]: a for a in agents if a["id"]},
        "tools": {t["id"]: t for t in tools if t["id"]},
    }

    # Mark refs as resolved/unresolved
    def resolve(obj):
        if isinstance(obj, dict) and "ref" in obj:
            ref = obj["ref"]
            if ref in registry["agents"]:
                obj["kind"] = "agent"
                obj["resolved"] = True
            elif ref in registry["tools"]:
                obj["kind"] = "tool"
                obj["resolved"] = True
            else:
                obj["resolved"] = False
        elif isinstance(obj, list):
            for v in obj:
                resolve(v)
        elif isinstance(obj, dict):
            for v in obj.values():
                resolve(v)

    for agent in agents:
        resolve(agent["args"])
    for tool in tools:
        resolve(tool["args"])

    return registry


# NEW: reconstruct nested tree from flat registry
def build_nested_tree(registry, root_id):
    seen = set()

    def expand(item_id):
        if item_id in seen:  # prevent infinite recursion
            return {"ref": item_id, "cycle": True}
        seen.add(item_id)

        if item_id in registry["agents"]:
            base = dict(registry["agents"][item_id])
        elif item_id in registry["tools"]:
            base = dict(registry["tools"][item_id])
        else:
            return {"ref": item_id, "resolved": False}

        args = {}
        for k, v in base["args"].items():
            args[k] = _expand_value(v)

        return {
            "id": base.get("id"),
            "kind": base.get("kind"),
            "file": base.get("file"),
            "line_start": base.get("line_start"),
            "line_end": base.get("line_end"),
            "args": args,
        }

    def _expand_value(v):
        if isinstance(v, dict) and v.get("resolved"):
            if v["kind"] in ("agent", "tool"):
                return expand(v["ref"])
            return v
        if isinstance(v, list):
            return [_expand_value(x) for x in v]
        return v

    return expand(root_id)


if __name__ == "__main__":
    registry = build_registry(".")
    print("Flat registry:")
    print(json.dumps(registry, indent=2))

    if "root_agent" in registry["agents"]:
        nested = build_nested_tree(registry, "root_agent")
        print("\nNested tree for root_agent:")
        print(json.dumps(nested, indent=2))
