"""
Lighting Setup & Cycles GPU Baking Pipeline for University Computer & Electronics Laboratory.
Sets up realistic laboratory lighting (fluorescent troffers, window fill, corridor bounce, terminal phosphor),
unwraps secondary UV channel (UVMap_AO / lightmap), and bakes Ambient Occlusion
using hardware-accelerated Cycles on Apple Silicon M4.
Integrates AO directly with glTF Material Output node for Three.js r128 compatibility.
"""

import bpy
import os
import math
from mathutils import Vector

def setup_computer_lab_lighting():
    """Adds realistic physical lighting setup to the scene for baking and viewport rendering."""
    print("[Lighting] Creating physical light sources for Computer & Electronics Lab...")

    # 1. Six Fluorescent Troffer Area Lights in a 2x3 grid
    x_coords = [-1.50, 1.50]
    y_coords = [2.00, 0.00, -2.00]

    light_idx = 1
    for fx in x_coords:
        for fy in y_coords:
            light_data = bpy.data.lights.new(name=f"Light_Lab_Fluorescent_{light_idx}", type='AREA')
            # Dying/dimmer tube in back corner (horror atmosphere)
            if light_idx == 6:
                light_data.energy = 15.0  # Faint flickering corner
                light_data.color = (0.85, 0.88, 0.92)
            else:
                light_data.energy = 40.0  # Watts
                light_data.color = (0.95, 0.97, 1.0) # 5500K daylight white
            light_data.shape = 'RECTANGLE'
            light_data.size = 1.2
            light_data.size_y = 0.25

            light_obj = bpy.data.objects.new(name=f"Light_Lab_Fluorescent_Obj_{light_idx}", object_data=light_data)
            light_obj.location = Vector((fx, fy, 3.25))
            light_obj.rotation_euler = (0, 0, 0)
            bpy.context.scene.collection.objects.link(light_obj)
            light_idx += 1

    # 2. Window Exterior Fill through East Wall (+X = +3.8m)
    sky_data = bpy.data.lights.new(name="Light_Lab_Sky_Fill", type='AREA')
    sky_data.energy = 22.0
    sky_data.color = (0.75, 0.84, 0.98) # Atmospheric cool ambient
    sky_data.shape = 'RECTANGLE'
    sky_data.size = 4.0
    sky_data.size_y = 1.5

    sky_obj = bpy.data.objects.new(name="Light_Lab_Sky_Fill_Obj", object_data=sky_data)
    sky_obj.location = Vector((4.0, 0.0, 1.65))
    sky_obj.rotation_euler = (0, math.radians(-90), 0)
    bpy.context.scene.collection.objects.link(sky_obj)

    # 3. Corridor Doorway Bounce Light (West door at X = -3.8m, Y = 0.0m)
    hall_data = bpy.data.lights.new(name="Light_Lab_Corridor_Bounce", type='POINT')
    hall_data.energy = 14.0
    hall_data.color = (1.0, 0.92, 0.78) # Warm corridor bounce
    hall_data.shadow_soft_size = 0.5

    hall_obj = bpy.data.objects.new(name="Light_Lab_Corridor_Bounce_Obj", object_data=hall_data)
    hall_obj.location = Vector((-4.2, 0.0, 1.20))
    bpy.context.scene.collection.objects.link(hall_obj)

    # 4. Faint Green Phosphor Terminal Screen Glow (Station 1 at X = -1.6, Y = 1.2)
    crt_data = bpy.data.lights.new(name="Light_Lab_Terminal_Glow", type='POINT')
    crt_data.energy = 3.5
    crt_data.color = (0.2, 0.95, 0.35)
    crt_data.shadow_soft_size = 0.2

    crt_obj = bpy.data.objects.new(name="Light_Lab_Terminal_Glow_Obj", object_data=crt_data)
    crt_obj.location = Vector((-1.4, 1.20, 0.95))
    bpy.context.scene.collection.objects.link(crt_obj)

    print("[Lighting] Physical lighting setup completed.")

def bake_ambient_occlusion_and_lightmap(output_dir, resolution=1024, samples=24):
    """
    Unwraps lightmap UV2 channel on static laboratory geometry and bakes
    Ambient Occlusion using Cycles GPU on Apple Silicon M4.
    Connects the resulting AO image into the glTF Material Output node for standard GLB export.
    """
    print(f"[Baking] Configuring Cycles engine for GPU Ambient Occlusion baking (res={resolution}, samples={samples})...")
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'

    cprefs = bpy.context.preferences.addons.get('cycles')
    if cprefs:
        cprefs.preferences.compute_device_type = 'METAL'
        cprefs.preferences.get_devices()
        for d in cprefs.preferences.devices:
            if d.type == 'METAL':
                d.use = True
        scene.cycles.device = 'GPU'

    scene.cycles.samples = samples
    scene.cycles.bake_type = 'AO'

    protected_prefixes = (
        "Door_Leaf", "Cabinet_Door", "TeacherDesk_Drawer", "Switchboard_Door",
        "Item_Lab", "Terminal_Monitor", "Oscilloscope_Screen", "Window_Glass"
    )

    static_meshes = [
        obj for obj in bpy.data.objects
        if obj.type == 'MESH' and not any(obj.name.startswith(p) for p in protected_prefixes)
    ]

    print(f"[Baking] Processing {len(static_meshes)} static meshes for lightmap UV unwrapping...")

    ao_img = bpy.data.images.new(
        name="Lab_Baked_AO",
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

    print("[Baking] Starting hardware-accelerated Cycles AO bake...")
    bpy.ops.object.bake(type='AO')
    print("[Baking] AO bake completed!")

    os.makedirs(output_dir, exist_ok=True)
    ao_png_path = os.path.join(output_dir, "computer_lab_ao_baked.png")
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

    print("[Baking] Ambient Occlusion connected to glTF Material Output successfully.")
    return ao_png_path
