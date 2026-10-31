"""
Quick test for Cycles baking on macOS Apple Silicon M4 with Blender 5.2.2.
"""
import bpy
import os
import sys

def test_cycles_baking():
    print("[Bake Test] Initializing scene...")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    # Enable Cycles and Metal GPU if available
    scene.render.engine = 'CYCLES'
    cprefs = bpy.context.preferences.addons.get('cycles')
    if cprefs:
        cprefs.preferences.compute_device_type = 'METAL'
        cprefs.preferences.get_devices()
        for d in cprefs.preferences.devices:
            if d.type == 'METAL':
                d.use = True
        scene.cycles.device = 'GPU'
    
    scene.cycles.samples = 16
    scene.cycles.bake_type = 'AO'

    # Add a floor and a cube on top to generate contact AO
    bpy.ops.mesh.primitive_plane_add(size=4.0, location=(0, 0, 0))
    plane = bpy.context.active_object
    plane.name = "FloorPlane"

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.5))
    cube = bpy.context.active_object
    cube.name = "TestCube"

    # Join or unwrap plane
    bpy.context.view_layer.objects.active = plane
    plane.select_set(True)
    cube.select_set(False)

    # Create lightmap UV
    uv2 = plane.data.uv_layers.new(name="UVMap_AO")
    plane.data.uv_layers.active = uv2

    # Create image for baking
    img = bpy.data.images.new(name="BakeTest_AO", width=256, height=256, alpha=False, float_buffer=False)
    
    # Create material with image texture node
    mat = bpy.data.materials.new(name="BakeMat")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    tex_node = nodes.new(type="ShaderNodeTexImage")
    tex_node.image = img
    nodes.active = tex_node
    plane.data.materials.append(mat)

    print("[Bake Test] Baking AO with Cycles...")
    bpy.ops.object.bake(type='AO')
    print("[Bake Test] Bake completed successfully!")

    out_png = "/tmp/bake_test_ao.png"
    img.filepath_raw = out_png
    img.file_format = 'PNG'
    img.save()
    assert os.path.exists(out_png), "Bake output PNG does not exist!"
    print(f"[Bake Test] Saved baked AO image to {out_png} ({os.path.getsize(out_png)} bytes)")

if __name__ == "__main__":
    test_cycles_baking()
