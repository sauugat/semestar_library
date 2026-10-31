"""
Stage 4: Lighting Setup & Baking Pipeline for University Classroom.
Sets up realistic classroom lighting (troffers, window sunlight, corridor bounce),
unwraps secondary UV channel (UVMap_AO / lightmap), and bakes Ambient Occlusion
using hardware-accelerated Cycles on Apple Silicon M4.
Integrates AO directly with glTF Material Output node for Three.js r128 compatibility.
"""

import bpy
import os
import math
from mathutils import Vector

def setup_classroom_lighting():
    """Adds realistic physical lighting setup to the scene."""
    print("[Lighting] Creating physical light sources...")

    # 1. Three Fluorescent Troffer Area Lights
    troffer_z = [-2.20, 0.0, 2.20]
    for i, fz in enumerate(troffer_z, start=1):
        light_data = bpy.data.lights.new(name=f"Light_Fluorescent_{i}", type='AREA')
        light_data.energy = 45.0  # Watts
        light_data.color = (0.96, 0.97, 1.0) # 5000K daylight white
        light_data.shape = 'RECTANGLE'
        light_data.size = 1.2
        light_data.size_y = 0.2

        light_obj = bpy.data.objects.new(name=f"Light_Fluorescent_Obj_{i}", object_data=light_data)
        light_obj.location = Vector((0, 3.25, fz))
        light_obj.rotation_euler = (0, 0, 0) # Points downward (-Y in local / -Z in Blender coordinates)
        bpy.context.scene.collection.objects.link(light_obj)

    # 2. Window Sunlight through East Wall (+X = +3.8m)
    sun_data = bpy.data.lights.new(name="Light_Sun_Window", type='SUN')
    sun_data.energy = 2.5
    sun_data.color = (1.0, 0.96, 0.90) # Warm afternoon sun
    sun_data.angle = math.radians(5.0)

    sun_obj = bpy.data.objects.new(name="Light_Sun_Window_Obj", object_data=sun_data)
    # Sunlight pointing from East-South down into classroom
    sun_obj.location = Vector((6.0, 4.0, 0.0))
    sun_obj.rotation_euler = (math.radians(-35), math.radians(65), 0)
    bpy.context.scene.collection.objects.link(sun_obj)

    # 3. Window Sky Ambient Fill (Soft cool skylight)
    sky_data = bpy.data.lights.new(name="Light_Sky_Fill", type='AREA')
    sky_data.energy = 25.0
    sky_data.color = (0.80, 0.88, 1.0) # Cool blue sky bounce
    sky_data.shape = 'RECTANGLE'
    sky_data.size = 3.5
    sky_data.size_y = 1.4

    sky_obj = bpy.data.objects.new(name="Light_Sky_Fill_Obj", object_data=sky_data)
    sky_obj.location = Vector((3.9, 1.65, 0.0))
    sky_obj.rotation_euler = (0, math.radians(-90), 0)
    bpy.context.scene.collection.objects.link(sky_obj)

    # 4. Corridor Doorway Bounce Light (Warm interior hall light from West door)
    hall_data = bpy.data.lights.new(name="Light_Corridor_Bounce", type='POINT')
    hall_data.energy = 15.0
    hall_data.color = (1.0, 0.90, 0.75) # Warm hallway light
    hall_data.shadow_soft_size = 0.5

    hall_obj = bpy.data.objects.new(name="Light_Corridor_Bounce_Obj", object_data=hall_data)
    hall_obj.location = Vector((-4.2, 1.2, -2.7))
    bpy.context.scene.collection.objects.link(hall_obj)

    print("[Lighting] Physical lighting setup completed.")

def bake_ambient_occlusion_and_lightmap(output_dir, resolution=1024, samples=24):
    """
    Unwraps lightmap UV2 channel on static classroom geometry and bakes
    Ambient Occlusion using Cycles GPU on Apple Silicon M4.
    Connects the resulting AO image into the glTF Material Output node for standard GLB export.
    """
    print(f"[Baking] Configuring Cycles engine for GPU Ambient Occlusion baking (res={resolution}, samples={samples})...")
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'

    # Configure Metal GPU compute on Apple Silicon M4
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

    # Filter all static mesh objects (exclude lights and empties)
    static_meshes = [
        obj for obj in bpy.data.objects
        if obj.type == 'MESH' and not obj.name.startswith("Door_Leaf") and not "Hub" in obj.name
    ]

    print(f"[Baking] Processing {len(static_meshes)} static meshes for lightmap UV unwrapping...")

    # Create baked AO image
    ao_img = bpy.data.images.new(
        name="Classroom_Baked_AO",
        width=resolution,
        height=resolution,
        alpha=False,
        float_buffer=False
    )

    # Select and generate UVMap2 on static meshes
    bpy.ops.object.select_all(action='DESELECT')
    for obj in static_meshes:
        obj.select_set(True)
        # Ensure UVMap_AO exists
        if "UVMap_AO" not in obj.data.uv_layers:
            obj.data.uv_layers.new(name="UVMap_AO")
        obj.data.uv_layers.active = obj.data.uv_layers["UVMap_AO"]

    # Unwrap active UV layer with Smart UV Project
    if static_meshes:
        bpy.context.view_layer.objects.active = static_meshes[0]
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66.0), island_margin=0.015)
        bpy.ops.object.mode_set(mode='OBJECT')

    # Add Image Texture node pointing to ao_img into every material so Cycles bakes into it
    baked_materials = set()
    for obj in static_meshes:
        for slot in obj.material_slots:
            mat = slot.material
            if mat and mat.use_nodes and mat not in baked_materials:
                baked_materials.add(mat)
                nodes = mat.node_tree.nodes
                # Check if already present
                tex_node = nodes.get("BakeTarget_AO")
                if not tex_node:
                    tex_node = nodes.new(type="ShaderNodeTexImage")
                    tex_node.name = "BakeTarget_AO"
                    tex_node.image = ao_img
                nodes.active = tex_node

    print("[Baking] Starting hardware-accelerated Cycles AO bake...")
    bpy.ops.object.bake(type='AO')
    print("[Baking] AO bake completed!")

    # Save baked AO image to output dir
    os.makedirs(output_dir, exist_ok=True)
    ao_png_path = os.path.join(output_dir, "classroom_ao_baked.png")
    ao_img.filepath_raw = ao_png_path
    ao_img.file_format = 'PNG'
    ao_img.save()
    print(f"[Baking] Saved AO map to {ao_png_path} ({os.path.getsize(ao_png_path)} bytes)")

    # Connect baked AO into glTF Material Output node for all materials
    gltf_group = bpy.data.node_groups.get("glTF Material Output")
    for mat in baked_materials:
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        tex_node = nodes.get("BakeTarget_AO")
        if not tex_node:
            continue

        # Add glTF Material Output node if not present
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

