"""
Production PBR Material System for University Classroom.
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
        # Set blend method for viewport / EEVEE
        if hasattr(mat, 'blend_method'):
            try:
                mat.blend_method = 'BLEND'
            except Exception:
                pass

    return mat

def build_classroom_material_library():
    """Generates all architectural, furniture, and prop materials for the university classroom."""
    mats = {}

    # 1. Floor: Polished university terrazzo tiles (warm light grey-beige with subtle speckles)
    mats['floor_terrazzo'] = create_pbr_material(
        name='Mat_Floor_Terrazzo',
        base_color=(0.74, 0.72, 0.69),
        roughness=0.28,
        metallic=0.04
    )

    # 2. Lower Wall: Institutional Dado paint (calming heritage sage/slate green)
    mats['wall_dado'] = create_pbr_material(
        name='Mat_Wall_Dado',
        base_color=(0.28, 0.38, 0.34),
        roughness=0.45,
        metallic=0.0
    )

    # 3. Upper Wall: Off-white clean plaster
    mats['wall_plaster'] = create_pbr_material(
        name='Mat_Wall_Plaster',
        base_color=(0.88, 0.87, 0.84),
        roughness=0.75,
        metallic=0.0
    )

    # 4. Ceiling: Stippled acoustic ceiling tiles (light grey-cream)
    mats['ceiling_tile'] = create_pbr_material(
        name='Mat_Ceiling_Tile',
        base_color=(0.84, 0.83, 0.81),
        roughness=0.85,
        metallic=0.02
    )

    # 5. Trim / Molding: Semi-gloss crisp architectural molding
    mats['trim_wood'] = create_pbr_material(
        name='Mat_Trim_Molding',
        base_color=(0.92, 0.91, 0.89),
        roughness=0.35,
        metallic=0.0
    )

    # 6. Teak Wood: Golden-brown varnished timber for desks and podium
    mats['wood_varnish'] = create_pbr_material(
        name='Mat_Wood_Varnish',
        base_color=(0.42, 0.24, 0.12),
        roughness=0.38,
        metallic=0.02
    )

    # 7. Light Wood: Laminated student desk tops
    mats['wood_desk_top'] = create_pbr_material(
        name='Mat_Wood_DeskTop',
        base_color=(0.58, 0.41, 0.26),
        roughness=0.40,
        metallic=0.0
    )

    # 8. Dark Powder-Coated Tubular Steel: Legs and metal frames
    mats['steel_frame'] = create_pbr_material(
        name='Mat_Steel_Dark',
        base_color=(0.14, 0.15, 0.16),
        roughness=0.32,
        metallic=0.75
    )

    # 9. Brushed Aluminum: Whiteboard frame, window frames, door handles
    mats['aluminum_brushed'] = create_pbr_material(
        name='Mat_Aluminum_Brushed',
        base_color=(0.78, 0.80, 0.82),
        roughness=0.25,
        metallic=0.90
    )

    # 10. Whiteboard Surface: Glossy dry-erase enamel
    mats['whiteboard_surface'] = create_pbr_material(
        name='Mat_Whiteboard_Surface',
        base_color=(0.96, 0.96, 0.96),
        roughness=0.12,
        metallic=0.05
    )

    # 11. Chalkboard Section: Matte dark blackboard green
    mats['chalkboard_surface'] = create_pbr_material(
        name='Mat_Chalkboard_Surface',
        base_color=(0.08, 0.16, 0.12),
        roughness=0.88,
        metallic=0.0
    )

    # 12. Bulletin Cork / Felt: University noticeboard felt
    mats['noticeboard_felt'] = create_pbr_material(
        name='Mat_Noticeboard_Felt',
        base_color=(0.18, 0.35, 0.22),
        roughness=0.90,
        metallic=0.0
    )

    # 13. Paper Notes: Pinned notice sheets
    mats['paper_sheet'] = create_pbr_material(
        name='Mat_Paper_Sheet',
        base_color=(0.95, 0.94, 0.91),
        roughness=0.70,
        metallic=0.0
    )

    # 14. Fluorescent Tube Lamp: Emissive daylight phosphor (5000K)
    mats['fluorescent_emissive'] = create_pbr_material(
        name='Mat_Fluorescent_Tube',
        base_color=(1.0, 0.98, 0.95),
        roughness=0.2,
        metallic=0.0,
        emissive=(1.0, 0.97, 0.92, 3.5)
    )

    # 15. Fluorescent Housing: Off-white powder coated sheet metal
    mats['light_fixture_housing'] = create_pbr_material(
        name='Mat_LightFixture_Housing',
        base_color=(0.85, 0.86, 0.87),
        roughness=0.30,
        metallic=0.60
    )

    # 16. Window Glass: Clear architectural glass
    mats['window_glass'] = create_pbr_material(
        name='Mat_Window_Glass',
        base_color=(0.92, 0.95, 0.98),
        roughness=0.05,
        is_glass=True,
        alpha=0.25
    )

    # 17. Clock Face & Numerals
    mats['clock_dial'] = create_pbr_material(
        name='Mat_Clock_Dial',
        base_color=(0.98, 0.97, 0.95),
        roughness=0.25,
        metallic=0.0
    )
    mats['clock_hands'] = create_pbr_material(
        name='Mat_Clock_Hands',
        base_color=(0.05, 0.05, 0.05),
        roughness=0.30,
        metallic=0.85
    )

    # 18. Switchboard Panel: Industrial grey enamel & red/green breakers
    mats['switchboard_metal'] = create_pbr_material(
        name='Mat_Switchboard_Metal',
        base_color=(0.60, 0.62, 0.64),
        roughness=0.35,
        metallic=0.65
    )
    mats['breaker_red'] = create_pbr_material(
        name='Mat_Breaker_Red',
        base_color=(0.82, 0.12, 0.10),
        roughness=0.35,
        metallic=0.1
    )
    mats['breaker_black'] = create_pbr_material(
        name='Mat_Breaker_Black',
        base_color=(0.10, 0.10, 0.10),
        roughness=0.40,
        metallic=0.2
    )

    # 19. Dustbin: Perforated metal / midnight blue polypropylene
    mats['dustbin_body'] = create_pbr_material(
        name='Mat_Dustbin_Body',
        base_color=(0.15, 0.20, 0.25),
        roughness=0.42,
        metallic=0.30
    )

    # 20. Brass Key: Polished brass
    mats['brass_key'] = create_pbr_material(
        name='Mat_Brass_Key',
        base_color=(0.88, 0.72, 0.28),
        roughness=0.22,
        metallic=0.92
    )

    # 21. Fabric Backpacks: Student bags
    mats['backpack_navy'] = create_pbr_material(
        name='Mat_Backpack_Navy',
        base_color=(0.12, 0.18, 0.32),
        roughness=0.80,
        metallic=0.05
    )
    mats['backpack_maroon'] = create_pbr_material(
        name='Mat_Backpack_Maroon',
        base_color=(0.38, 0.10, 0.14),
        roughness=0.80,
        metallic=0.05
    )

    # 22. Dais Platform: Concrete / dark plinth border
    mats['dais_concrete'] = create_pbr_material(
        name='Mat_Dais_Concrete',
        base_color=(0.55, 0.54, 0.52),
        roughness=0.60,
        metallic=0.05
    )

    return mats
