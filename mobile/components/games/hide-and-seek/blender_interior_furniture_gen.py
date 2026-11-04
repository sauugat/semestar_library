"""
Blender 3D Interior Furniture & Fixture Generator for Gandaki University Hide-and-Seek
Run from macOS Terminal with:
  /Applications/Blender.app/Contents/MacOS/Blender --background --python mobile/components/games/hide-and-seek/blender_interior_furniture_gen.py
Exports grounded (z=0.000m floor contact), beveled production-ready .glb models into mobile/assets/models/interiors/
"""
import os
import bpy
import bmesh

OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../assets/models/interiors"))
os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_pbr_mat(name, base_rgb, roughness=0.55, metallic=0.0, emission_rgb=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*base_rgb, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if emission_rgb and "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*emission_rgb, 1.0)
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def add_beveled_box(name, size, loc, mat, bevel_width=0.006):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bev = obj.modifiers.new(name="Bevel", type="BEVEL")
    bev.width = bevel_width
    bev.segments = 2
    bpy.ops.object.modifier_apply(modifier=bev.name)
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)
    return obj


def build_executive_office_desk_glb():
    """Builds a grounded Executive Office Desk (bottom at Z=0.000m in Blender -> Y=0.000m in glTF)."""
    clear_scene()
    wood_mat = make_pbr_mat("TeakWood", (0.36, 0.21, 0.11), roughness=0.42)
    steel_mat = make_pbr_mat("BrushedSteel", (0.22, 0.24, 0.27), roughness=0.35, metallic=0.85)
    screen_mat = make_pbr_mat("MonitorGlow", (0.08, 0.22, 0.32), roughness=0.18, emission_rgb=(0.18, 0.65, 0.92), emission_strength=1.4)

    # Left & Right Pedestals (height=0.68m, center Z=0.34m -> bottom at 0.000m)
    add_beveled_box("Pedestal_L", (0.44, 0.72, 0.68), (-0.48, 0.0, 0.34), wood_mat)
    add_beveled_box("Pedestal_R", (0.44, 0.72, 0.68), (0.48, 0.0, 0.34), wood_mat)
    # Modesty Panel
    add_beveled_box("Modesty_Panel", (0.56, 0.04, 0.46), (0.0, -0.32, 0.42), wood_mat)
    # Beveled Desktop Slab (height=0.045m, center Z=0.7025m -> top at 0.725m)
    add_beveled_box("Desktop_Top", (1.52, 0.80, 0.045), (0.0, 0.0, 0.7025), wood_mat, bevel_width=0.01)
    # Drawer Pull Handles
    for idx, z_pos in enumerate([0.54, 0.36, 0.18]):
        add_beveled_box(f"Handle_L_{idx}", (0.12, 0.03, 0.025), (-0.48, 0.37, z_pos), steel_mat, bevel_width=0.003)
    # Monitor Stand & LCD Panel flush on Z=0.725m
    add_beveled_box("Monitor_Base", (0.22, 0.18, 0.018), (-0.28, -0.14, 0.734), steel_mat, bevel_width=0.003)
    add_beveled_box("Monitor_Neck", (0.055, 0.045, 0.14), (-0.28, -0.17, 0.805), steel_mat, bevel_width=0.003)
    add_beveled_box("Monitor_Screen", (0.52, 0.032, 0.34), (-0.28, -0.12, 0.965), screen_mat, bevel_width=0.004)

    out_path = os.path.join(OUT_DIR, "executive_office_desk.glb")
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_yup=True)
    print("Exported:", out_path)


if __name__ == "__main__":
    build_executive_office_desk_glb()
