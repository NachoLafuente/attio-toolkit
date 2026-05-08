"""Shared test helpers: load skill scripts as importable modules."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

ROOT = Path(__file__).resolve().parent.parent


def _load(module_name: str, path: Path) -> ModuleType:
    from importlib.machinery import SourceFileLoader

    loader = SourceFileLoader(module_name, str(path))
    spec = importlib.util.spec_from_loader(module_name, loader)
    if not spec or not spec.loader:
        raise RuntimeError(f"could not load {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = mod
    spec.loader.exec_module(mod)
    return mod


def load_audit() -> ModuleType:
    return _load("audit_module", ROOT / "skills" / "attio-audit" / "audit.py")


def load_cost() -> ModuleType:
    return _load("cost_module", ROOT / "skills" / "attio-cost-explorer" / "cost.py")


def load_stale() -> ModuleType:
    return _load("stale_module", ROOT / "skills" / "attio-stale-records" / "stale.py")


def load_coverage() -> ModuleType:
    return _load("coverage_module", ROOT / "skills" / "attio-attribute-coverage" / "coverage.py")


def load_wrapper() -> ModuleType:
    return _load("wrapper_module", ROOT / "cli" / "attio")
