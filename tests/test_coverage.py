"""Tests for /attio-attribute-coverage filled-detection and category logic."""

from conftest import load_coverage


def test_is_filled_handles_common_value_shapes():
    coverage = load_coverage()
    assert coverage.is_filled(None) is False
    assert coverage.is_filled([]) is False
    assert coverage.is_filled("") is False
    assert coverage.is_filled("   ") is False
    assert coverage.is_filled({}) is False

    assert coverage.is_filled([{"foo": "bar"}]) is True
    assert coverage.is_filled("acme") is True
    assert coverage.is_filled({"key": "value"}) is True
    assert coverage.is_filled(0) is True  # zero is a real value
    assert coverage.is_filled(False) is True


def test_categorize_returns_three_buckets():
    coverage = load_coverage()
    assert coverage.categorize(100) == "well_used"
    assert coverage.categorize(50) == "well_used"
    assert coverage.categorize(49.9) == "underused"
    assert coverage.categorize(10) == "underused"
    assert coverage.categorize(9.9) == "bloat"
    assert coverage.categorize(0) == "bloat"


def test_category_labels_have_emoji_and_text():
    coverage = load_coverage()
    for cat in ("well_used", "underused", "bloat"):
        assert coverage.category_emoji(cat) in {"✓", "⚠", "💀"}
        assert isinstance(coverage.category_label(cat), str)
        assert len(coverage.category_label(cat)) > 0


def test_threshold_constants_are_sane():
    coverage = load_coverage()
    assert 0 < coverage.UNDERUSED < coverage.WELL_USED < 100
