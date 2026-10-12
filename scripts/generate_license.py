#!/usr/bin/env python3
"""
DriveMate — Cryptographic Lifetime License Key Generator
Zero-Server, Zero-Hosting, 100% Offline Verifiable License Keys.

Usage:
    python3 scripts/generate_license.py
    python3 scripts/generate_license.py "customer@email.com"
    python3 scripts/generate_license.py --count 5
"""

import argparse
import hashlib
import os
import sys

MASTER_SALT = "DriveMate-Pro-2026-SuperSecretMasterSalt-9941"

def generate_key(customer_seed: str = None) -> str:
    """Generates an authentic, cryptographically signed DriveMate PRO Lifetime License Key."""
    if customer_seed:
        # Derive 8-char hex payload from customer seed
        seed_hash = hashlib.sha256(customer_seed.encode("utf-8")).hexdigest()
        payload = seed_hash[:8].upper()
    else:
        # Random 4 bytes = 8 hex chars
        payload = os.urandom(4).hex().upper()

    # Compute signature
    sig_hash = hashlib.sha256((payload + MASTER_SALT).encode("utf-8")).hexdigest()
    signature = sig_hash[:8].upper()

    # Format: DM-PRO-XXXX-XXXX-YYYY-YYYY
    p1 = payload[:4]
    p2 = payload[4:]
    s1 = signature[:4]
    s2 = signature[4:]

    return f"DM-PRO-{p1}-{p2}-{s1}-{s2}"

def verify_key(key: str) -> bool:
    """Verifies whether a key is valid according to the master salt."""
    raw = key.strip().upper().replace("-", "")
    if raw.startswith("DMPRO"):
        raw = raw[5:]
    if len(raw) != 16:
        return False
    payload = raw[:8]
    signature = raw[8:]
    expected_hash = hashlib.sha256((payload + MASTER_SALT).encode("utf-8")).hexdigest()
    expected_sig = expected_hash[:8].upper()
    return signature == expected_sig

def main():
    parser = argparse.ArgumentParser(description="DriveMate PRO License Key Generator")
    parser.add_argument("customer", nargs="?", default=None, help="Optional customer name or email")
    parser.add_argument("--count", "-n", type=int, default=1, help="Number of keys to generate")
    parser.add_argument("--verify", "-v", type=str, default=None, help="Verify an existing key")
    args = parser.parse_args()

    if args.verify:
        is_valid = verify_key(args.verify)
        print("==================================================")
        print(f"Key:    {args.verify}")
        print(f"Status: {'✓ VALID LIFETIME PRO KEY' if is_valid else '✗ INVALID KEY'}")
        print("==================================================")
        sys.exit(0 if is_valid else 1)

    print("==================================================")
    print("  DriveMate PRO — Lifetime License Key Generator")
    print("==================================================")

    for i in range(args.count):
        seed = f"{args.customer}_{i}" if (args.customer and args.count > 1) else args.customer
        key = generate_key(seed)
        assert verify_key(key), "Generated key failed self-verification!"
        if args.customer:
            print(f"Customer:    {args.customer}")
        print(f"License Key: {key}")
        print("Plan:        Lifetime Pro (Unlimited 10 GB Daily Bypass)")
        print("--------------------------------------------------")

if __name__ == "__main__":
    main()
