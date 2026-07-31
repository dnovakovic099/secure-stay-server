#!/usr/bin/env python3
"""
Schlage Encode CLI bridge for SecureStay.

Uses the same Allegion/Yonomi cloud API as the open-source pyschlage library.
Node calls this process with a JSON command on stdin and gets a JSON response
on stdout. Kept as a thin adapter so we don't re-implement Cognito SRP in JS.

Install: pip3 install --user pyschlage
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone


def fail(message: str, code: int = 1) -> None:
    print(json.dumps({"ok": False, "error": message}))
    sys.exit(code)


def ok(data) -> None:
    print(json.dumps({"ok": True, "data": data}))
    sys.exit(0)


def parse_cmd() -> dict:
    raw = sys.stdin.read()
    if not raw.strip():
        fail("Empty stdin; expected JSON command")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(f"Invalid JSON: {exc}")


def authenticate(email: str, password: str):
    try:
        from pyschlage import Auth, Schlage
    except ImportError:
        fail(
            "pyschlage is not installed. Run: pip3 install --user pyschlage"
        )
    # Cognito is case-sensitive for these accounts.
    auth = Auth(email.strip().lower(), password)
    auth.authenticate()
    return Schlage(auth)


def list_devices(api) -> list:
    # pyschlage versions differ: some accept include_access_codes=, older ones don't.
    try:
        locks = api.locks(include_access_codes=False)
    except TypeError:
        locks = api.locks()
    out = []
    for lock in locks:
        battery = lock.battery_level
        out.append(
            {
                "externalDeviceId": lock.device_id,
                "deviceName": lock.name,
                "deviceType": lock.device_type,
                "model": lock.model_name,
                "isOnline": bool(lock.connected),
                "isLocked": lock.is_locked,
                "batteryLevel": (battery / 100.0) if battery is not None else None,
                "batteryStatus": (
                    "critical"
                    if battery is not None and battery <= 10
                    else "low"
                    if battery is not None and battery <= 25
                    else "good"
                    if battery is not None and battery <= 75
                    else "full"
                    if battery is not None
                    else None
                ),
            }
        )
    return out


def list_codes(api, device_id: str) -> list:
    locks = {lock.device_id: lock for lock in api.locks()}
    lock = locks.get(device_id)
    if not lock:
        fail(f"Lock not found: {device_id}")
    lock.refresh_access_codes()
    codes = []
    for code in (lock.access_codes or {}).values():
        starts_at = ends_at = None
        schedule = code.schedule
        if schedule is not None and hasattr(schedule, "start") and hasattr(schedule, "end"):
            starts_at = schedule.start.astimezone(timezone.utc).isoformat()
            ends_at = schedule.end.astimezone(timezone.utc).isoformat()
        codes.append(
            {
                "externalCodeId": code.access_code_id,
                "code": code.code,
                "name": code.name,
                "status": "set" if not code.disabled else "removed",
                "startsAt": starts_at,
                "endsAt": ends_at,
            }
        )
    return codes


def create_code(api, device_id: str, code: str, name: str, starts_at, ends_at) -> dict:
    from pyschlage.code import AccessCode, TemporarySchedule

    locks = {lock.device_id: lock for lock in api.locks()}
    lock = locks.get(device_id)
    if not lock:
        fail(f"Lock not found: {device_id}")

    access = AccessCode(name=name or "Access Code", code=str(code))
    if starts_at and ends_at:
        start = datetime.fromisoformat(starts_at.replace("Z", "+00:00"))
        end = datetime.fromisoformat(ends_at.replace("Z", "+00:00"))
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        access.schedule = TemporarySchedule(start=start, end=end)

    lock.add_access_code(access)
    return {
        "externalCodeId": access.access_code_id,
        "code": access.code,
        "name": access.name,
        "status": "set",
        "startsAt": starts_at,
        "endsAt": ends_at,
    }


def delete_code(api, device_id: str, external_code_id: str) -> None:
    locks = {lock.device_id: lock for lock in api.locks()}
    lock = locks.get(device_id)
    if not lock:
        fail(f"Lock not found: {device_id}")
    lock.refresh_access_codes()
    code = (lock.access_codes or {}).get(external_code_id)
    if not code:
        # Already gone upstream — treat as success so local cleanup can proceed.
        return
    code.delete()


def main() -> None:
    cmd = parse_cmd()
    action = cmd.get("action")
    email = cmd.get("email")
    password = cmd.get("password")
    if not email or not password:
        fail("email and password are required")

    try:
        api = authenticate(email, password)
        if action == "list_devices":
            ok(list_devices(api))
        if action == "list_codes":
            ok(list_codes(api, cmd["deviceId"]))
        if action == "create_code":
            ok(
                create_code(
                    api,
                    cmd["deviceId"],
                    cmd["code"],
                    cmd.get("name") or "Access Code",
                    cmd.get("startsAt"),
                    cmd.get("endsAt"),
                )
            )
        if action == "delete_code":
            delete_code(api, cmd["deviceId"], cmd["externalCodeId"])
            ok({"deleted": True})
        if action == "ping":
            ok({"authenticated": True, "userId": api._auth.user_id})
        fail(f"Unknown action: {action}")
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 — surface any auth/API failure to Node
        fail(str(exc))


if __name__ == "__main__":
    main()
