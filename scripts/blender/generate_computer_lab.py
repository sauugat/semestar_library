"""
Master Generator Script: Production University Computer & Electronics Laboratory.
Assembles architecture, computer workstations, electronics workbenches, equipment cabinets,
lighting, bakes Ambient Occlusion with Cycles GPU on Apple Silicon M4,
saves .blend, and exports production GLB for Three.js r128.
"""

import sys
import os
import shutil
from pathlib import Path

# Add current script directory to sys.path
script_dir = os.path.dirname(os.path.abspath(__file__))
if script_dir not in sys.path:
    sys.path.append(script_dir)

import bpy
from computer_lab_materials import build_computer_lab_material_library, get_or_create_gltf_output_group
from computer_lab_builder import construct_full_computer_lab
from computer_lab_lighting_and_baking import setup_computer_lab_lighting, bake_ambient_occlusion_and_lightmap

def optimize_static_meshes(root_group):
    """
    Optimizes static laboratory geometry by joining non-interactive meshes by material.
    Preserves all interactive objects, dynamic lights, and transparent glass meshes.
    Reduces draw calls and node traversal overhead while preserving UVs and AO maps.
    """
    interactive_names = {
        'Door_Lab_Pivot', 'Door_Frame_Lab', 'Door_Frame_Lab_Group',
        'Door_Leaf_Lab', 'Door_Slab_Mesh', 'Door_Handle_Plate_In', 'Door_Handle_Plate_Out', 'Door_Handle_Lever_Lab', 'Door_Handle_Lever_Out',
        'Cabinet_Door_Left', 'Cabinet_Door_Right', 'Cabinet_Door_L_Mesh', 'Cabinet_Door_R_Mesh',
        'Cab_Handle_L', 'Cab_Handle_R',
        'TeacherDesk_Drawer_Lab', 'Inst_Drw_Front', 'Inst_Drw_Bottom', 'Inst_Drw_Handle',
        'Item_Lab_Key', 'Key_Ring', 'Key_Shaft', 'Key_Bit',
        'Switchboard_Door_Lab', 'Switchboard_Door_Mesh', 'Switchboard_Latch',
        'Terminal_Monitor_1',
        'Window_Glass_Lab_1', 'Window_Glass_Lab_2',
        'Oscilloscope_Screen_1', 'Oscilloscope_Screen_2'
    }

    def is_protected(obj):
        if obj.name in interactive_names:
            return True
        if obj.name.startswith('TubeLight_Lamp'):
            return True
        curr = obj.parent
        while curr:
            if curr.name in interactive_names:
                return True
            curr = curr.parent
        return False

    mesh_objs = [o for o in bpy.data.objects if o.type == 'MESH']
    static = [o for o in mesh_objs if not is_protected(o)]

    # Step 1: Unparent all static meshes, preserve world transform, and bake into vertex positions
    for o in static:
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        if root_group:
            o.parent = root_group

    by_mat = {}
    for o in static:
        mat = o.data.materials[0] if len(o.data.materials) > 0 else None
        mat_name = mat.name if mat else 'NoMaterial'
        by_mat.setdefault(mat_name, []).append(o)

    for mat_name, objs in by_mat.items():
        if len(objs) <= 1:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        target = objs[0]
        bpy.context.view_layer.objects.active = target
        bpy.ops.object.join()
        target.name = f'Merged_{mat_name}'
        if root_group:
            target.parent = root_group

    remaining = [o for o in bpy.data.objects if o.type == 'MESH']
    print(f"[Pipeline] Optimized static geometry: reduced meshes from {len(mesh_objs)} to {len(remaining)} (preserved all interactive sub-meshes)")

def main():
    print("=" * 60)
    print("  PRODUCTION COMPUTER & ELECTRONICS LAB GENERATION PIPELINE")
    print("=" * 60)

    # Determine output directories
    workspace_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    output_dir = os.path.join(script_dir, "output")
    public_models_dir = os.path.join(workspace_root, "public", "models")
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(public_models_dir, exist_ok=True)

    blend_file = os.path.join(output_dir, "computer_lab_production.blend")
    glb_output_file = os.path.join(output_dir, "computer_lab_production.glb")
    glb_public_file = os.path.join(public_models_dir, "computer_lab_production.glb")

    # 1. Build laboratory geometry & materials
    root_group = construct_full_computer_lab()

    # 2. Setup lighting
    setup_computer_lab_lighting()

    # 3. Bake Ambient Occlusion map with Metal GPU Cycles
    ao_map_path = bake_ambient_occlusion_and_lightmap(output_dir, resolution=1024, samples=24)

    # 4. Geometry Optimization (Draw Call Reduction): Merge static meshes by material while preserving interactive sub-meshes
    optimize_static_meshes(root_group)

    # 5. Save .blend file
    print(f"\n[Pipeline] Saving full source scene to {blend_file}...")
    bpy.ops.wm.save_as_mainfile(filepath=blend_file)
    blend_size = os.path.getsize(blend_file)
    print(f"[Pipeline] Source .blend saved: {blend_size:,} bytes")

    # 6. Export to GLB
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
        export_lights=False,
        export_extras=True,
        export_image_format='AUTO'
    )

    glb_size = os.path.getsize(glb_output_file)
    print(f"[Pipeline] Export completed: {glb_size:,} bytes")

    # Copy to public/models as well for Three.js web serving
    shutil.copyfile(glb_output_file, glb_public_file)
    print(f"[Pipeline] Copied GLB to web public directory: {glb_public_file}")

    # 7. Gather and verify scene metrics
    print("\n" + "=" * 60)
    print("  PRODUCTION COMPUTER & ELECTRONICS LAB METRICS")
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
        "Door_Leaf_Lab",
        "Cabinet_Door_Left",
        "Cabinet_Door_Right",
        "TeacherDesk_Drawer_Lab",
        "Item_Lab_Key",
        "Switchboard_Door_Lab",
        "Terminal_Monitor_1",
        "Window_Glass_Lab_1",
        "Window_Glass_Lab_2"
    ]
    print("\nVerifying Interactive Objects:")
    for name in expected_interactive:
        obj = bpy.data.objects.get(name)
        if obj:
            print(f"  [OK] Found interactive component: '{name}' (type={obj.type}, loc={obj.location})")
        else:
            print(f"  [FAIL] Missing interactive component: '{name}'")
            sys.exit(1)

    print("\n>>> COMPUTER & ELECTRONICS LAB GENERATED SUCCESSFULLY <<<\n")

if __name__ == "__main__":
    main()
