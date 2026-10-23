"""Generate the public wire types and validation constraints from OpenAPI."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from pprint import pformat
from typing import Any

ROOT = Path(__file__).resolve().parents[2]


def generate(document: dict[str, Any]) -> str:
    schemas = document["components"]["schemas"]
    referenced: set[str] = set()

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            ref = value.get("$ref", "")
            if ref.startswith("#/components/schemas/"):
                name = ref.rsplit("/", 1)[1]
                if name not in referenced:
                    referenced.add(name)
                    visit(schemas[name])
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    operations = [
        operation
        for path in document["paths"].values()
        for operation in path.values()
        if isinstance(operation, dict)
        and operation.get("x-arex-visibility") == "public"
    ]
    for operation in operations:
        visit(operation)

    public_error_codes = {
        code
        for operation in operations
        for response in operation.get("responses", {}).values()
        for code in response.get("x-arex-error-codes", [])
    }
    error_code = schemas["Error"]["properties"]["error"]["properties"]["code"]
    error_code["enum"] = [
        code for code in error_code["enum"] if code in public_error_codes
    ]
    aliases = {
        ("Error", "error", "code"): "ErrorCode",
        ("ResearchRun", "error", "code"): "ResearchFailureCode",
        ("ContentsRequest", "tier"): "ContentsTier",
        ("ResearchRun", "mode"): "ResearchMode",
        ("ResearchCreateRequest", "mode"): "ResearchModeRequest",
        ("ResearchRun", "requested_mode"): "ResearchModeRequest",
        ("ResearchRun", "status"): "ResearchStatus",
    }
    lines = [
        "# Generated from openapi/arex-v1.json by generate_wire.py; do not edit.",
        "from __future__ import annotations",
        "",
        "from typing import TYPE_CHECKING, Any, Literal, TypedDict",
        "",
        "if TYPE_CHECKING:",
        "    from typing_extensions import Required",
        "",
    ]
    emitted_aliases: set[str] = set()
    for path, alias in aliases.items():
        if alias in emitted_aliases:
            continue
        node = schemas[path[0]]
        for key in path[1:]:
            node = node["properties"][key]
        lines.append(f"{alias} = Literal[{', '.join(repr(v) for v in node['enum'])}]")
        emitted_aliases.add(alias)
    lines.append("")
    definitions: list[str] = []

    def annotation(node: dict[str, Any], path: tuple[str, ...]) -> str:
        if "$ref" in node:
            return node["$ref"].rsplit("/", 1)[1]
        if path in aliases:
            return aliases[path]
        if "enum" in node:
            return f"Literal[{', '.join(repr(v) for v in node['enum'])}]"
        kind = node.get("type")
        if kind == "object":
            name = path[0] + "".join(part.title().replace("_", "") for part in path[1:])
            fields = []
            for key, child in node["properties"].items():
                field_type = annotation(child, (*path, key))
                if key in node.get("required", []):
                    field_type = f"Required[{field_type}]"
                fields.append(f"    {key}: {field_type}")
            definitions.append(
                f"class {name}(TypedDict, total=False):\n" + "\n".join(fields)
            )
            return name
        if kind == "array":
            return f"list[{annotation(node['items'], (*path, 'item'))}]"
        return {
            "string": "str",
            "integer": "int",
            "number": "float",
            "boolean": "bool",
            "null": "None",
        }[kind]

    constraints = {
        "minLength",
        "maxLength",
        "minimum",
        "maximum",
        "enum",
        "maxItems",
        "default",
        "pattern",
    }
    limits: dict[str, Any] = {}
    for name in sorted(referenced):
        annotation(schemas[name], (name,))
        limits[name] = {
            key: {
                constraint: value
                for constraint, value in node.items()
                if constraint in constraints
            }
            for key, node in schemas[name]["properties"].items()
            if any(constraint in node for constraint in constraints)
        }
        if not limits[name]:
            del limits[name]
    lines.extend("\n\n".join(definitions).splitlines())
    lines.extend(
        [
            "",
            "",
            "WIRE_LIMITS: dict[str, Any] = "
            + pformat(limits, width=88, sort_dicts=True),
            "",
        ]
    )
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    spec = json.loads((ROOT / "openapi/arex-v1.json").read_text())
    target = ROOT / "python/src/arex/_wire.py"
    generated = generate(spec)
    if argv == ["--check"]:
        if target.read_text() != generated:
            print("python/src/arex/_wire.py is stale; run scripts/generate_wire.py")
            return 1
        return 0
    target.write_text(generated)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
