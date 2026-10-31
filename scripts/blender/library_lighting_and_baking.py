"""
Lighting Setup & Cycles GPU Baking Pipeline for University Library.
Sets up realistic interior lighting (fluorescent troffers, reception warm lamp,
diyo flame, archive fixture, exterior window fill), unwraps lightmap UVs (UVMap_AO),
and bakes Ambient Occlusion for Three.js r128 PBR rendering.
"""

import bpy
import os
import math
from mathutils import Vector

def setup_library_lighting():
    """Adds realistic physical lighting setup to the scene for baking and viewport rendering."""
    print("[Lighting] Creating physical light sources for University Library...")

    # 1. Troffer Area Lights in Main Reading Hall and Aisle (4000K Neutral White)
    troffer_lights = [
        ("Light_Troffer_Rec_W", -2.00, -7.50, 3.35, 35.0, (0.98, 0.95, 0.90)),
        ("Light_Troffer_Rec_E",  2.00, -7.50, 3.35, 35.0, (0.98, 0.95, 0.90)),
        ("Light_Troffer_Read_W", -2.00, -1.50, 3.35, 40.0, (0.98, 0.96, 0.92)),
        ("Light_Troffer_Read_E",  2.00, -1.50, 3.35, 40.0, (0.98, 0.96, 0.92)),
        ("Light_Troffer_Shelf_W", -2.00,  4.50, 3.35, 30.0, (0.96, 0.94, 0.90)),
        ("Light_Troffer_Shelf_E",  2.00,  4.50, 3.35, 12.0, (0.85, 0.88, 0.92)), # Dim / flicker
    ]

    for name, lx, ly, lz, energy, color in troffer_lights:
        ldata = bpy.data.lights.new(name=name, type='AREA')
        ldata.energy = energy
        ldata.color = color
        ldata.shape = 'RECTANGLE'
        ldata.size = 1.20
        ldata.size_y = 0.35

        lobj = bpy.data.objects.new(name=f"{name}_Obj", object_data=ldata)
        lobj.location = Vector((lx, ly, lz))
        lobj.rotation_euler = (0, 0, 0)
        bpy.context.scene.collection.objects.link(lobj)

    # 2. Archive Room Dim Area Light (Deep shadow, horror mood)
    arch_data = bpy.data.lights.new(name="Light_Archive_Overhead", type='AREA')
    arch_data.energy = 10.0
    arch_data.color = (0.75, 0.80, 0.88)
    arch_data.shape = 'RECTANGLE'
    arch_data.size = 1.00
    arch_data.size_y = 0.30

    arch_obj = bpy.data.objects.new(name="Light_Archive_Overhead_Obj", object_data=arch_data)
    arch_obj.location = Vector((0.0, 8.50, 3.35))
    bpy.context.scene.collection.objects.link(arch_obj)

    # 3. Reception Warm Desk Lamp & Diyo Point Light (2200K Warm Golden)
    diyo_data = bpy.data.lights.new(name="Light_Diyo_Reception", type='POINT')
    diyo_data.energy = 8.0
    diyo_data.color = (1.0, 0.62, 0.15)
    diyo_data.shadow_soft_size = 0.15

    diyo_obj = bpy.data.objects.new(name="Light_Diyo_Reception_Obj", object_data=diyo_data)
    diyo_obj.location = Vector((-2.20, -6.50, 1.25))
    bpy.context.scene.collection.objects.link(diyo_obj)

    # 4. Banker Desk Lamp Point Light (Table 1)
    banker_data = bpy.data.lights.new(name="Light_Banker_Lamp_1", type='POINT')
    banker_data.energy = 12.0
    banker_data.color = (1.0, 0.85, 0.55)
    banker_data.shadow_soft_size = 0.20

    banker_obj = bpy.data.objects.new(name="Light_Banker_Lamp_1_Obj", object_data=banker_data)
    banker_obj.location = Vector((-2.20, -2.20, 1.00))
    bpy.context.scene.collection.objects.link(banker_obj)

    # 5. Exterior Window Atmospheric Night Sky Fill
    sky_data = bpy.data.lights.new(name="Light_Library_Sky_Fill", type='AREA')
    sky_data.energy = 18.0
    sky_data.color = (0.55, 0.68, 0.92) # Night moonlight
    sky_data.shape = 'RECTANGLE'
    sky_data.size = 8.0
    sky_data.size_y = 2.0

    sky_obj = bpy.data.objects.new(name="Light_Library_Sky_Fill_Obj", object_data=sky_data)
    sky_obj.location = Vector((4.8, 0.0, 1.80))
    sky_obj.rotation_euler = (0, math.radians(-90), 0)
    bpy.context.scene.collection.objects.link(sky_obj)

    print("[Lighting] Physical lighting setup completed.")

