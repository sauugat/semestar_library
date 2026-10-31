"""
Production Computer & Electronics Laboratory Geometry Builder for Blender.
Constructs architectural shell, hollow windows, swinging doors, computer workstations,
electronics workbenches, oscilloscopes, multimeters, soldering stations, server rack,
equipment cabinets, whiteboard, noticeboard, switchboard, and interactive props.

Coordinate System Mapping:
Blender native (Z is Up, X is East-West, Y is North-South):
- Width (East-West):  X in [-3.8m, +3.8m] (7.6m)  --> Three.js Z in [-3.8m, +3.8m] (depth)
- Depth (North-South): Y in [-4.0m, +4.0m] (8.0m)  --> Three.js X in [-4.0m, +4.0m] (width)
- Height:              Z in [0.0m,  +3.35m] (3.35m) --> Three.js Y in [0.0m,  +3.35m] (height)
"""

import bpy
import bmesh
import math
from mathutils import Vector, Euler

def create_box(name, size, location, material=None, parent=None):
    """Creates a basic box mesh with given dimensions and location."""
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = Vector(size)
    obj.location = Vector(location)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if material:
        obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    return obj

def create_cylinder(name, radius, depth, location, rotation=(0,0,0), vertices=16, material=None, parent=None):
    """Creates a cylinder primitive with given radius and depth."""
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices,
        radius=radius,
        depth=depth,
        location=location,
        rotation=rotation
    )
    obj = bpy.context.active_object
    obj.name = name
    if material:
        obj.data.materials.append(material)
    if parent:
        obj.parent = parent
    return obj

def build_architectural_shell(mats, root_group):
    """
    Builds floor, ceiling, skirting, dado, exterior/interior walls with cutouts.
    Blender coordinates:
      X = Width (-3.8 to +3.8, door to windows)
      Y = Depth (-4.0 to +4.0, front to back)
      Z = Height (0 = Floor, 3.35 = Ceiling)
    """
    W = 7.6   # Door-to-window width
    D = 8.0   # Room depth
    H = 3.35  # Ceiling height
    T = 0.20  # Wall thickness
    dado_h = 1.10

    # 1. Floor Slab (top walking surface at Z = 0)
    create_box(
        "Lab_Floor",
        (W + 0.4, D + 0.4, 0.15),
        (0, 0, -0.075),
        mats['floor_terrazzo'],
        root_group
    )

    # 2. Drop Acoustic Ceiling at Z = H
    create_box(
        "Lab_Ceiling",
        (W, D, 0.08),
        (0, 0, H + 0.04),
        mats['ceiling_tile'],
        root_group
    )

    # 3. North (Front / Teaching) Wall at Y = +4.0m
    create_box(
        "Wall_North_Dado",
        (W + T * 2, T, dado_h),
        (0, D * 0.5 + T * 0.5, dado_h * 0.5),
        mats['wall_dado'],
        root_group
    )
    create_box(
        "Wall_North_Upper",
        (W + T * 2, T, H - dado_h),
        (0, D * 0.5 + T * 0.5, dado_h + (H - dado_h) * 0.5),
        mats['wall_plaster'],
        root_group
    )

    # 4. South (Back / Storage) Wall at Y = -4.0m
    create_box(
        "Wall_South_Dado",
        (W + T * 2, T, dado_h),
        (0, -D * 0.5 - T * 0.5, dado_h * 0.5),
        mats['wall_dado'],
        root_group
    )
    create_box(
        "Wall_South_Upper",
        (W + T * 2, T, H - dado_h),
        (0, -D * 0.5 - T * 0.5, dado_h + (H - dado_h) * 0.5),
        mats['wall_plaster'],
        root_group
    )

    # 5. Dado Moldings along North & South
    create_box("Molding_Dado_North", (W, 0.025, 0.04), (0, D * 0.5 - 0.0125, dado_h), mats['trim_wood'], root_group)
    create_box("Molding_Dado_South", (W, 0.025, 0.04), (0, -D * 0.5 + 0.0125, dado_h), mats['trim_wood'], root_group)

    # 6. Baseboards / Skirting along North & South
    create_box("Skirting_North", (W, 0.02, 0.08), (0, D * 0.5 - 0.01, 0.04), mats['trim_wood'], root_group)
    create_box("Skirting_South", (W, 0.02, 0.08), (0, -D * 0.5 + 0.01, 0.04), mats['trim_wood'], root_group)

    # 7. West (Corridor Entrance) Wall at X = -3.8m with Centered Doorway Opening
    # Doorway: Y in [-0.50m, +0.50m] (width = 1.0m, height = 2.15m in Z)
    # North segment of West wall: Y in [0.50, 4.00], length = 3.50m
    create_box("Wall_West_Dado_1", (T, 3.50, dado_h), (-W * 0.5 - T * 0.5, 2.25, dado_h * 0.5), mats['wall_dado'], root_group)
    create_box("Wall_West_Upper_1", (T, 3.50, H - dado_h), (-W * 0.5 - T * 0.5, 2.25, dado_h + (H - dado_h) * 0.5), mats['wall_plaster'], root_group)
    # South segment of West wall: Y in [-4.00, -0.50], length = 3.50m
    create_box("Wall_West_Dado_2", (T, 3.50, dado_h), (-W * 0.5 - T * 0.5, -2.25, dado_h * 0.5), mats['wall_dado'], root_group)
    create_box("Wall_West_Upper_2", (T, 3.50, H - dado_h), (-W * 0.5 - T * 0.5, -2.25, dado_h + (H - dado_h) * 0.5), mats['wall_plaster'], root_group)
    # Transom lintel above door: Z from 2.15 to H (height = 1.20m), Y from -0.50 to +0.50
    create_box("Wall_West_Door_Transom", (T, 1.00, H - 2.15), (-W * 0.5 - T * 0.5, 0.00, 2.15 + (H - 2.15) * 0.5), mats['wall_plaster'], root_group)
    # West Dado Moldings & Skirtings
    create_box("Molding_Dado_West_N", (0.025, 3.50, 0.04), (-W * 0.5 + 0.0125, 2.25, dado_h), mats['trim_wood'], root_group)
    create_box("Skirting_West_N", (0.02, 3.50, 0.08), (-W * 0.5 + 0.01, 2.25, 0.04), mats['trim_wood'], root_group)
    create_box("Molding_Dado_West_S", (0.025, 3.50, 0.04), (-W * 0.5 + 0.0125, -2.25, dado_h), mats['trim_wood'], root_group)
    create_box("Skirting_West_S", (0.02, 3.50, 0.08), (-W * 0.5 + 0.01, -2.25, 0.04), mats['trim_wood'], root_group)

    # 8. East (Exterior Window) Wall at X = +3.8m with 2 Large Window Openings
    # Window 1: Y in [1.00, 2.60], Window 2: Y in [-2.60, -1.00]
    # Window sill at Z = 0.95m, head at Z = 2.30m
    # Pier 1: Y in [2.60, 4.00], length = 1.40m
    create_box("Wall_East_Dado_1", (T, 1.40, dado_h), (W * 0.5 + T * 0.5, 3.30, dado_h * 0.5), mats['wall_dado'], root_group)
    create_box("Wall_East_Upper_1", (T, 1.40, H - dado_h), (W * 0.5 + T * 0.5, 3.30, dado_h + (H - dado_h) * 0.5), mats['wall_plaster'], root_group)
    # Pier 2: Y in [-1.00, 1.00], length = 2.00m
    create_box("Wall_East_Dado_2", (T, 2.00, dado_h), (W * 0.5 + T * 0.5, 0.00, dado_h * 0.5), mats['wall_dado'], root_group)
    create_box("Wall_East_Upper_2", (T, 2.00, H - dado_h), (W * 0.5 + T * 0.5, 0.00, dado_h + (H - dado_h) * 0.5), mats['wall_plaster'], root_group)
    # Pier 3: Y in [-4.00, -2.60], length = 1.40m
    create_box("Wall_East_Dado_3", (T, 1.40, dado_h), (W * 0.5 + T * 0.5, -3.30, dado_h * 0.5), mats['wall_dado'], root_group)
    create_box("Wall_East_Upper_3", (T, 1.40, H - dado_h), (W * 0.5 + T * 0.5, -3.30, dado_h + (H - dado_h) * 0.5), mats['wall_plaster'], root_group)

    # Spandrels below windows (Z: 0 to 0.95m)
    create_box("Wall_East_Spandrel_1", (T, 1.60, 0.95), (W * 0.5 + T * 0.5, 1.80, 0.475), mats['wall_dado'], root_group)
    create_box("Wall_East_Spandrel_2", (T, 1.60, 0.95), (W * 0.5 + T * 0.5, -1.80, 0.475), mats['wall_dado'], root_group)

    # Lintels above windows (Z: 2.30 to H)
    create_box("Wall_East_Lintel_1", (T, 1.60, H - 2.30), (W * 0.5 + T * 0.5, 1.80, 2.30 + (H - 2.30) * 0.5), mats['wall_plaster'], root_group)
    create_box("Wall_East_Lintel_2", (T, 1.60, H - 2.30), (W * 0.5 + T * 0.5, -1.80, 2.30 + (H - 2.30) * 0.5), mats['wall_plaster'], root_group)

    # East Moldings and Skirtings on Piers
    for yc, ylen in [(3.30, 1.40), (0.00, 2.00), (-3.30, 1.40)]:
        create_box(f"Molding_Dado_East_{yc}", (0.025, ylen, 0.04), (W * 0.5 - 0.0125, yc, dado_h), mats['trim_wood'], root_group)
        create_box(f"Skirting_East_{yc}", (0.02, ylen, 0.08), (W * 0.5 - 0.01, yc, 0.04), mats['trim_wood'], root_group)

