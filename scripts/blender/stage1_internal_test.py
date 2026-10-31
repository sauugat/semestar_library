"""
Stage 1 In-Blender Test Script.
Runs inside Blender: creates a test mesh, saves .blend, reopens it, and exports .glb.
"""
import sys
import os
import bpy

def test_workflow():
    print(f"[Blender Script] Running under Blender {bpy.app.version_string}")
    output_dir = sys.argv[-1] if len(sys.argv) > 1 and not sys.argv[-1].startswith("-") else "/tmp/blender_test"
    os.makedirs(output_dir, exist_ok=True)
    blend_path = os.path.join(output_dir, "stage1_test.blend")
    glb_path = os.path.join(output_dir, "stage1_test.glb")

    # Clear existing data
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Create collection
    col = bpy.data.collections.new("TestCollection")
    bpy.context.scene.collection.children.link(col)

    # Add a test mesh cube
    bpy.ops.mesh.primitive_cube_add(size=2.0, location=(0, 0, 1.0))
    cube = bpy.context.active_object
    cube.name = "TestClassroomCube"

    # Add a simple PBR material
    mat = bpy.data.materials.new(name="TestPBRMaterial")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.2, 0.6, 0.9, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.4
        bsdf.inputs["Metallic"].default_value = 0.1
    cube.data.materials.append(mat)

    # Save to .blend
    print(f"[Blender Script] Saving .blend to {blend_path}...")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    assert os.path.exists(blend_path), f"Failed to save {blend_path}"
    print(f"[Blender Script] Successfully saved .blend ({os.path.getsize(blend_path)} bytes)")

    # Open the .blend file again to verify read capability
    print(f"[Blender Script] Reopening .blend from {blend_path}...")
    bpy.ops.wm.open_mainfile(filepath=blend_path)
    loaded_cube = bpy.data.objects.get("TestClassroomCube")
    assert loaded_cube is not None, "Cube not found after reopening .blend!"
    print(f"[Blender Script] Reopened successfully, found object '{loaded_cube.name}'")

    # Export to GLB
    print(f"[Blender Script] Exporting to GLB at {glb_path}...")
    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format='GLB',
        use_selection=False,
        export_apply=True
    )
    assert os.path.exists(glb_path), f"Failed to export {glb_path}"
    print(f"[Blender Script] Successfully exported GLB ({os.path.getsize(glb_path)} bytes)")
    print("[Blender Script] STAGE 1 VERIFICATION COMPLETED SUCCESSFULLY.")

if __name__ == "__main__":
    try:
        test_workflow()
    except Exception as e:
        print(f"[Blender Script ERROR]: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

