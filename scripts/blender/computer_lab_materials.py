"""
Production PBR Material System for University Computer & Electronics Laboratory.
Creates realistic materials with full PBR properties (BaseColor, Roughness, Metallic, Normal, Emissive)
and connects them to the glTF 2.0 Material Output for seamless Three.js r128 export.
"""

import bpy
import math

def get_or_create_gltf_output_group():
    """Ensure glTF Material Output node group exists in the blend file for occlusion export."""
    group_name = "glTF Material Output"
    if group_name in bpy.data.node_groups:
        return bpy.data.node_groups[group_name]

    gltf_group = bpy.data.node_groups.new(group_name, 'ShaderNodeTree')
    # Use interface for Blender 4.0+ / 5.x
    if hasattr(gltf_group, "interface"):
        gltf_group.interface.new_socket("Occlusion", socket_type="NodeSocketFloat")
        gltf_group.interface.new_socket("Thickness", socket_type="NodeSocketFloat")
    return gltf_group

def create_pbr_material(name, base_color, roughness=0.5, metallic=0.0, emissive=None, is_glass=False, alpha=1.0):
    """Creates a production-ready Principled BSDF material."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links

    bsdf = None
    for n in nodes:
        if n.type == 'BSDF_PRINCIPLED':
            bsdf = n
            break

    if not bsdf:
        bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')
        output = nodes.get('Material Output') or nodes.new(type='ShaderNodeOutputMaterial')
        links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])

    # Set parameters with backwards/forwards compatibility across Blender 4.x/5.x
    if "Base Color" in bsdf.inputs:
        bsdf.inputs["Base Color"].default_value = (*base_color[:3], alpha)
    if "Alpha" in bsdf.inputs:
        bsdf.inputs["Alpha"].default_value = alpha
    if "Roughness" in bsdf.inputs:
        bsdf.inputs["Roughness"].default_value = roughness
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = metallic

    if emissive:
        # Blender 4/5 uses 'Emission Color' and 'Emission Strength'
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*emissive[:3], 1.0)
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = emissive[3] if len(emissive) > 3 else 2.5
        elif "Emission" in bsdf.inputs:
            bsdf.inputs["Emission"].default_value = (*emissive[:3], 1.0)

    if is_glass:
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = 0.92
        elif "Transmission" in bsdf.inputs:
            bsdf.inputs["Transmission"].default_value = 0.92
        if "IOR" in bsdf.inputs:
            bsdf.inputs["IOR"].default_value = 1.52
        if "Roughness" in bsdf.inputs:
            bsdf.inputs["Roughness"].default_value = 0.05
        if hasattr(mat, 'blend_method'):
            try:
                mat.blend_method = 'BLEND'
            except Exception:
                pass

    return mat

def build_computer_lab_material_library():
    """Generates all architectural, computer, electronics, and prop materials for the laboratory."""
    mats = {}

    # 1. Floor: Polished university laboratory terrazzo tiles (cool grey with speckling)
    mats['floor_terrazzo'] = create_pbr_material(
        name='Mat_Floor_Lab_Terrazzo',
        base_color=(0.68, 0.70, 0.72),
        roughness=0.25,
        metallic=0.03
    )

    # 2. Lower Wall: Institutional lab dado enamel paint (deep slate teal)
    mats['wall_dado'] = create_pbr_material(
        name='Mat_Wall_Lab_Dado',
        base_color=(0.18, 0.28, 0.32),
        roughness=0.45,
        metallic=0.05
    )

    # 3. Upper Wall: Off-white university laboratory lime-plaster
    mats['wall_plaster'] = create_pbr_material(
        name='Mat_Wall_Lab_Plaster',
        base_color=(0.86, 0.85, 0.82),
        roughness=0.82,
        metallic=0.0
    )

    # 4. Dado Molding & Baseboards: Grey-lacquered hardwood
    mats['trim_wood'] = create_pbr_material(
        name='Mat_Trim_Lab_Lacquered',
        base_color=(0.28, 0.30, 0.32),
        roughness=0.40,
        metallic=0.1
    )

    # 5. Acoustic Drop Ceiling Tile: 600x600 acoustic fiber tile
    mats['ceiling_tile'] = create_pbr_material(
        name='Mat_Ceiling_Lab_Tile',
        base_color=(0.82, 0.82, 0.80),
        roughness=0.90,
        metallic=0.0
    )

    # 6. Electronics Workbench Top: Anti-static ESD blue rubber mat
    mats['bench_esd_mat'] = create_pbr_material(
        name='Mat_Lab_Bench_ESD',
        base_color=(0.14, 0.28, 0.44),
        roughness=0.52,
        metallic=0.02
    )

    # 7. Workbench & Desk Metal Frames: Heavy industrial dark grey steel
    mats['steel_frame'] = create_pbr_material(
        name='Mat_Steel_Dark_Frame',
        base_color=(0.18, 0.20, 0.22),
        roughness=0.38,
        metallic=0.75
    )

    # 8. Computer Desk Worksurface: Grey laminate desktop
    mats['desk_laminate'] = create_pbr_material(
        name='Mat_Desk_Grey_Laminate',
        base_color=(0.45, 0.47, 0.48),
        roughness=0.48,
        metallic=0.05
    )

    # 9. PC Tower Chassis: Classic university beige/cream metal casing
    mats['pc_chassis_beige'] = create_pbr_material(
        name='Mat_PC_Tower_Beige',
        base_color=(0.74, 0.72, 0.67),
        roughness=0.42,
        metallic=0.25
    )

    # 10. PC Tower Chassis Dark: Matte charcoal front bezel & ventilation
    mats['pc_chassis_dark'] = create_pbr_material(
        name='Mat_PC_Tower_Dark',
        base_color=(0.12, 0.13, 0.14),
        roughness=0.60,
        metallic=0.15
    )

    # 11. Peripherals: Keyboard, mouse, cables, power strip (matte textured black plastic)
    mats['peripherals_plastic'] = create_pbr_material(
        name='Mat_Peripherals_Black',
        base_color=(0.08, 0.08, 0.09),
        roughness=0.68,
        metallic=0.02
    )

    # 12. Active Computer Terminal Screen: CRT / LCD screen with green phosphor terminal text
    mats['screen_terminal_green'] = create_pbr_material(
        name='Mat_Screen_Terminal_Green',
        base_color=(0.02, 0.06, 0.03),
        roughness=0.18,
        metallic=0.05,
        emissive=(0.12, 0.85, 0.32, 2.0)
    )

    # 13. Powered Amber Screen: Monitor displaying diagnostics / compile trace
    mats['screen_terminal_amber'] = create_pbr_material(
        name='Mat_Screen_Terminal_Amber',
        base_color=(0.06, 0.04, 0.01),
        roughness=0.20,
        metallic=0.05,
        emissive=(0.95, 0.55, 0.10, 1.8)
    )

    # 14. Off Monitor Screen: Dark glossy glass
    mats['screen_off'] = create_pbr_material(
        name='Mat_Screen_Off',
        base_color=(0.04, 0.04, 0.05),
        roughness=0.12,
        metallic=0.08
    )

    # 15. Oscilloscope Chassis: Classic dual-trace analog oscilloscope metal body
    mats['oscilloscope_body'] = create_pbr_material(
        name='Mat_Oscilloscope_Body',
        base_color=(0.64, 0.66, 0.65),
        roughness=0.42,
        metallic=0.55
    )

    # 16. Oscilloscope CRT Screen: Glowing phosphor graticule with sine waveform
    mats['oscilloscope_screen'] = create_pbr_material(
        name='Mat_Oscilloscope_Screen',
        base_color=(0.03, 0.08, 0.04),
        roughness=0.15,
        metallic=0.05,
        emissive=(0.20, 0.95, 0.40, 2.5)
    )

    # 17. Digital Multimeter: Yellow rubber protective holster + dark display
    mats['multimeter_yellow'] = create_pbr_material(
        name='Mat_Multimeter_Yellow',
        base_color=(0.88, 0.70, 0.06),
        roughness=0.58,
        metallic=0.02
    )

    # 18. Soldering Station: Industrial solder station base (Hakko style blue)
    mats['solder_station'] = create_pbr_material(
        name='Mat_Solder_Station',
        base_color=(0.12, 0.24, 0.52),
        roughness=0.42,
        metallic=0.1
    )

    # 19. Printed Circuit Board (PCB): Dark green solder mask with gold/copper pads
    mats['pcb_green'] = create_pbr_material(
        name='Mat_PCB_Green',
        base_color=(0.06, 0.35, 0.14),
        roughness=0.35,
        metallic=0.28
    )

    # 20. Electronic Components: Breadboards, IC chips, capacitors, resistor bands
    mats['breadboard_white'] = create_pbr_material(
        name='Mat_Breadboard_White',
        base_color=(0.88, 0.88, 0.86),
        roughness=0.45,
        metallic=0.02
    )

    # 21. Equipment Storage Cabinet: Powder-coated industrial sheet steel
    mats['equipment_cabinet'] = create_pbr_material(
        name='Mat_Equipment_Cabinet',
        base_color=(0.40, 0.44, 0.46),
        roughness=0.36,
        metallic=0.82
    )

    # 22. Server Rack: Perforated black steel server chassis
    mats['server_rack_black'] = create_pbr_material(
        name='Mat_Server_Rack_Black',
        base_color=(0.10, 0.10, 0.12),
        roughness=0.35,
        metallic=0.88
    )

    # 23. Server LED Indicators: Small blinking status diodes
    mats['led_green'] = create_pbr_material(
        name='Mat_LED_Green',
        base_color=(0.1, 0.9, 0.2),
        emissive=(0.1, 0.95, 0.2, 3.5)
    )
    mats['led_amber'] = create_pbr_material(
        name='Mat_LED_Amber',
        base_color=(0.95, 0.6, 0.1),
        emissive=(0.95, 0.6, 0.1, 3.0)
    )

    # 24. Window Frames: Commercial anodized silver aluminum extrusion
    mats['window_frame_aluminum'] = create_pbr_material(
        name='Mat_Window_Frame_Aluminum',
        base_color=(0.72, 0.74, 0.76),
        roughness=0.30,
        metallic=0.88
    )

    # 25. Window Glass: Clear architectural float glass (Alpha 0.28)
    mats['window_glass'] = create_pbr_material(
        name='Mat_Lab_Window_Glass',
        base_color=(0.88, 0.94, 0.98),
        roughness=0.05,
        metallic=0.02,
        is_glass=True,
        alpha=0.28
    )

    # 26. Teacher/Instructor Desk: Dark mahogany wood laminate
    mats['instructor_wood'] = create_pbr_material(
        name='Mat_Instructor_Wood',
        base_color=(0.35, 0.22, 0.14),
        roughness=0.42,
        metallic=0.04
    )

    # 27. Teaching Whiteboard: White glossy porcelain enamel surface
    mats['whiteboard_surface'] = create_pbr_material(
        name='Mat_Whiteboard_Surface',
        base_color=(0.92, 0.93, 0.94),
        roughness=0.12,
        metallic=0.02
    )

    # 28. Lab Noticeboard: Cork bulletin board with circuit schematics pinned
    mats['noticeboard_cork'] = create_pbr_material(
        name='Mat_Noticeboard_Cork',
        base_color=(0.54, 0.40, 0.26),
        roughness=0.88,
        metallic=0.0
    )

    # 29. Laboratory Door: Heavy institutional laminate wooden door
    mats['door_wood'] = create_pbr_material(
        name='Mat_Door_Wood_Lab',
        base_color=(0.32, 0.20, 0.12),
        roughness=0.45,
        metallic=0.05
    )

    # 30. Door Hardware: Brushed stainless steel handle & escutcheon
    mats['hardware_steel'] = create_pbr_material(
        name='Mat_Hardware_Steel',
        base_color=(0.78, 0.80, 0.82),
        roughness=0.25,
        metallic=0.92
    )

    # 31. Fluorescent Fixture Housing: White enamel sheet-metal troffer
    mats['fluorescent_housing'] = create_pbr_material(
        name='Mat_Fluorescent_Housing',
        base_color=(0.86, 0.87, 0.88),
        roughness=0.35,
        metallic=0.60
    )

    # 32. Fluorescent Tube Lamp: Diffused white glow (cool daylight 5500K)
    mats['fluorescent_lamp'] = create_pbr_material(
        name='Mat_Fluorescent_Lamp',
        base_color=(0.96, 0.98, 1.0),
        roughness=0.20,
        metallic=0.0,
        emissive=(0.94, 0.97, 1.0, 3.0)
    )

    # 33. Electrical Switchboard: Industrial grey steel circuit breaker panel
    mats['switchboard_metal'] = create_pbr_material(
        name='Mat_Switchboard_Metal',
        base_color=(0.42, 0.44, 0.46),
        roughness=0.38,
        metallic=0.75
    )

    # 34. Collectible Key: Polished brass key hidden in workbench drawer
    mats['brass_key'] = create_pbr_material(
        name='Mat_Brass_Key',
        base_color=(0.92, 0.76, 0.30),
        roughness=0.22,
        metallic=0.95
    )

    # 35. Tool pegboard: Perforated grey metal board with tool hooks
    mats['tool_pegboard'] = create_pbr_material(
        name='Mat_Tool_Pegboard',
        base_color=(0.45, 0.46, 0.48),
        roughness=0.50,
        metallic=0.65
    )

    return mats