def build_hollow_windows(mats, root_group):
    """
    Constructs realistic 4-pane aluminum windows with hollow extruded perimeter frames,
    mullions, transoms, and transparent float glass panes.
    """
    W = 7.6
    sill_z = 0.95
    head_z = 2.30
    win_h = head_z - sill_z   # 1.35m
    win_w = 1.60              # 1.60m
    frame_d = 0.12            # Frame depth along X
    profile = 0.045           # Aluminum profile width

    for idx, yc in enumerate([1.80, -1.80], start=1):
        win_group = bpy.data.objects.new(f"Window_Frame_Group_{idx}", None)
        win_group.location = Vector((W * 0.5 + 0.10, yc, sill_z + win_h * 0.5))
        bpy.context.scene.collection.objects.link(win_group)
        if root_group:
            win_group.parent = root_group

        # Perimeter Frame (Jambs, Sill, Head)
        # Sill
        create_box(f"Window_Sill_{idx}", (frame_d, win_w, profile), (0, 0, -win_h * 0.5 + profile * 0.5), mats['window_frame_aluminum'], win_group)
        # Head
        create_box(f"Window_Head_{idx}", (frame_d, win_w, profile), (0, 0, win_h * 0.5 - profile * 0.5), mats['window_frame_aluminum'], win_group)
        # Left Jamb
        create_box(f"Window_Jamb_L_{idx}", (frame_d, profile, win_h), (0, -win_w * 0.5 + profile * 0.5, 0), mats['window_frame_aluminum'], win_group)
        # Right Jamb
        create_box(f"Window_Jamb_R_{idx}", (frame_d, profile, win_h), (0, win_w * 0.5 - profile * 0.5, 0), mats['window_frame_aluminum'], win_group)

        # Central Vertical Mullion
        create_box(f"Window_Mullion_V_{idx}", (frame_d * 0.85, profile, win_h), (0, 0, 0), mats['window_frame_aluminum'], win_group)
        # Central Horizontal Transom
        create_box(f"Window_Transom_H_{idx}", (frame_d * 0.85, win_w, profile), (0, 0, 0), mats['window_frame_aluminum'], win_group)

        # Transparent Float Glass Pane (Single continuous sheet inside frame channel)
        glass = create_box(
            f"Window_Glass_Lab_{idx}",
            (0.008, win_w - profile * 2, win_h - profile * 2),
            (0, 0, 0),
            mats['window_glass'],
            win_group
        )
        glass.display_type = 'SOLID'

