"""
Master Generator Script: Production University Classroom.
Assembles architecture, furniture, props, lighting, bakes Ambient Occlusion,
saves .blend, and exports production GLB for Three.js r128.
"""

import sys
import os
from pathlib import Path

# Add current script directory to sys.path
script_dir = os.path.dirname(os.path.abspath(__file__))
if script_dir not in sys.path:
    sys.path.append(script_dir)

import bpy
from classroom_materials import build_classroom_material_library, get_or_create_gltf_output_group
from classroom_builder import construct_full_classroom
from classroom_lighting_and_baking import setup_classroom_lighting, bake_ambient_occlusion_and_lightmap

def main():
    print("=" * 60)
    print("  PRODUCTION CLASSROOM GENERATION PIPELINE")
    print("=" * 60)

    # Determine output directories
    workspace_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    output_dir = os.path.join(script_dir, "output")
    public_models_dir = os.path.join(workspace_root, "public", "models")
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(public_models_dir, exist_ok=True)

    blend_file = os.path.join(output_dir, "classroom_production.blend")
    glb_output_file = os.path.join(output_dir, "classroom_production.glb")
    glb_public_file = os.path.join(public_models_dir, "classroom_production.glb")

    # 1. Build classroom geometry & materials
    root_group = construct_full_classroom()

    # 2. Setup lighting
    setup_classroom_lighting()

    # 3. Bake Ambient Occlusion map with Metal GPU Cycles
    ao_map_path = bake_ambient_occlusion_and_lightmap(output_dir, resolution=1024, samples=24)

    # 4. Save .blend file
    print(f"\n[Pipeline] Saving full source scene to {blend_file}...")
    bpy.ops.wm.save_as_mainfile(filepath=blend_file)
    blend_size = os.path.getsize(blend_file)
    print(f"[Pipeline] Source .blend saved: {blend_size:,} bytes")

    # 5. Export to GLB
    print(f"\n[Pipeline] Exporting to glTF 2.0 Binary (.glb) at {glb_output_file}...")
    bpy.ops.export_scene.gltf(
        filepath=glb_output_file,
        export_format='GLB',
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_lights=True,
        export_extras=True,
        export_image_format='AUTO'
    )

    glb_size = os.path.getsize(glb_output_file)
    print(f"[Pipeline] Export completed: {glb_size:,} bytes")

    # Copy / save to public/models as well for Three.js web serving
    import shutil
    shutil.copyfile(glb_output_file, glb_public_file)
    print(f"[Pipeline] Copied GLB to web public directory: {glb_public_file}")

    # 6. Gather and verify scene metrics
    print("\n" + "=" * 60)
    print("  PRODUCTION CLASSROOM VERIFICATION & METRICS")
    print("=" * 60)

    total_verts = 0
    total_tris = 0
    total_meshes = 0

    mesh_objects = [obj for obj in bpy.data.objects if obj.type == 'MESH']
    for obj in mesh_objects:
        total_meshes += 1
        mesh = obj.data
        total_verts += len(mesh.vertices)
        total_tris += len(mesh.polygons)

    print(f"Total Meshes:      {total_meshes}")
    print(f"Total Vertices:    {total_verts:,}")
    print(f"Total Polygons:    {total_tris:,}")
    print(f"Total Materials:   {len(bpy.data.materials)}")
    print(f"Total Images:      {len(bpy.data.images)}")
    print(f".blend File Size:  {blend_size:,} bytes ({blend_size / (1024*1024):.2f} MB)")
    print(f".glb File Size:    {glb_size:,} bytes ({glb_size / (1024*1024):.2f} MB)")

    # Verify key interactive components exist
    expected_interactive = [
        "Door_Leaf_Classroom",
        "TeacherDesk_Drawer",
        "Switchboard_Door",
        "CeilingFan_Hub_1",
        "CeilingFan_Hub_2",
        "Item_Brass_Key"
    ]
    print("\nVerifying Interactive Objects:")
    for name in expected_interactive:
        obj = bpy.data.objects.get(name)
        if obj:
            print(f"  [OK] Found interactive component: '{name}' (type={obj.type}, loc={obj.location})")
        else:
            print(f"  [FAIL] Missing interactive component: '{name}'")
            sys.exit(1)

    print("\n>>> STAGES 3 & 4 COMPLETED SUCCESSFULLY <<<\n")

if __name__ == "__main__":
    main()

