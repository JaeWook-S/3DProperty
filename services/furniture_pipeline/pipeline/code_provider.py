"""Blender source boundary, with a local stub until an API adapter is configured.

Set PIPELINE_CODE_PROVIDER to ``package.module:function`` to use a future GPT
adapter. The callable receives the complete handoff dict (including the prompt,
reference image path, dimensions and code contract) and returns Python source.
This module never calls an API or imports an API SDK itself.
"""
import ast
import importlib
import os
from pathlib import Path

TEMPLATE = Path(__file__).with_name("generated_model.py")


def _provider_spec(provider=None):
    spec = provider if provider is not None else os.environ.get("PIPELINE_CODE_PROVIDER", "stub")
    if not isinstance(spec, str) or not spec.strip():
        raise ValueError("PIPELINE_CODE_PROVIDER must be 'stub' or 'package.module:function'")
    spec = spec.strip()
    if spec != "stub":
        parts = spec.split(":")
        if len(parts) != 2 or not all(parts) or not parts[1].isidentifier():
            raise ValueError("PIPELINE_CODE_PROVIDER must be 'stub' or 'package.module:function'")
        if not all(part.isidentifier() for part in parts[0].split(".")):
            raise ValueError("The code provider module must be a dotted Python module name")
    return spec


def provider_info(provider=None):
    """Describe the selected provider without importing or invoking its adapter."""
    spec = _provider_spec(provider)
    if spec == "stub":
        return {"provider": "stub-no-api", "mode": "stub", "template": "demo-table-v1"}
    return {"provider": spec, "mode": "external", "template": None}


def validate_blender_code(source):
    """Check the source contract without executing any generated Python.

    This is a structural check, not a sandbox for untrusted Python. The Blender
    runner performs the resulting geometry/bounds checks after execution.
    """
    if not isinstance(source, str) or not source.strip():
        raise ValueError("The code provider must return nonempty Python source text")
    try:
        module = ast.parse(source, filename="provider_blender_code.py")
    except SyntaxError as exc:
        raise ValueError(f"The code provider returned invalid Python: {exc.msg}") from exc
    functions = [node for node in module.body if isinstance(node, ast.FunctionDef)
                 and node.name == "create_model"]
    if len(functions) != 1:
        raise ValueError("Blender source must define one module-level create_model(dimensions) function")
    args = functions[0].args
    positional = args.posonlyargs + args.args
    if (len(positional) != 1 or positional[0].arg != "dimensions" or args.defaults
            or args.vararg is not None or args.kwarg is not None or args.kwonlyargs):
        raise ValueError("Blender source must accept exactly create_model(dimensions)")
    return source


def provide_blender_code(handoff, provider=None):
    """Return validated source from the configured local stub or future adapter."""
    spec = _provider_spec(provider)
    if spec == "stub":
        source = TEMPLATE.read_text(encoding="utf-8")
    else:
        module_name, function_name = spec.split(":")
        adapter = getattr(importlib.import_module(module_name), function_name, None)
        if not callable(adapter):
            raise ValueError(f"Code provider {spec!r} is not callable")
        source = adapter(handoff)
    return validate_blender_code(source)
