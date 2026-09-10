"""Read Zepp credentials from .env and print the linked band's BLE key.

The password stays out of the process command line. Run this script with the
Python interpreter from huami-token's virtual environment.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from huami_token.errors import HuamiTokenError, LogoutError
from huami_token.xiaomi import XiaomiClient, XiaomiSession
from huami_token.zepp import ZeppClient, ZeppSession


ROOT = Path(__file__).resolve().parents[1]


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        values[name.strip()] = value.strip().strip('"').strip("'")
    return values


def require(values: dict[str, str], name: str) -> str:
    value = os.environ.get(name) or values.get(name)
    if not value:
        raise ValueError(f"{name} is missing from {ROOT / '.env'}")
    return value


def zepp_devices(email: str, password: str) -> int:
    session = ZeppSession(username=email, password=password)
    session.login()
    try:
        devices = ZeppClient(session).get_devices()
        if not devices:
            print("No devices are linked to this Zepp account.")
            return 2
        for index, device in enumerate(devices):
            active = "yes" if device.active else "no"
            print(f"Device {index}")
            print(f"  MAC: {device.mac}")
            print(f"  Active: {active}")
            print(f"  Auth key: 0x{device.auth_key}")
        return 0
    finally:
        try:
            session.logout()
        except LogoutError:
            pass


def xiaomi_devices(email: str, password: str) -> int:
    session = XiaomiSession(username=email, password=password)
    session.login()
    sources = XiaomiClient(session).get_source_list().get("result", {}).get("list") or []
    if not sources:
        print("No devices are linked to this Xiaomi account.")
        return 2
    for index, source in enumerate(sources):
        detail = source.get("detail", {})
        if isinstance(detail, str):
            import json

            detail = json.loads(detail)
        print(f"Device {index}: {source.get('name', 'Unknown').strip()}")
        print(f"  MAC: {detail.get('mac', source.get('mac', 'unknown'))}")
        print(f"  Auth key: 0x{detail.get('auth_key', '') or '(not available)'}")
    return 0


def main() -> int:
    values = load_env(ROOT / ".env")
    method = (os.environ.get("ACCOUNT_METHOD") or values.get("ACCOUNT_METHOD") or "amazfit").lower()
    email = require(values, "EMAIL")
    password = require(values, "PASSWORD")

    try:
        if method == "amazfit":
            return zepp_devices(email, password)
        if method == "xiaomi":
            return xiaomi_devices(email, password)
        print("ACCOUNT_METHOD must be 'amazfit' for Zepp Life or 'xiaomi' for Mi Fitness.", file=sys.stderr)
        return 2
    except (HuamiTokenError, ValueError) as error:
        print(f"Could not retrieve the band key: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