def build_entrance_door(mats, root_group):
    """
    Constructs entrance doorway frame and interactive swinging wooden door leaf with steel lever handle.
    Hinge is at North side of door opening: Y = 3.30m, X = -3.8m.
    """
    door_w = 1.00
    door_h = 2.15
    door_t = 0.05
    frame_t = 0.05
    hinge_x = -3.80 - 0.10  # Center in wall thickness
    hinge_y = 0.50          # North hinge pivot
    floor_z = 0.0

    # Door Frame (Left jamb, Right jamb, Lintel)
    frame_group = bpy.data.objects.new("Door_Frame_Lab_Group", None)
    frame_group.location = Vector((hinge_x, 0.0, door_h * 0.5))
    bpy.context.scene.collection.objects.link(frame_group)
    if root_group:
        frame_group.parent = root_group

    # Left Jamb (South side, Y = -0.50)
    create_box("Door_Frame_Jamb_South", (0.22, frame_t, door_h), (0, -door_w * 0.5 + frame_t * 0.5, 0), mats['trim_wood'], frame_group)
    # Right Jamb (North side, Y = +0.50)
    create_box("Door_Frame_Jamb_North", (0.22, frame_t, door_h), (0, door_w * 0.5 - frame_t * 0.5, 0), mats['trim_wood'], frame_group)
    # Head Lintel
    create_box("Door_Frame_Head", (0.22, door_w, frame_t), (0, 0, door_h * 0.5 - frame_t * 0.5), mats['trim_wood'], frame_group)

    # Interactive Swinging Door Leaf
    door_leaf = bpy.data.objects.new("Door_Leaf_Lab", None)
    door_leaf.location = Vector((hinge_x, hinge_y, floor_z))
    bpy.context.scene.collection.objects.link(door_leaf)
    if root_group:
        door_leaf.parent = root_group

    # Door Slab (Extending South from hinge pivot: Y from 0 to -door_w)
    door_slab = create_box(
        "Door_Slab_Mesh",
        (door_t, door_w - 0.02, door_h - 0.02),
        (0, -(door_w - 0.02) * 0.5, door_h * 0.5),
        mats['door_wood'],
        door_leaf
    )

    # Steel Lever Handle & Escutcheon Plate (South edge: Y = -(door_w - 0.12), Z = 1.05m)
    handle_y = -(door_w - 0.12)
    handle_z = 1.05
    # Escutcheon Plates (Inside & Outside)
    create_box("Door_Handle_Plate_In", (0.008, 0.06, 0.22), (door_t * 0.5 + 0.004, handle_y, handle_z), mats['hardware_steel'], door_leaf)
    create_box("Door_Handle_Plate_Out", (0.008, 0.06, 0.22), (-door_t * 0.5 - 0.004, handle_y, handle_z), mats['hardware_steel'], door_leaf)
    # Lever Levers
    create_box("Door_Handle_Lever_Lab", (0.04, 0.12, 0.02), (door_t * 0.5 + 0.025, handle_y + 0.04, handle_z), mats['hardware_steel'], door_leaf)
    create_box("Door_Handle_Lever_Out", (0.04, 0.12, 0.02), (-door_t * 0.5 - 0.025, handle_y + 0.04, handle_z), mats['hardware_steel'], door_leaf)

    return door_leaf

