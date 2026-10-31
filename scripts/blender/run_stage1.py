#!/usr/bin/env python3
"""
Runner for Stage 1: Detect Blender, run background Python execution,
create .blend, reopen it, and export .glb.
"""
import os
import subprocess
import sys
from blender_detector import find_blender, get_blender_version

def main():
    print("=== STAGE 1: VERIFY BLENDER ===")
    blenders = find_blender()
    if not blenders:
        print("[-] FAIL: Blender not detected on this machine.")
        sys.exit(1)

    blender_exe = blenders[0]
    version_str = get_blender_version(blender_exe)
    print(f"[+] Detected Blender Executable: {blender_exe}")
    print(f"[+] Detected Blender Version:    {version_str}")

    workspace = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.join(workspace, "output")
    os.makedirs(output_dir, exist_ok=True)
    test_script = os.path.join(workspace, "stage1_internal_test.py")

    cmd = [
        blender_exe,
        "--background",
        "--factory-startup",
        "--python", test_script,
        "--",
        output_dir
    ]

    print(f"[+] Executing background Blender test command:\n    {' '.join(cmd)}")
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    print("\n--- Blender Standard Output ---")
    print(result.stdout)

    if result.stderr:
        print("--- Blender Standard Error ---")
        print(result.stderr)

    blend_file = os.path.join(output_dir, "stage1_test.blend")
    glb_file = os.path.join(output_dir, "stage1_test.glb")

    if result.returncode != 0:
        print(f"[-] FAIL: Blender process exited with code {result.returncode}")
        sys.exit(result.returncode)

    if not os.path.exists(blend_file):
        print(f"[-] FAIL: Expected .blend file was not created: {blend_file}")
        sys.exit(1)

    if not os.path.exists(glb_file):
        print(f"[-] FAIL: Expected .glb file was not created: {glb_file}")
        sys.exit(1)

    print(f"[+] SUCCESS: .blend file verified ({os.path.getsize(blend_file)} bytes)")
    print(f"[+] SUCCESS: .glb file verified ({os.path.getsize(glb_file)} bytes)")
    print("\n>>> STAGE 1 COMPLETE & VERIFIED <<<\n")

if __name__ == "__main__":
    main()

