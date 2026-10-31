#!/usr/bin/env python3
"""
Blender Detection and Verification Utility for macOS and Unix systems.
Detects Blender executable path and version without hardcoding paths.
"""

import os
import subprocess
import sys
from pathlib import Path

def find_blender():
    candidates = []

    # 1. Check PATH
    try:
        which_result = subprocess.run(["which", "blender"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if which_result.returncode == 0 and which_result.stdout.strip():
            candidates.append(which_result.stdout.strip())
    except Exception:
        pass

    # 2. Check spotlight mdfind on macOS
    if sys.platform == "darwin":
        try:
            mdfind_res = subprocess.run(
                ["mdfind", "kMDItemCFBundleIdentifier == 'org.blenderfoundation.blender'"],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
            )
            for line in mdfind_res.stdout.splitlines():
                line = line.strip()
                if line.endswith(".app"):
                    exe = os.path.join(line, "Contents", "MacOS", "Blender")
                    if os.path.isfile(exe) and os.access(exe, os.X_OK):
                        candidates.append(exe)
        except Exception:
            pass

    # 3. Standard filesystem locations
    common_mac_paths = [
        "/Applications/Blender.app/Contents/MacOS/Blender",
        "/Applications/Blender/Blender.app/Contents/MacOS/Blender",
        os.path.expanduser("~/Applications/Blender.app/Contents/MacOS/Blender"),
        "/opt/homebrew/bin/blender",
        "/usr/local/bin/blender",
    ]
    # Wildcard search in /Applications
    for app in Path("/Applications").glob("Blender*.app"):
        exe = app / "Contents" / "MacOS" / "Blender"
        if exe.exists():
            candidates.append(str(exe))

    for p in common_mac_paths:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            candidates.append(p)

    # Filter unique and existing
    seen = set()
    valid_candidates = []
    for c in candidates:
        if c not in seen and os.path.isfile(c) and os.access(c, os.X_OK):
            seen.add(c)
            valid_candidates.append(c)

    return valid_candidates

def get_blender_version(blender_path):
    try:
        res = subprocess.run([blender_path, "--version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        first_line = res.stdout.splitlines()[0] if res.stdout.splitlines() else "Unknown"
        return first_line.strip()
    except Exception as e:
        return f"Error: {e}"

if __name__ == "__main__":
    blenders = find_blender()
    if not blenders:
        print("ERROR: No Blender installation found.")
        sys.exit(1)
    print(f"Found {len(blenders)} Blender candidate(s):")
    for b in blenders:
        ver = get_blender_version(b)
        print(f"  Path: {b}")
        print(f"  Version: {ver}")
    # Print the primary one
    print(f"\nPRIMARY_BLENDER={blenders[0]}")

