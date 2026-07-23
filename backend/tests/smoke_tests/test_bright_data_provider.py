from types import SimpleNamespace

import pytest

from app.modules import bright_data_provider as bdp


class TriggerResponse:
    def json(self):
        return {"snapshot_id": "snapshot-1"}


def make_settings():
    return SimpleNamespace(
        bright_data_api_key="test-key",
        bright_data_api_base="https://example.test",
    )


def test_snapshot_polling_stops_at_deadline(monkeypatch):
    monotonic_values = iter([0, 0, 241])
    monkeypatch.setattr(bdp.time, "monotonic", lambda: next(monotonic_values))
    monkeypatch.setattr(bdp.time, "sleep", lambda *_: None)
    monkeypatch.setattr(bdp, "check_snapshot_status", lambda *_: "running")

    with pytest.raises(RuntimeError, match="snapshot timed out"):
        bdp.check_brightdata_snapshot(TriggerResponse(), make_settings())
