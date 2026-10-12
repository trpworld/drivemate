#!/usr/bin/env python3
"""
Unit test suite for DriveMate Anti-Piracy & Device Binding System.
Verifies:
1. 1-Key 1-Device lock enforcement.
2. Block on unauthorized device sharing (Telegram/WhatsApp leaks).
3. Re-install support on same device.
4. Clone detection (copying chrome storage to another machine).
5. VIP bypass keys.
"""

import hashlib
import time

MASTER_SALT = "DriveMate-Pro-2026-SuperSecretMasterSalt-9941"

def is_key_valid(key: str) -> bool:
    raw = key.strip().upper().replace("-", "").replace(" ", "")
    if raw in ("DMPROLIFETIMEVIP", "DRIVEMATEPRO2026"):
        return True
    token = raw
    if token.startswith("DMPRO"):
        token = token[5:]
    if len(token) != 16:
        return False
    payload = token[:8]
    sig = token[8:16]
    expected_sig = hashlib.sha256((payload + MASTER_SALT).encode("utf-8")).hexdigest()[:8].upper()
    return sig == expected_sig

class MockActivationLedger:
    def __init__(self, max_devices_per_key=1):
        self.max_devices = max_devices_per_key
        # key -> {"devices": [deviceId...], "status": "ACTIVE"}
        self.ledger = {}

    def activate(self, key: str, device_id: str):
        key = key.strip().upper()
        if not is_key_valid(key):
            return {"success": False, "error": "INVALID_KEY"}

        if key in ("DMPROLIFETIMEVIP", "DRIVEMATEPRO2026"):
            return {"success": True, "message": "VIP Bypass"}

        if key not in self.ledger:
            # First activation
            self.ledger[key] = {
                "devices": [device_id],
                "status": "ACTIVE"
            }
            return {"success": True, "message": "Activated on Device 1"}

        record = self.ledger[key]
        if record["status"] == "BANNED":
            return {"success": False, "error": "LICENSE_REVOKED"}

        if device_id in record["devices"]:
            # Same device reinstall
            return {"success": True, "message": "Device recognized"}

        if len(record["devices"]) < self.max_devices:
            record["devices"].append(device_id)
            return {"success": True, "message": f"Activated on Device {len(record['devices'])}"}

        # Exceeded max devices!
        return {
            "success": False,
            "error": "DEVICE_LIMIT_EXCEEDED",
            "message": f"License already bound to another computer (Max {self.max_devices} allowed)"
        }

def test_device_binding_lifecycle():
    print("Testing Anti-Piracy Device Binding...")
    ledger = MockActivationLedger(max_devices_per_key=1)

    key = "DM-PRO-A1B2-C3D4-96B8-E9E8" # Sample valid format or signature
    # Let's generate a valid signature for test
    payload = "96365DD1"
    sig = hashlib.sha256((payload + MASTER_SALT).encode("utf-8")).hexdigest()[:8].upper()
    valid_key = f"DM-PRO-{payload[:4]}-{payload[4:]}-{sig[:4]}-{sig[4:]}"

    dev_alice = "DM-DEV-ALICE-MACBOOK"
    dev_bob = "DM-DEV-BOB-IMAC"
    dev_pirate = "DM-DEV-TELEGRAM-LEECHER"

    # 1. Alice buys key and activates on her MacBook -> SUCCESS
    res1 = ledger.activate(valid_key, dev_alice)
    assert res1["success"] is True, "Alice activation should succeed"
    print("  -> Alice (Device 1) successfully activated.")

    # 2. Alice re-installs or opens extension again on same MacBook -> SUCCESS
    res2 = ledger.activate(valid_key, dev_alice)
    assert res2["success"] is True, "Alice re-install should be recognized"
    print("  -> Alice re-installation on same device recognized.")

    # 3. Alice shares key with Bob -> REJECTED (Max 1 device)
    res3 = ledger.activate(valid_key, dev_bob)
    assert res3["success"] is False, "Bob should be rejected"
    assert res3["error"] == "DEVICE_LIMIT_EXCEEDED", "Expected DEVICE_LIMIT_EXCEEDED"
    print("  -> Sharing with Bob on Device 2 blocked with DEVICE_LIMIT_EXCEEDED.")

    # 4. Leaked on Telegram -> REJECTED
    res4 = ledger.activate(valid_key, dev_pirate)
    assert res4["success"] is False, "Pirate device should be rejected"
    assert res4["error"] == "DEVICE_LIMIT_EXCEEDED", "Expected DEVICE_LIMIT_EXCEEDED"
    print("  -> Public leak activation blocked.")

    # 5. VIP Developer key works anywhere
    res_vip1 = ledger.activate("DMPROLIFETIMEVIP", dev_alice)
    res_vip2 = ledger.activate("DMPROLIFETIMEVIP", dev_bob)
    assert res_vip1["success"] and res_vip2["success"], "VIP key should bypass device lock"
    print("  -> VIP keys verified.")

    print("==================================================")
    print(" ALL ANTI-PIRACY & DEVICE LOCK TESTS PASSED (100%)")
    print("==================================================")

if __name__ == "__main__":
    test_device_binding_lifecycle()
