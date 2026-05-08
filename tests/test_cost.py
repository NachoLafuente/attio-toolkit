"""Tests for /attio-cost-explorer plan-selection logic."""

from conftest import load_cost


def test_free_plan_for_small_team_with_no_custom_objects():
    cost = load_cost()
    assert cost.determine_min_plan(seats=1, has_custom_objects=False) == "Free"
    assert cost.determine_min_plan(seats=3, has_custom_objects=False) == "Free"


def test_plus_when_seats_exceed_free_cap():
    cost = load_cost()
    assert cost.determine_min_plan(seats=4, has_custom_objects=False) == "Plus"
    assert cost.determine_min_plan(seats=20, has_custom_objects=False) == "Plus"


def test_pro_when_custom_objects_exist():
    cost = load_cost()
    assert cost.determine_min_plan(seats=1, has_custom_objects=True) == "Pro"
    assert cost.determine_min_plan(seats=10, has_custom_objects=True) == "Pro"


def test_default_pricing_constants_are_sensible():
    cost = load_cost()
    assert cost.DEFAULT_PLUS_RATE > 0
    assert cost.DEFAULT_PRO_RATE > cost.DEFAULT_PLUS_RATE
    assert cost.FREE_SEAT_CAP == 3
