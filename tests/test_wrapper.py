"""Tests for the cli/attio multi-workspace wrapper helpers."""

from pathlib import Path

import pytest

from conftest import load_wrapper


def test_load_dotenv_skips_comments_and_blanks(tmp_path: Path):
    wrapper = load_wrapper()
    env_file = tmp_path / ".env"
    env_file.write_text(
        "# comment line\n"
        "\n"
        "ATTIO_API_KEY_ACME=abc123\n"
        "ATTIO_API_KEY_FOO='quoted-value'\n"
        'ATTIO_API_KEY_BAR="double-quoted"\n'
        "MALFORMED LINE\n"
    )
    parsed = wrapper.load_dotenv(env_file)
    assert parsed["ATTIO_API_KEY_ACME"] == "abc123"
    assert parsed["ATTIO_API_KEY_FOO"] == "quoted-value"
    assert parsed["ATTIO_API_KEY_BAR"] == "double-quoted"
    assert "MALFORMED LINE" not in parsed
    assert "" not in parsed


def test_list_workspaces_returns_lowercased_sorted_names():
    wrapper = load_wrapper()
    env = {
        "ATTIO_API_KEY_ZULU": "x",
        "ATTIO_API_KEY_ALPHA": "y",
        "ATTIO_API_KEY_MIKE": "z",
        "OTHER_KEY": "ignored",
    }
    result = wrapper.list_workspaces(env)
    assert result == ["alpha", "mike", "zulu"]


def test_list_workspaces_empty_when_no_attio_keys():
    wrapper = load_wrapper()
    assert wrapper.list_workspaces({"FOO": "bar"}) == []


def test_find_env_walks_up_from_cwd(tmp_path: Path, monkeypatch):
    wrapper = load_wrapper()
    nested = tmp_path / "a" / "b" / "c"
    nested.mkdir(parents=True)
    (tmp_path / ".env").write_text("ATTIO_API_KEY_ACME=token\n")

    monkeypatch.chdir(nested)
    monkeypatch.delenv("ATTIO_TOOLKIT_ENV", raising=False)
    found = wrapper.find_env_file()
    assert found is not None
    assert found.resolve() == (tmp_path / ".env").resolve()


def test_find_env_respects_explicit_override(tmp_path: Path, monkeypatch):
    wrapper = load_wrapper()
    explicit = tmp_path / "custom.env"
    explicit.write_text("ATTIO_API_KEY_BETA=token\n")

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ATTIO_TOOLKIT_ENV", str(explicit))
    found = wrapper.find_env_file()
    assert found is not None
    assert found.resolve() == explicit.resolve()


def test_find_env_returns_none_when_nothing_exists(tmp_path: Path, monkeypatch):
    wrapper = load_wrapper()
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("ATTIO_TOOLKIT_ENV", raising=False)
    monkeypatch.setattr(wrapper, "__file__", str(tmp_path / "ghost-script-path"))
    found = wrapper.find_env_file()
    assert found is None
