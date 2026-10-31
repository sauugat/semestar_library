"""
Production PBR Material System for University Library.
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

    if is_glass:
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = 0.92
        elif "Transmission" in bsdf.inputs:
            bsdf.inputs["Transmission"].default_value = 0.92
        if "IOR" in bsdf.inputs:
            bsdf.inputs["IOR"].default_value = 1.52
        mat.blend_method = 'BLEND'
        if hasattr(mat, "shadow_method"):
            mat.shadow_method = 'NONE'

    if emissive:
        # emissive tuple: (r, g, b, strength)
        er, eg, eb = emissive[:3]
        strength = emissive[3] if len(emissive) > 3 else 1.0
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (er, eg, eb, 1.0)
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = strength
        elif "Emission" in bsdf.inputs:
            bsdf.inputs["Emission"].default_value = (er * strength, eg * strength, eb * strength, 1.0)

    return mat

def setup_library_materials():
    """Defines and returns the comprehensive PBR material dictionary for the University Library."""
    mats = {}

    # 1. Floor: Polished institutional terrazzo / terrazzo tiles
    mats['floor'] = create_pbr_material(
        name='Mat_Library_Floor',
        base_color=(0.82, 0.80, 0.76),
        roughness=0.28,
        metallic=0.02
    )

    # 2. Main Wall Plaster: Cream / pale off-white academic plaster
    mats['wall'] = create_pbr_material(
        name='Mat_Library_Wall',
        base_color=(0.88, 0.86, 0.81),
        roughness=0.76,
        metallic=0.0
    )

    # 3. Wall Wainscot / Dado: Lower wall protective dark teak trim
    mats['wall_dado'] = create_pbr_material(
        name='Mat_Library_Wall_Dado',
        base_color=(0.32, 0.20, 0.12),
        roughness=0.48,
        metallic=0.04
    )

    # 4. Ceiling: Acoustic drop-ceiling tiles with textured matte finish
    mats['ceiling'] = create_pbr_material(
        name='Mat_Library_Ceiling',
        base_color=(0.92, 0.91, 0.88),
        roughness=0.88,
        metallic=0.0
    )

    # 5. Drop Ceiling T-Grid: Off-white powder-coated metal runner
    mats['ceiling_grid'] = create_pbr_material(
        name='Mat_Library_Ceiling_Grid',
        base_color=(0.75, 0.75, 0.75),
        roughness=0.40,
        metallic=0.60
    )

    # 6. Wood - Polished Teak: Study tables, reception desk, study carrels
    mats['wood_teak'] = create_pbr_material(
        name='Mat_Library_Wood_Teak',
        base_color=(0.42, 0.25, 0.14),
        roughness=0.38,
        metallic=0.02
    )

    # 7. Wood - Sal Timber: Heavy structural bookshelves and frames
    mats['wood_sal'] = create_pbr_material(
        name='Mat_Library_Wood_Sal',
        base_color=(0.28, 0.17, 0.10),
        roughness=0.55,
        metallic=0.01
    )

    # 8. Wood - Plywood / Lockers: Student bag storage cubbies
    mats['wood_cubbies'] = create_pbr_material(
        name='Mat_Library_Wood_Cubbies',
        base_color=(0.52, 0.36, 0.22),
        roughness=0.52,
        metallic=0.0
    )

    # 9. Steel - Archive Filing Cabinets: Olive-grey industrial powder coat
    mats['steel_cabinet'] = create_pbr_material(
        name='Mat_Library_Steel_Cabinet',
        base_color=(0.38, 0.42, 0.39),
        roughness=0.35,
        metallic=0.82
    )

    # 10. Steel - Shelving Brackets & Chair Frames: Dark gunmetal steel
    mats['steel_dark'] = create_pbr_material(
        name='Mat_Library_Steel_Dark',
        base_color=(0.20, 0.22, 0.24),
        roughness=0.40,
        metallic=0.85
    )

    # 11. Chair Fabric: Institutional navy blue woven upholstery
    mats['chair_fabric'] = create_pbr_material(
        name='Mat_Library_Chair_Fabric',
        base_color=(0.14, 0.20, 0.32),
        roughness=0.82,
        metallic=0.0
    )

    # 12. Chair Wood: Chair backrests and armrests
    mats['chair_wood'] = create_pbr_material(
        name='Mat_Library_Chair_Wood',
        base_color=(0.38, 0.22, 0.12),
        roughness=0.45,
        metallic=0.02
    )

    # 13. Book Spine & Cover - Burgundy
    mats['book_burgundy'] = create_pbr_material(
        name='Mat_Book_Burgundy',
        base_color=(0.48, 0.08, 0.12),
        roughness=0.42,
        metallic=0.05
    )

    # 14. Book Spine & Cover - Deep Navy
    mats['book_navy'] = create_pbr_material(
        name='Mat_Book_Navy',
        base_color=(0.08, 0.16, 0.36),
        roughness=0.44,
        metallic=0.05
    )

    # 15. Book Spine & Cover - Forest Green
    mats['book_green'] = create_pbr_material(
        name='Mat_Book_Green',
        base_color=(0.10, 0.32, 0.16),
        roughness=0.45,
        metallic=0.05
    )

    # 16. Book Spine & Cover - Ochre / Terracotta
    mats['book_ochre'] = create_pbr_material(
        name='Mat_Book_Ochre',
        base_color=(0.58, 0.34, 0.12),
        roughness=0.50,
        metallic=0.02
    )

    # 17. Book Spine & Cover - Academic Black / Gold
    mats['book_black'] = create_pbr_material(
        name='Mat_Book_Black',
        base_color=(0.12, 0.12, 0.14),
        roughness=0.35,
        metallic=0.10
    )

    # 18. Book Page Block: Cream off-white edge paper
    mats['book_pages'] = create_pbr_material(
        name='Mat_Book_Pages',
        base_color=(0.88, 0.85, 0.78),
        roughness=0.85,
        metallic=0.0
    )

    # 19. Archival Document Boxes: Brown corrugated cardboard
    mats['cardboard_box'] = create_pbr_material(
        name='Mat_Library_Cardboard_Box',
        base_color=(0.60, 0.46, 0.30),
        roughness=0.78,
        metallic=0.0
    )

    # 20. Banker Lamp - Brass Stem & Base
    mats['lamp_brass'] = create_pbr_material(
        name='Mat_Library_Lamp_Brass',
        base_color=(0.85, 0.70, 0.25),
        roughness=0.24,
        metallic=0.92
    )

    # 21. Banker Lamp - Emerald Green Glass Shade (Lit)
    mats['lamp_green_glass'] = create_pbr_material(
        name='Mat_Library_Banker_Glass',
        base_color=(0.05, 0.42, 0.18),
        roughness=0.18,
        metallic=0.05,
        emissive=(0.12, 0.85, 0.32, 1.8),
        is_glass=True
    )

    # 22. Banker Lamp - Warm Interior Bulb Glow
    mats['lamp_bulb_warm'] = create_pbr_material(
        name='Mat_Library_Bulb_Warm',
        base_color=(1.0, 0.88, 0.65),
        roughness=0.15,
        metallic=0.0,
        emissive=(1.0, 0.82, 0.50, 4.0)
    )

    # 23. Window Glass: Transparent architectural glass
    mats['window_glass'] = create_pbr_material(
        name='Mat_Library_Window_Glass',
        base_color=(0.82, 0.90, 0.96),
        roughness=0.04,
        metallic=0.1,
        is_glass=True,
        alpha=0.25
    )

    # 24. Window Frames: Dark bronze anodized aluminum
    mats['window_frame'] = create_pbr_material(
        name='Mat_Library_Window_Frame',
        base_color=(0.22, 0.20, 0.18),
        roughness=0.35,
        metallic=0.80
    )

    # 25. Door Wood: Polished solid teak door
    mats['door_wood'] = create_pbr_material(
        name='Mat_Library_Door_Wood',
        base_color=(0.36, 0.22, 0.12),
        roughness=0.40,
        metallic=0.02
    )

    # 26. Hardware: Polished brass door handle & escutcheon
    mats['hardware_brass'] = create_pbr_material(
        name='Mat_Library_Hardware_Brass',
        base_color=(0.88, 0.74, 0.28),
        roughness=0.22,
        metallic=0.94
    )

    # 27. Fluorescent Fixture Housing: Off-white troffer metal
    mats['fluorescent_housing'] = create_pbr_material(
        name='Mat_Library_Fluorescent_Housing',
        base_color=(0.86, 0.87, 0.88),
        roughness=0.35,
        metallic=0.60
    )

    # 28. Fluorescent Tube Lamp: Diffused warm white glow (4000K neutral)
    mats['fluorescent_tube'] = create_pbr_material(
        name='Mat_Library_Fluorescent_Tube',
        base_color=(0.98, 0.96, 0.92),
        roughness=0.20,
        metallic=0.0,
        emissive=(0.98, 0.95, 0.90, 3.2)
    )

    # 29. Fluorescent Tube - Dim / Horror corner
    mats['fluorescent_tube_dim'] = create_pbr_material(
        name='Mat_Library_Fluorescent_Tube_Dim',
        base_color=(0.60, 0.58, 0.54),
        roughness=0.30,
        metallic=0.0,
        emissive=(0.70, 0.65, 0.58, 0.8)
    )

    # 30. Noticeboard: Cork pinboard with paper documents
    mats['noticeboard'] = create_pbr_material(
        name='Mat_Library_Noticeboard',
        base_color=(0.68, 0.54, 0.38),
        roughness=0.82,
        metallic=0.0
    )

    # 31. Noticeboard Papers: White / tinted notices
    mats['notice_paper'] = create_pbr_material(
        name='Mat_Library_Notice_Paper',
        base_color=(0.92, 0.90, 0.84),
        roughness=0.88,
        metallic=0.0
    )

    # 32. Librarian Workstation - CRT/LCD Monitor Casing (Beige 90s institutional)
    mats['monitor_casing'] = create_pbr_material(
        name='Mat_Library_Monitor_Casing',
        base_color=(0.72, 0.70, 0.65),
        roughness=0.48,
        metallic=0.05
    )

    # 33. Librarian Workstation - Monitor Screen (Soft green terminal text)
    mats['monitor_screen'] = create_pbr_material(
        name='Mat_Library_Monitor_Screen',
        base_color=(0.04, 0.12, 0.06),
        roughness=0.20,
        metallic=0.10,
        emissive=(0.15, 0.85, 0.25, 2.2)
    )

    # 34. Electrical Switchboard Panel
    mats['switchboard_metal'] = create_pbr_material(
        name='Mat_Library_Switchboard_Metal',
        base_color=(0.40, 0.42, 0.44),
        roughness=0.38,
        metallic=0.78
    )

    # 35. Tihar Clay Diyo: Terracotta clay lamp
    mats['diyo_clay'] = create_pbr_material(
        name='Mat_Library_Diyo_Clay',
        base_color=(0.62, 0.30, 0.16),
        roughness=0.68,
        metallic=0.02
    )

    # 36. Tihar Diyo Flame: Golden mustard flame (2000K)
    mats['diyo_flame'] = create_pbr_material(
        name='Mat_Library_Diyo_Flame',
        base_color=(1.0, 0.65, 0.15),
        roughness=0.10,
        metallic=0.0,
        emissive=(1.0, 0.60, 0.10, 5.0)
    )

    # 37. Tihar Sayapatri (Marigold) Garland: Vibrant festive orange
    mats['garland_marigold'] = create_pbr_material(
        name='Mat_Library_Garland_Marigold',
        base_color=(0.95, 0.48, 0.05),
        roughness=0.72,
        metallic=0.0
    )

    # 38. Structural Concrete Pillars
    mats['pillar_concrete'] = create_pbr_material(
        name='Mat_Library_Pillar_Concrete',
        base_color=(0.84, 0.83, 0.80),
        roughness=0.72,
        metallic=0.0
    )

    return mats