def build_computer_workstations(mats, root_group):
    """
    Constructs student computer workstations with desks, PC towers, monitors,
    keyboards, mice, and cable trunking.
    Arranged in a line along the West-Central floor ($X \in [-2.4, -0.8]$).
    """
    desk_w = 1.40
    desk_d = 0.75
    desk_h = 0.74
    top_t = 0.035
    leg_t = 0.04

    # 3 Computer Desks in a row along Y
    y_positions = [1.20, -0.40, -2.00]
    desk_x = -1.60

    for d_idx, dy in enumerate(y_positions, start=1):
        desk_group = bpy.data.objects.new(f"Computer_Desk_Group_{d_idx}", None)
        desk_group.location = Vector((desk_x, dy, 0))
        bpy.context.scene.collection.objects.link(desk_group)
        if root_group:
            desk_group.parent = root_group

        # Desk Top
        create_box(f"Desk_Top_{d_idx}", (desk_d, desk_w, top_t), (0, 0, desk_h - top_t * 0.5), mats['desk_laminate'], desk_group)

        # Steel Legs (4 corner legs)
        half_w = desk_w * 0.5 - leg_t
        half_d = desk_d * 0.5 - leg_t
        for lx in [-half_d, half_d]:
            for ly in [-half_w, half_w]:
                create_box(f"Desk_Leg_{d_idx}_{lx}_{ly}", (leg_t, leg_t, desk_h - top_t), (lx, ly, (desk_h - top_t) * 0.5), mats['steel_frame'], desk_group)

        # Stretcher Bar
        create_box(f"Desk_Stretcher_{d_idx}", (leg_t, desk_w - leg_t * 2, leg_t), (half_d, 0, 0.20), mats['steel_frame'], desk_group)

        # Cable Management Trunking Tray under desk
        create_box(f"Desk_Cable_Tray_{d_idx}", (0.15, desk_w * 0.8, 0.06), (half_d * 0.5, 0, desk_h - 0.10), mats['steel_frame'], desk_group)

        # Two Workstation setups per desk (North & South halves)
        for sub_idx, sub_y in [(1, dy + 0.35), (2, dy - 0.35)]:
            ws_id = (d_idx - 1) * 2 + sub_idx

            # 1. PC Tower Casing (On floor beside leg)
            chassis_mat = mats['pc_chassis_beige'] if ws_id % 2 == 1 else mats['pc_chassis_dark']
            tower = create_box(
                f"PC_Tower_{ws_id}",
                (0.42, 0.18, 0.38),
                (desk_x + 0.15, sub_y + 0.10, 0.19),
                chassis_mat,
                root_group
            )
            # CD-ROM & power button detail on front (+X)
            create_box(f"PC_Bezel_{ws_id}", (0.015, 0.16, 0.10), (desk_x + 0.15 - 0.21, sub_y + 0.10, 0.32), mats['peripherals_plastic'], root_group)

            # 2. Monitor Stand & Bezel (on desk top, facing East)
            mon_x = desk_x - 0.15
            mon_y = sub_y
            mon_z = desk_h

            # Base & Neck
            create_box(f"Mon_Base_{ws_id}", (0.22, 0.24, 0.02), (mon_x, mon_y, mon_z + 0.01), mats['peripherals_plastic'], root_group)
            create_box(f"Mon_Neck_{ws_id}", (0.04, 0.06, 0.14), (mon_x, mon_y, mon_z + 0.08), mats['peripherals_plastic'], root_group)

            # Bezel Housing (19-inch 4:3 or 16:9 monitor)
            mon_w = 0.44
            mon_h = 0.30
            create_box(f"Mon_Bezel_{ws_id}", (0.05, mon_w, mon_h), (mon_x, mon_y, mon_z + 0.15 + mon_h * 0.5), mats['peripherals_plastic'], root_group)

            # Screen Surface
            # Station 1 is interactive terminal; others have static emissive or off states
            if ws_id == 1:
                screen_mat = mats['screen_terminal_green']
                screen_name = "Terminal_Monitor_1"  # Key interactive object
            elif ws_id == 2:
                screen_mat = mats['screen_terminal_amber']
                screen_name = f"Screen_Monitor_{ws_id}"
            elif ws_id == 3:
                screen_mat = mats['screen_off']
                screen_name = f"Screen_Monitor_{ws_id}"
            else:
                screen_mat = mats['screen_terminal_green']
                screen_name = f"Screen_Monitor_{ws_id}"

            screen_mesh = create_box(
                screen_name,
                (0.008, mon_w - 0.04, mon_h - 0.04),
                (mon_x + 0.026, mon_y, mon_z + 0.15 + mon_h * 0.5),
                screen_mat,
                root_group
            )

            # 3. Keyboard & Mouse (facing East)
            create_box(f"Keyboard_{ws_id}", (0.16, 0.38, 0.018), (desk_x + 0.12, sub_y, mon_z + 0.009), mats['peripherals_plastic'], root_group)
            create_box(f"Mouse_{ws_id}", (0.11, 0.06, 0.025), (desk_x + 0.12, sub_y - 0.24, mon_z + 0.012), mats['peripherals_plastic'], root_group)

            # 4. Student Lab Stool / Chair
            chair_x = desk_x + 0.60
            chair_z = 0.46
            # Seat Cushion
            create_box(f"Lab_Stool_Seat_{ws_id}", (0.36, 0.36, 0.04), (chair_x, sub_y, chair_z), mats['peripherals_plastic'], root_group)
            # Legs
            for cx in [-0.14, 0.14]:
                for cy in [-0.14, 0.14]:
                    create_box(f"Lab_Stool_Leg_{ws_id}_{cx}_{cy}", (0.025, 0.025, chair_z), (chair_x + cx, sub_y + cy, chair_z * 0.5), mats['steel_frame'], root_group)