def bake_ambient_occlusion_and_lightmap(output_dir, resolution=1024, samples=16):
    """
    Unwraps lightmap UV2 channel on static library geometry and bakes
    Ambient Occlusion using Cycles GPU on Apple Silicon Metal (with CPU fallback).
    Connects the resulting AO image into the glTF Material Output node for standard GLB export.
    """
    print(f"[Baking] Configuring Cycles engine for AO baking (res={resolution}, samples={samples})...")
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'

    # Try setting up Apple Silicon GPU Metal acceleration
    cprefs = bpy.context.preferences.addons.get('cycles')
    if cprefs:
        try:
            cprefs.preferences.compute_device_type = 'METAL'
            cprefs.preferences.get_devices()
            has_metal = False
            for d in cprefs.preferences.devices:
                if d.type == 'METAL':
                    d.use = True
                    has_metal = True
            if has_metal:
                scene.cycles.device = 'GPU'
                print("[Baking] Using Apple Silicon Metal GPU acceleration.")
            else:
                scene.cycles.device = 'CPU'
                print("[Baking] Metal device not found, falling back to CPU.")
        except Exception as e:
            print(f"[Baking] Note on GPU device setup: {e}, falling back to CPU.")
            scene.cycles.device = 'CPU'

    scene.cycles.samples = samples
    scene.cycles.bake_type = 'AO'

    protected_prefixes = (
        "Door_Leaf", "Door_Handle", "Reception_Desk_Drawer", "Item_Library_Key",
        "Bookshelf_Interaction", "Filing_Cabinet_Drawer", "Archive_Cabinet_Door",
        "Librarian_Monitor", "Desk_Lamp_Banker", "Library_Switchboard", "Interior_Light_Switch",
        "Library_Window_Glass"
    )

    static_meshes = [
        obj for obj in bpy.data.objects
        if obj.type == 'MESH' and not any(obj.name.startswith(p) for p in protected_prefixes)
    ]

    print(f"[Baking] Processing {len(static_meshes)} static meshes for lightmap UV unwrapping...")

    ao_img = bpy.data.images.new(
        name="Library_Baked_AO",
        width=resolution,
        height=resolution,
        alpha=False,
        float_buffer=False
    )

    bpy.ops.object.select_all(action='DESELECT')
    for obj in static_meshes:
        obj.select_set(True)
        if "UVMap_AO" not in obj.data.uv_layers:
            obj.data.uv_layers.new(name="UVMap_AO")
        obj.data.uv_layers.active = obj.data.uv_layers["UVMap_AO"]

    if static_meshes:
        bpy.context.view_layer.objects.active = static_meshes[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.015)
        bpy.ops.object.mode_set(mode='OBJECT')

    baked_materials = set()
    for obj in static_meshes:
        for slot in obj.material_slots:
            mat = slot.material
            if mat and mat.use_nodes and mat not in baked_materials:
                baked_materials.add(mat)
                nodes = mat.node_tree.nodes
                tex_node = nodes.get("BakeTarget_AO")
                if not tex_node:
                    tex_node = nodes.new(type="ShaderNodeTexImage")
                    tex_node.name = "BakeTarget_AO"
                    tex_node.image = ao_img
                nodes.active = tex_node

    print("[Baking] Starting Cycles AO bake...")
    try:
        bpy.ops.object.bake(type='AO')
        print("[Baking] AO bake completed successfully!")

        os.makedirs(output_dir, exist_ok=True)
        ao_png_path = os.path.join(output_dir, "library_ao_baked.png")
        ao_img.filepath_raw = ao_png_path
        ao_img.file_format = 'PNG'
        ao_img.save()
        print(f"[Baking] Saved AO map to {ao_png_path} ({os.path.getsize(ao_png_path)} bytes)")

        gltf_group = bpy.data.node_groups.get("glTF Material Output")
        for mat in baked_materials:
            nodes = mat.node_tree.nodes
            links = mat.node_tree.links
            tex_node = nodes.get("BakeTarget_AO")
            if not tex_node:
                continue

            gltf_node = None
            for n in nodes:
                if n.type == 'GROUP' and n.node_tree and n.node_tree.name == "glTF Material Output":
                    gltf_node = n
                    break
            if not gltf_node and gltf_group:
                gltf_node = nodes.new(type='ShaderNodeGroup')
                gltf_node.node_tree = gltf_group
                gltf_node.location = (300, -200)

            if gltf_node and "Occlusion" in gltf_node.inputs:
                links.new(tex_node.outputs['Color'], gltf_node.inputs['Occlusion'])

        print("[Baking] Ambient Occlusion connected to glTF Material Output.")
        return ao_png_path
    except Exception as bake_err:
        print(f"[Baking] Notice: AO baking step had notice: {bake_err}. Proceeding with PBR shading.")
        return None

