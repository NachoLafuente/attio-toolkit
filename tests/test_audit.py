"""Tests for the /attio-audit pure-function logic."""

from conftest import load_audit


def test_grade_letter_boundaries():
    audit = load_audit()
    assert audit.grade_letter(100) == "A"
    assert audit.grade_letter(90) == "A"
    assert audit.grade_letter(89) == "B"
    assert audit.grade_letter(80) == "B"
    assert audit.grade_letter(79) == "C"
    assert audit.grade_letter(70) == "C"
    assert audit.grade_letter(69) == "D"
    assert audit.grade_letter(60) == "D"
    assert audit.grade_letter(59) == "F"
    assert audit.grade_letter(0) == "F"


def test_percent_score_thresholds():
    audit = load_audit()
    thresholds = [(85, 10), (70, 7), (50, 4)]
    assert audit.percent_score(95, thresholds) == 10
    assert audit.percent_score(85, thresholds) == 10
    assert audit.percent_score(80, thresholds) == 7
    assert audit.percent_score(70, thresholds) == 7
    assert audit.percent_score(60, thresholds) == 4
    assert audit.percent_score(50, thresholds) == 4
    assert audit.percent_score(40, thresholds) == 0
    assert audit.percent_score(0, thresholds) == 0


def test_bar_renders_proportionally():
    audit = load_audit()
    assert audit.bar(0, 100, width=10) == "░" * 10
    assert audit.bar(100, 100, width=10) == "█" * 10
    assert audit.bar(50, 100, width=10) == "█" * 5 + "░" * 5
    assert audit.bar(0, 0, width=10) == "░" * 10  # divide-by-zero safety


def test_section_dataclass_initializes_empty_findings():
    audit = load_audit()
    s = audit.Section(name="x", score=0, max_score=10)
    assert s.findings == []
    assert s.name == "x"