def build_electronics_workbenches(mats, root_group):
    """
    Constructs heavy industrial electronics testing workbenches with blue anti-static ESD mats,
    overhead equipment shelves, oscilloscopes with glowing waveforms, digital multimeters,
    soldering stations, breadboards, and tool pegboard.
    Arranged along the East-Central floor ($X \in [+1.0, +2.6]$).
    """
    bench_w = 2.00
    bench_d = 0.90
    bench_h = 0.85
    shelf_h = 1.45
    bench_x = 1.80

    y_positions = [0.90, -1.50]

    for b_idx, by in enumerate(y_positions, start=1):
        bench_group = bpy.data.objects.new(f"Electronics_Bench_Group_{b_idx}", None)
        bench_group.location = Vector((bench_x, by, 0))
        bpy.context.scene.collection.objects.link(bench_group)
        if root_group:
            bench_group.parent = root_group

        # Heavy Industrial Frame (Legs & Rails)
        for lx in [-bench_d * 0.5 + 0.04, bench_d * 0.5 - 0.04]:
            for ly in [-bench_w * 0.5 + 0.04, bench_w * 0.5 - 0.04]:
                create_box(f"Bench_Leg_{b_idx}_{lx}_{ly}", (0.06, 0.06, bench_h), (lx, ly, bench_h * 0.5), mats['steel_frame'], bench_group)

        # Anti-Static Blue ESD Rubber Worksurface
        create_box(f"Bench_ESD_Top_{b_idx}", (bench_d, bench_w, 0.04), (0, 0, bench_h - 0.02), mats['bench_esd_mat'], bench_group)

        # Upper Equipment Shelf Uprights & Shelf
        create_box(f"Shelf_Upright_L_{b_idx}", (0.05, 0.05, shelf_h - bench_h), (-bench_d * 0.5 + 0.04, -bench_w * 0.5 + 0.05, bench_h + (shelf_h - bench_h) * 0.5), mats['steel_frame'], bench_group)
        create_box(f"Shelf_Upright_R_{b_idx}", (0.05, 0.05, shelf_h - bench_h), (-bench_d * 0.5 + 0.04, bench_w * 0.5 - 0.05, bench_h + (shelf_h - bench_h) * 0.5), mats['steel_frame'], bench_group)
        create_box(f"Equipment_Shelf_{b_idx}", (0.35, bench_w, 0.03), (-bench_d * 0.5 + 0.175, 0, shelf_h), mats['desk_laminate'], bench_group)

        # Power Distribution Strip on Upper Shelf
        create_box(f"PDU_Strip_{b_idx}", (0.06, bench_w * 0.8, 0.04), (-bench_d * 0.5 + 0.06, 0, shelf_h + 0.04), mats['peripherals_plastic'], bench_group)

        # 1. Dual-Trace Cathode Ray Oscilloscope on Shelf
        osc_x = bench_x - 0.20
        osc_y = by - 0.40
        osc_z = shelf_h + 0.03
        # Chassis
        create_box(f"Oscilloscope_Body_{b_idx}", (0.32, 0.36, 0.18), (osc_x, osc_y, osc_z + 0.09), mats['oscilloscope_body'], root_group)
        # CRT Screen with Glowing Sine Wave
        create_box(f"Oscilloscope_Screen_{b_idx}", (0.01, 0.14, 0.12), (osc_x + 0.165, osc_y - 0.08, osc_z + 0.09), mats['oscilloscope_screen'], root_group)
        # Rotary Control Knobs
        for kx in [0.03, 0.09]:
            for kz in [0.05, 0.11]:
                create_cylinder(f"Osc_Knob_{b_idx}_{kx}_{kz}", 0.014, 0.015, (osc_x + 0.165, osc_y + kx, osc_z + kz), (0, math.radians(90), 0), 12, mats['peripherals_plastic'], root_group)

        # 2. Digital Multimeter with Yellow Protective Boot on bench surface
        dmm_x = bench_x + 0.10
        dmm_y = by + 0.45
        dmm_z = bench_h
        create_box(f"Multimeter_Body_{b_idx}", (0.16, 0.09, 0.045), (dmm_x, dmm_y, dmm_z + 0.025), mats['multimeter_yellow'], root_group)
        # LCD Display Window
        create_box(f"Multimeter_LCD_{b_idx}", (0.05, 0.06, 0.005), (dmm_x - 0.04, dmm_y, dmm_z + 0.048), mats['screen_off'], root_group)
        # Test Probe Leads (Red & Black coils)
        create_cylinder(f"DMM_Probe_Red_{b_idx}", 0.005, 0.12, (dmm_x + 0.12, dmm_y - 0.04, dmm_z + 0.01), (0, 0, math.radians(45)), 8, mats['led_amber'], root_group)
        create_cylinder(f"DMM_Probe_Black_{b_idx}", 0.005, 0.12, (dmm_x + 0.12, dmm_y + 0.04, dmm_z + 0.01), (0, 0, math.radians(-30)), 8, mats['peripherals_plastic'], root_group)

        # 3. Soldering Station with Iron Rest
        solder_x = bench_x - 0.22
        solder_y = by + 0.45
        solder_z = bench_h
        create_box(f"Solder_Station_{b_idx}", (0.15, 0.14, 0.10), (solder_x, solder_y, solder_z + 0.05), mats['solder_station'], root_group)
        # Iron Stand & Pencil
        create_cylinder(f"Solder_Rest_{b_idx}", 0.02, 0.08, (solder_x + 0.12, solder_y, solder_z + 0.04), (math.radians(35), 0, 0), 12, mats['steel_frame'], root_group)

        # 4. Prototyping Breadboard & Electronic Components
        bb_x = bench_x + 0.05
        bb_y = by - 0.15
        bb_z = bench_h
        create_box(f"Breadboard_{b_idx}", (0.18, 0.12, 0.012), (bb_x, bb_y, bb_z + 0.006), mats['breadboard_white'], root_group)
        # Green PCB circuit prototype board
        create_box(f"PCB_Prototype_{b_idx}", (0.10, 0.14, 0.004), (bb_x + 0.16, bb_y, bb_z + 0.003), mats['pcb_green'], root_group)

    # 5. Tool Pegboard mounted on East Wall ($X = +3.8\text{m}$, between windows at $Y = 0$)
    pegboard = create_box(
        "Lab_Tool_Pegboard",
        (0.02, 1.40, 0.90),
        (3.80 - 0.01, 0, 1.80),
        mats['tool_pegboard'],
        root_group
    )

def build_equipment_storage_cabinet(mats, root_group):
    """
    Constructs industrial 2-door equipment storage cabinet against South Wall ($Y = -4.0\text{m}$).
    Includes interactive left and right swinging doors (`Cabinet_Door_Left`, `Cabinet_Door_Right`).
    Cabinet serves as potential hiding spot / searchable container.
    """
    cab_w = 1.30  # along X
    cab_d = 0.65  # along Y
    cab_h = 1.95  # along Z
    cab_x = 0.20
    cab_y = -4.00 + cab_d * 0.5 + 0.02
    cab_z = 0.0

    cab_group = bpy.data.objects.new("Cabinet_Main_Group", None)
    cab_group.location = Vector((cab_x, cab_y, cab_z))
    bpy.context.scene.collection.objects.link(cab_group)
    if root_group:
        cab_group.parent = root_group

    # Outer Sheet-Steel Enclosure (Bottom, Top, Back, Left & Right sides)
    wall_t = 0.025
    # Bottom
    create_box("Cab_Bottom", (cab_w, cab_d, wall_t), (0, 0, wall_t * 0.5), mats['equipment_cabinet'], cab_group)
    # Top
    create_box("Cab_Top", (cab_w, cab_d, wall_t), (0, 0, cab_h - wall_t * 0.5), mats['equipment_cabinet'], cab_group)
    # Back (against South Wall: -Y)
    create_box("Cab_Back", (cab_w, wall_t, cab_h), (0, -cab_d * 0.5 + wall_t * 0.5, cab_h * 0.5), mats['equipment_cabinet'], cab_group)
    # Left Side (-X)
    create_box("Cab_Side_L", (wall_t, cab_d, cab_h), (-cab_w * 0.5 + wall_t * 0.5, 0, cab_h * 0.5), mats['equipment_cabinet'], cab_group)
    # Right Side (+X)
    create_box("Cab_Side_R", (wall_t, cab_d, cab_h), (cab_w * 0.5 - wall_t * 0.5, 0, cab_h * 0.5), mats['equipment_cabinet'], cab_group)

    # Internal Shelves
    for sz in [0.55, 1.05, 1.50]:
        create_box(f"Cab_Shelf_{sz}", (cab_w - wall_t * 2, cab_d - wall_t, wall_t), (0, 0, sz), mats['equipment_cabinet'], cab_group)

    # Interactive Left Door Leaf (`Cabinet_Door_Left`)
    # Hinge on West (-X): X = -cab_w * 0.5, Y = +cab_d * 0.5 (Front face: +Y)
    door_w = (cab_w - wall_t * 2) * 0.5
    door_h = cab_h - wall_t * 2
    door_t = 0.02

    left_hinge = bpy.data.objects.new("Cabinet_Door_Left", None)
    left_hinge.location = Vector((-cab_w * 0.5 + wall_t, cab_d * 0.5, wall_t))
    bpy.context.scene.collection.objects.link(left_hinge)
    left_hinge.parent = cab_group

    create_box(
        "Cabinet_Door_L_Mesh",
        (door_w, door_t, door_h),
        (door_w * 0.5, door_t * 0.5, door_h * 0.5),
        mats['equipment_cabinet'],
        left_hinge
    )
    # Left Chrome Handle
    create_box("Cab_Handle_L", (0.015, 0.04, 0.12), (door_w - 0.06, door_t * 0.5 + 0.02, door_h * 0.5), mats['hardware_steel'], left_hinge)

    # Interactive Right Door Leaf (`Cabinet_Door_Right`)
    # Hinge on East (+X): X = +cab_w * 0.5, Y = +cab_d * 0.5
    right_hinge = bpy.data.objects.new("Cabinet_Door_Right", None)
    right_hinge.location = Vector((cab_w * 0.5 - wall_t, cab_d * 0.5, wall_t))
    bpy.context.scene.collection.objects.link(right_hinge)
    right_hinge.parent = cab_group

    create_box(
        "Cabinet_Door_R_Mesh",
        (door_w, door_t, door_h),
        (-door_w * 0.5, door_t * 0.5, door_h * 0.5),
        mats['equipment_cabinet'],
        right_hinge
    )
    # Right Chrome Handle
    create_box("Cab_Handle_R", (0.015, 0.04, 0.12), (-door_w + 0.06, door_t * 0.5 + 0.02, door_h * 0.5), mats['hardware_steel'], right_hinge)

