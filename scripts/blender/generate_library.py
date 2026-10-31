"""
Master Production Generator for University Library 3D Asset.
Assembles PBR materials, generates architectural and interior geometry,
sets up lighting, optimizes static geometry by material,
saves the master .blend file, and exports production .glb for Three.js r128.
"""

import bpy
import os
import sys
import shutil

# Ensure local script directory is on sys.path
script_dir = os.path.dirname(os.path.realpath(__file__))
if script_dir not in sys.path:
    sys.path.insert(0, script_dir)

from library_materials import setup_library_materials, get_or_create_gltf_output_group
from library_builder import build_university_library_scene
from library_lighting_and_baking import setup_library_lighting, bake_ambient_occlusion_and_lightmap

def clear_default_scene():
    """Removes all default objects, collections, and materials from the scene."""
    print("[Pipeline] Clearing default scene objects...")
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)

    for col in bpy.data.collections:
        bpy.data.collections.remove(col)

    for mesh in bpy.data.meshes:
        bpy.data.meshes.remove(mesh)

    for mat in bpy.data.materials:
        bpy.data.materials.remove(mat)

def optimize_static_meshes(root_group):
    """
    Optimizes static library geometry by joining non-interactive meshes by material.
    Preserves all interactive objects, dynamic lights, and transparent glass meshes.
    Dramatically reduces Three.js draw calls and node traversal overhead.
    """
    interactive_names = {
        'Door_Library_Entrance_Pivot', 'Door_Frame_Library_Entrance',
        'Door_Leaf_Library_Entrance', 'Door_Handle_Entrance_In', 'Door_Handle_Entrance_Out',
        'Reception_Desk_Drawer', 'Reception_Drawer_Handle', 'Item_Library_Key',
        'Librarian_Monitor', 'Librarian_Monitor_Casing',
        'Bookshelf_Interaction', 'Bookshelf_Interaction_Trim',
        'Door_Archive_Pivot', 'Door_Frame_Archive',
        'Door_Leaf_Archive', 'Door_Handle_Archive_In', 'Door_Handle_Archive_Out',
        'Filing_Cabinet_Drawer', 'Filing_Cabinet_Drawer_Handle',
        'Archive_Cabinet_Door_Pivot', 'Archive_Cabinet_Door', 'Archive_Cabinet_Handle',
        'Desk_Lamp_Banker_1', 'Desk_Lamp_Banker_1_Bulb', 'Desk_Lamp_Banker_1_Base', 'Desk_Lamp_Banker_1_Stem',
        'Desk_Lamp_Banker_2', 'Desk_Lamp_Banker_2_Base', 'Desk_Lamp_Banker_2_Stem',
        'Library_Switchboard', 'Interior_Light_Switch',
        'Library_Window_Glass_East_0', 'Library_Window_Glass_East_1', 'Library_Window_Glass_East_2',
        'Diyo_Reception_Flame', 'Garland_Reception_Desk'
    }

    def is_protected(obj):
        if obj.name in interactive_names:
            return True
        if obj.name.startswith('Fluorescent_Tube') or obj.name.startswith('Archive_Fluorescent'):
            return True
        curr = obj.parent
        while curr:
            if curr.name in interactive_names:
                return True
            curr = curr.parent
        return False

    mesh_objs = [o for o in bpy.data.objects if o.type == 'MESH']
    static = [o for o in mesh_objs if not is_protected(o)]

    print(f"[Optimizer] Total meshes: {len(mesh_objs)}, Protected interactive: {len(mesh_objs) - len(static)}, Static to merge: {len(static)}")

    # Step 1: Unparent all static meshes and apply world transforms
    for o in static:
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # Step 2: Group static meshes by primary material
    mat_groups = {}
    for o in static:
        mat_name = o.data.materials[0].name if o.data.materials else "NoMat"
        mat_groups.setdefault(mat_name, []).append(o)

    print(f"[Optimizer] Joining static meshes across {len(mat_groups)} material groups...")
    for mat_name, objs in mat_groups.items():
        if len(objs) <= 1:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        joined_obj = bpy.context.active_object
        joined_obj.name = f"Static_Library_{mat_name.replace('Mat_Library_', '').replace('Mat_', '')}"
        joined_obj.parent = root_group

    print("[Optimizer] Static mesh merging completed.")

def main():
    print("=" * 60)
    print("  PRODUCTION UNIVERSITY LIBRARY GENERATION PIPELINE")
    print("=" * 60)

    output_dir = os.path.join(script_dir, "output")
    os.makedirs(output_dir, exist_ok=True)

    blend_output_file = os.path.join(output_dir, "library_production.blend")
    glb_output_file = os.path.join(output_dir, "library_production.glb")
    public_models_dir = os.path.abspath(os.path.join(script_dir, "../../public/models"))
    os.makedirs(public_models_dir, exist_ok=True)
    glb_public_file = os.path.join(public_models_dir, "library_production.glb")

    # 1. Clear scene
    clear_default_scene()

    # 2. Setup PBR materials
    get_or_create_gltf_output_group()
    mats = setup_library_materials()

    # 3. Build geometry
    root_group = build_university_library_scene(mats)

    # 4. Setup physical lighting & bake AO
    setup_library_lighting()
    bake_ambient_occlusion_and_lightmap(output_dir, resolution=1024, samples=16)

    # 5. Optimize static meshes
    optimize_static_meshes(root_group)

    # 6. Save master Blender file
    print(f"[Pipeline] Saving master Blender file to {blend_output_file}...")
    bpy.ops.wm.save_as_mainfile(filepath=blend_output_file)
    blend_size = os.path.getsize(blend_output_file)
    print(f"[Pipeline] Saved .blend ({blend_size:,} bytes)")

    # 7. Export binary glTF (.glb)
    print(f"[Pipeline] Exporting production .glb to {glb_output_file}...")
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
        export_cameras=False,
        export_extras=True,
        export_image_format='AUTO'
    )

    glb_size = os.path.getsize(glb_output_file)
    print(f"[Pipeline] Export completed: {glb_size:,} bytes ({glb_size / 1024:.1f} KB)")

    # Copy to public/models
    shutil.copyfile(glb_output_file, glb_public_file)
    print(f"[Pipeline] Copied GLB to web public directory: {glb_public_file}")

    # 8. Print scene metrics and verify interactive objects
    print("\n" + "=" * 60)
    print("  PRODUCTION UNIVERSITY LIBRARY METRICS")
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
    print(f".blend File Size:  {blend_size:,} bytes ({blend_size / (1024*1024):.2f} MB)")
    print(f".glb File Size:    {glb_size:,} bytes ({glb_size / 1024:.1f} KB)")

    expected_interactive = [
        "Door_Leaf_Library_Entrance",
        "Reception_Desk_Drawer",
        "Item_Library_Key",
        "Librarian_Monitor",
        "Bookshelf_Interaction",
        "Door_Leaf_Archive",
        "Filing_Cabinet_Drawer",
        "Archive_Cabinet_Door",
        "Desk_Lamp_Banker_1",
        "Desk_Lamp_Banker_2",
        "Library_Switchboard",
        "Interior_Light_Switch"
    ]
    print("\nVerifying Interactive Objects:")
    for name in expected_interactive:
        obj = bpy.data.objects.get(name)
        if obj:
            print(f"  [OK] Found interactive component: '{name}' (type={obj.type}, loc={obj.location})")
        else:
            print(f"  [FAIL] Missing interactive component: '{name}'")
            sys.exit(1)

    print("\n>>> UNIVERSITY LIBRARY GENERATED SUCCESSFULLY <<<\n")

if __name__ == "__main__":
    main()

