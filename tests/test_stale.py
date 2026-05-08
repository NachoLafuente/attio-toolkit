"""Tests for /attio-stale-records bucketing and sparseness logic."""

from datetime import datetime, timedelta, timezone

from conftest import load_stale


def test_bucket_boundaries():
    stale = load_stale()
    assert stale.bucket(0) == "<30d"
    assert stale.bucket(29) == "<30d"
    assert stale.bucket(30) == "30-90d"
    assert stale.bucket(89) == "30-90d"
    assert stale.bucket(90) == "90-180d"
    assert stale.bucket(179) == "90-180d"
    assert stale.bucket(180) == "180-365d"
    assert stale.bucket(364) == "180-365d"
    assert stale.bucket(365) == "365+d"
    assert stale.bucket(2000) == "365+d"


def test_parse_dt_handles_zulu_and_offsets():
    stale = load_stale()
    assert stale.parse_dt(None) is None
    assert stale.parse_dt("") is None
    assert stale.parse_dt("not a date") is None
    parsed = stale.parse_dt("2024-01-15T10:00:00Z")
    assert parsed is not None
    assert parsed.year == 2024 and parsed.month == 1 and parsed.day == 15


def test_last_touched_picks_most_recent_timestamp():
    stale = load_stale()
    record = {
        "created_at": "2023-01-01T00:00:00Z",
        "updated_at": "2024-06-15T00:00:00Z",
        "last_modified_at": "2024-03-01T00:00:00Z",
    }
    result = stale.last_touched(record)
    assert result is not None
    assert result.year == 2024 and result.month == 6


def test_last_touched_returns_none_for_record_without_timestamps():
    stale = load_stale()
    assert stale.last_touched({}) is None


def test_is_sparse_person_detects_no_email_no_company():
    stale = load_stale()
    assert stale.is_sparse_person({"values": {}}) is True
    assert stale.is_sparse_person({"values": {"email_addresses": [{"email_address": "a@b.com"}]}}) is False
    assert stale.is_sparse_person({"values": {"company": [{"target_record_id": "abc"}]}}) is False


def test_is_sparse_company_detects_no_domain_no_team():
    stale = load_stale()
    assert stale.is_sparse_company({"values": {}}) is True
    assert stale.is_sparse_company({"values": {"domains": [{"domain": "acme.com"}]}}) is False
    assert stale.is_sparse_company({"values": {"team": [{"target_record_id": "p1"}]}}) is False


def test_display_label_extracts_record_id_short_form():
    stale = load_stale()
    record = {
        "id": {"record_id": "0c050982-1234-5678-aaaa-bbbbccccdddd"},
        "values": {"name": [{"full_name": "Alice"}]},
    }
    label = stale.display_label("people", record)
    assert "Alice" in label
    assert "0c050982" in label
    assert len(label) < 100


def test_display_label_falls_back_to_no_name():
    stale = load_stale()
    record = {"id": {"record_id": "abcdefgh-1111-2222-3333-444455556666"}, "values": {}}
    label = stale.display_label("companies", record)
    assert "(no name)" in label