def build_server_rack(mats, root_group):
    """
    Constructs 19-inch telecom/server rack against South-West corner ($Y = -4.0\text{m}$, $X = -2.7\text{m}$).
    Includes 4U rackmount servers, patch panels, wiring bundles, and glowing status LEDs.
    """
    rack_w = 0.65
    rack_d = 0.80
    rack_h = 2.05
    rack_x = -2.70
    rack_y = -4.00 + rack_d * 0.5 + 0.02

    rack_group = bpy.data.objects.new("Server_Rack_Group", None)
    rack_group.location = Vector((rack_x, rack_y, 0))
    bpy.context.scene.collection.objects.link(rack_group)
    if root_group:
        rack_group.parent = root_group

    # Frame Pillars (4 corner posts)
    post_t = 0.04
    for px in [-rack_d * 0.5 + post_t * 0.5, rack_d * 0.5 - post_t * 0.5]:
        for py in [-rack_w * 0.5 + post_t * 0.5, rack_w * 0.5 - post_t * 0.5]:
            create_box(f"Rack_Post_{px}_{py}", (post_t, post_t, rack_h), (px, py, rack_h * 0.5), mats['server_rack_black'], rack_group)

    # Top & Bottom Plates
    create_box("Rack_Top", (rack_d, rack_w, 0.04), (0, 0, rack_h - 0.02), mats['server_rack_black'], rack_group)
    create_box("Rack_Bottom", (rack_d, rack_w, 0.04), (0, 0, 0.02), mats['server_rack_black'], rack_group)

    # Perforated Mesh Side Panels
    create_box("Rack_Side_L", (rack_d - 0.08, 0.015, rack_h - 0.08), (0, -rack_w * 0.5 + 0.01, rack_h * 0.5), mats['server_rack_black'], rack_group)
    create_box("Rack_Side_R", (rack_d - 0.08, 0.015, rack_h - 0.08), (0, rack_w * 0.5 - 0.01, rack_h * 0.5), mats['server_rack_black'], rack_group)

    # 4 Rackmount Servers (Front face: +X)
    for u_idx, uz in enumerate([0.50, 0.72, 0.94, 1.16], start=1):
        create_box(f"Server_Chassis_{u_idx}", (rack_d - 0.10, rack_w - 0.08, 0.16), (0, 0, uz), mats['server_rack_black'], rack_group)
        # LED Status array on front face
        create_box(f"Server_LED_G_{u_idx}", (0.01, 0.02, 0.01), (rack_d * 0.5 - 0.04, -rack_w * 0.5 + 0.10, uz), mats['led_green'], rack_group)
        create_box(f"Server_LED_A_{u_idx}", (0.01, 0.02, 0.01), (rack_d * 0.5 - 0.04, -rack_w * 0.5 + 0.14, uz), mats['led_amber'], rack_group)

    # 24-Port Patch Panel with Blue Network Cables
    create_box("Patch_Panel", (rack_d - 0.10, rack_w - 0.08, 0.08), (0, 0, 1.40), mats['peripherals_plastic'], rack_group)

def build_instructor_station(mats, root_group):
    """
    Constructs teacher/instructor workstation at Front/North wing ($Y = +2.70\text{m}$, $X = 0.80\text{m}$).
    Includes desk with slide-out drawer (`TeacherDesk_Drawer_Lab`) holding collectible key (`Item_Lab_Key`).
    """
    desk_w = 1.50
    desk_d = 0.80
    desk_h = 0.76
    desk_x = 0.80
    desk_y = 2.80

    desk_group = bpy.data.objects.new("Instructor_Desk_Group", None)
    desk_group.location = Vector((desk_x, desk_y, 0))
    bpy.context.scene.collection.objects.link(desk_group)
    if root_group:
        desk_group.parent = root_group

    # Mahogany Wood Laminate Desk Top
    create_box("Inst_Desk_Top", (desk_d, desk_w, 0.04), (0, 0, desk_h - 0.02), mats['instructor_wood'], desk_group)

    # Side Gable Panels & Modesty Panel
    create_box("Inst_Panel_L", (desk_d - 0.04, 0.03, desk_h - 0.04), (0, -desk_w * 0.5 + 0.02, (desk_h - 0.04) * 0.5), mats['instructor_wood'], desk_group)
    create_box("Inst_Panel_R", (desk_d - 0.04, 0.03, desk_h - 0.04), (0, desk_w * 0.5 - 0.02, (desk_h - 0.04) * 0.5), mats['instructor_wood'], desk_group)
    create_box("Inst_Modesty_Panel", (0.025, desk_w - 0.08, desk_h * 0.65), (desk_d * 0.5 - 0.04, 0, desk_h * 0.55), mats['instructor_wood'], desk_group)

    # Pedestal Drawer Enclosure (Right side: Y in [0.25, 0.65])
    ped_w = 0.40
    ped_y = desk_w * 0.5 - ped_w * 0.5 - 0.02
    create_box("Inst_Pedestal_Side", (desk_d - 0.08, 0.025, desk_h - 0.08), (-0.02, ped_y - ped_w * 0.5, (desk_h - 0.08) * 0.5), mats['instructor_wood'], desk_group)

    # Interactive Slide-Out Top Drawer (`TeacherDesk_Drawer_Lab`)
    # Slides out towards South (-X in Blender local coordinates: into room)
    drw_w = ped_w - 0.04
    drw_d = desk_d - 0.12
    drw_h = 0.18
    drw_z = desk_h - 0.22

    drw_obj = bpy.data.objects.new("TeacherDesk_Drawer_Lab", None)
    drw_obj.location = Vector((0, ped_y, drw_z))
    bpy.context.scene.collection.objects.link(drw_obj)
    drw_obj.parent = desk_group

    # Drawer Box (Bottom, Front, Back, Sides)
    create_box("Inst_Drw_Front", (0.02, drw_w, drw_h), (-drw_d * 0.5, 0, 0), mats['instructor_wood'], drw_obj)
    create_box("Inst_Drw_Bottom", (drw_d, drw_w, 0.015), (0, 0, -drw_h * 0.5 + 0.01), mats['desk_laminate'], drw_obj)
    create_box("Inst_Drw_Handle", (0.025, 0.12, 0.02), (-drw_d * 0.5 - 0.015, 0, 0), mats['hardware_steel'], drw_obj)

    # Collectible Item: Polished Brass Key inside Drawer (`Item_Lab_Key`)
    key_obj = bpy.data.objects.new("Item_Lab_Key", None)
    key_obj.location = Vector((0, 0, -drw_h * 0.5 + 0.03))
    bpy.context.scene.collection.objects.link(key_obj)
    key_obj.parent = drw_obj

    # Key Geometry (Ring, Shaft, Bit)
    create_cylinder("Key_Ring", 0.022, 0.005, (0.03, 0, 0), (0, 0, 0), 16, mats['brass_key'], key_obj)
    create_box("Key_Shaft", (0.06, 0.006, 0.005), (-0.01, 0, 0), mats['brass_key'], key_obj)
    create_box("Key_Bit", (0.015, 0.012, 0.005), (-0.035, 0.006, 0), mats['brass_key'], key_obj)

    # Instructor PC Monitor, Keyboard & Mouse
    create_box("Inst_Mon_Bezel", (0.05, 0.48, 0.32), (0.10, -0.15, desk_h + 0.22), mats['peripherals_plastic'], desk_group)
    create_box("Inst_Mon_Screen", (0.008, 0.44, 0.28), (-0.10 + 0.075, -0.15, desk_h + 0.22), mats['screen_terminal_green'], desk_group)
    create_box("Inst_Keyboard", (0.16, 0.42, 0.018), (-0.18, -0.15, desk_h + 0.009), mats['peripherals_plastic'], desk_group)

def build_teaching_displays(mats, root_group):
    """
    Constructs large ceramic whiteboard and cork noticeboard on North Wall ($Y = +4.0\text{m}$).
    Mounted flat against North Wall: normal is -Y, width is along X, thickness along Y.
    """
    # 1. Ceramic Whiteboard ($3.2\text{m} \times 1.2\text{m}$)
    wb_w = 3.20  # along X
    wb_h = 1.20  # along Z
    wb_t = 0.03  # along Y
    wb_x = 0.80  # centered slightly East of room center
    wb_z = 1.85
    wb_y = 4.00 - wb_t * 0.5 - 0.01

    wb_group = bpy.data.objects.new("Whiteboard_Lab_Group", None)
    wb_group.location = Vector((wb_x, wb_y, wb_z))
    bpy.context.scene.collection.objects.link(wb_group)
    if root_group:
        wb_group.parent = root_group

    # Anodized Aluminum Frame
    create_box("WB_Frame_Top", (wb_w, wb_t, 0.035), (0, 0, wb_h * 0.5), mats['window_frame_aluminum'], wb_group)
    create_box("WB_Frame_Bottom", (wb_w, wb_t, 0.035), (0, 0, -wb_h * 0.5), mats['window_frame_aluminum'], wb_group)
    create_box("WB_Frame_Left", (0.035, wb_t, wb_h), (-wb_w * 0.5, 0, 0), mats['window_frame_aluminum'], wb_group)
    create_box("WB_Frame_Right", (0.035, wb_t, wb_h), (wb_w * 0.5, 0, 0), mats['window_frame_aluminum'], wb_group)

    # Porcelain Enamel Writing Surface
    create_box("Whiteboard_Surface", (wb_w - 0.06, 0.01, wb_h - 0.06), (0, -0.01, 0), mats['whiteboard_surface'], wb_group)

    # Marker & Duster Tray
    create_box("WB_Marker_Tray", (wb_w * 0.9, 0.08, 0.015), (0, -0.04, -wb_h * 0.5 - 0.01), mats['window_frame_aluminum'], wb_group)

    # 2. Cork Noticeboard ($1.60\text{m} \times 0.90\text{m}$)
    nb_w = 1.60  # along X
    nb_h = 0.90  # along Z
    nb_t = 0.03  # along Y
    nb_x = -2.60 # West side of North Wall
    nb_y = 4.00 - nb_t * 0.5 - 0.01
    nb_z = 1.85

    nb_group = bpy.data.objects.new("Noticeboard_Lab_Group", None)
    nb_group.location = Vector((nb_x, nb_y, nb_z))
    bpy.context.scene.collection.objects.link(nb_group)
    if root_group:
        nb_group.parent = root_group

    create_box("NB_Frame", (nb_w, nb_t, nb_h), (0, 0, 0), mats['trim_wood'], nb_group)
    create_box("NB_Cork_Surface", (nb_w - 0.06, 0.01, nb_h - 0.06), (0, -0.01, 0), mats['noticeboard_cork'], nb_group)

def build_switchboard_and_conduits(mats, root_group):
    """
    Constructs industrial wall electrical switchboard on West Wall ($X = -3.8\text{m}$, South of door at $Y = 1.80\text{m}$).
    Includes hinged panel door (`Switchboard_Door_Lab`) and electrical conduit pipes running to ceiling.
    """
    sw_x = -3.80 + 0.06
    sw_y = -1.50
    sw_z = 1.50
    sw_w = 0.40
    sw_h = 0.55
    sw_d = 0.14

    sw_group = bpy.data.objects.new("Switchboard_Lab_Group", None)
    sw_group.location = Vector((sw_x, sw_y, sw_z))
    bpy.context.scene.collection.objects.link(sw_group)
    if root_group:
        sw_group.parent = root_group

    # Enclosure Box (Recessed into wall)
    create_box("Switchboard_Box", (sw_d, sw_w, sw_h), (0, 0, 0), mats['switchboard_metal'], sw_group)

    # Interactive Hinged Door (`Switchboard_Door_Lab`)
    # Hinge on North side of panel: Y = +sw_w * 0.5
    sw_door = bpy.data.objects.new("Switchboard_Door_Lab", None)
    sw_door.location = Vector((sw_d * 0.5, sw_w * 0.5, 0))
    bpy.context.scene.collection.objects.link(sw_door)
    sw_door.parent = sw_group

    create_box("Switchboard_Door_Mesh", (0.015, sw_w, sw_h), (0.008, -sw_w * 0.5, 0), mats['switchboard_metal'], sw_door)
    # Latch Handle
    create_box("Switchboard_Latch", (0.02, 0.03, 0.06), (0.02, -sw_w + 0.05, 0), mats['hardware_steel'], sw_door)

    # Electrical Conduit Pipe (Vertical from switchboard to ceiling at Z = 3.35m)
    conduit_h = 3.35 - (sw_z + sw_h * 0.5)
    create_cylinder(
        "Conduit_Pipe_Vertical",
        0.015,
        conduit_h,
        (sw_x + 0.03, sw_y, sw_z + sw_h * 0.5 + conduit_h * 0.5),
        (0, 0, 0),
        12,
        mats['window_frame_aluminum'],
        root_group
    )

def build_ceiling_lighting_fixtures(mats, root_group):
    """
    Constructs 6 ceiling-mounted fluorescent tube light troffers in a 2x3 grid.
    Includes housing reflectors and emissive fluorescent tubes (`TubeLight_Lamp_Lab_1` to `6`).
    """
    fixture_w = 1.30
    fixture_d = 0.26
    fixture_h = 0.08
    ceil_z = 3.35 - fixture_h * 0.5

    x_coords = [-1.50, 1.50]
    y_coords = [2.00, 0.00, -2.00]

    tube_idx = 1
    for fx in x_coords:
        for fy in y_coords:
            fix_group = bpy.data.objects.new(f"TubeLight_Fixture_Group_{tube_idx}", None)
            fix_group.location = Vector((fx, fy, ceil_z))
            bpy.context.scene.collection.objects.link(fix_group)
            if root_group:
                fix_group.parent = root_group

            # Sheet Metal Reflector Housing
            create_box(f"TubeLight_Housing_{tube_idx}", (fixture_d, fixture_w, fixture_h), (0, 0, 0), mats['fluorescent_housing'], fix_group)

            # Emissive Fluorescent Tube Lamp (Twin Tubes)
            for ty_off in [-0.05, 0.05]:
                create_cylinder(
                    f"TubeLight_Lamp_Lab_{tube_idx}_{ty_off}",
                    0.018,
                    fixture_w - 0.12,
                    (ty_off, 0, -fixture_h * 0.5 - 0.01),
                    (math.radians(90), 0, 0),
                    12,
                    mats['fluorescent_lamp'],
                    fix_group
                )

            tube_idx += 1

def construct_full_computer_lab():
    """
    Master assembly function for the Computer & Electronics Laboratory.
    Clears scene, builds materials, hierarchy, geometry, and returns root group.
    """
    print("\n[Builder] Initializing scene for Computer & Electronics Laboratory...")

    # Clear existing scene objects
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()

    from computer_lab_materials import build_computer_lab_material_library, get_or_create_gltf_output_group
    get_or_create_gltf_output_group()
    mats = build_computer_lab_material_library()

    root_group = bpy.data.objects.new("Computer_Lab_Production_Root", None)
    bpy.context.scene.collection.objects.link(root_group)

    print("[Builder] Constructing architectural shell...")
    build_architectural_shell(mats, root_group)

    print("[Builder] Constructing hollow 4-pane aluminum windows...")
    build_hollow_windows(mats, root_group)

    print("[Builder] Constructing entrance doorway and swinging door...")
    build_entrance_door(mats, root_group)

    print("[Builder] Constructing computer workstations & PC terminals...")
    build_computer_workstations(mats, root_group)

    print("[Builder] Constructing electronics testing workbenches & instrumentation...")
    build_electronics_workbenches(mats, root_group)

    print("[Builder] Constructing equipment storage cabinet & doors...")
    build_equipment_storage_cabinet(mats, root_group)

    print("[Builder] Constructing 19-inch telecom/server rack...")
    build_server_rack(mats, root_group)

    print("[Builder] Constructing instructor desk & searchable drawer...")
    build_instructor_station(mats, root_group)

    print("[Builder] Constructing teaching whiteboard & noticeboard...")
    build_teaching_displays(mats, root_group)

    print("[Builder] Constructing electrical switchboard panel & conduits...")
    build_switchboard_and_conduits(mats, root_group)

    print("[Builder] Constructing ceiling fluorescent tube troffers...")
    build_ceiling_lighting_fixtures(mats, root_group)

    print("[Builder] Scene construction completed successfully.")
    return root_group
