"""
Production Classroom Geometry Builder for Blender.
Constructs architectural structure, wall openings, doors, windows, desks,
chairs, whiteboard, clock, fans, tube lights, switchboard, dustbins, and props.
"""

import bpy
import bmesh
import math
from mathutils import Vector, Matrix

def create_box(name, size, location, material=None, parent=None):
    """Creates a basic box mesh with given dimensions and bottom-center/center origin."""
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
    """Builds floor, ceiling, skirting, dado, exterior/interior walls with cutouts."""
    W = 7.6   # Room width (X: -3.8 to +3.8)
    D = 7.6   # Room depth (Z: -3.8 to +3.8)
    H = 3.35  # Ceiling height
    T = 0.20  # Wall thickness
    dado_h = 1.05

    # 1. Floor Slab (walking plane at Y=0, slab extends down 0.15m)
    floor = create_box(
        "Classroom_Floor",
        (W + 0.4, 0.15, D + 0.4),
        (0, -0.075, 0),
        mats['floor_terrazzo'],
        root_group
    )

    # 2. Drop Acoustic Ceiling
    ceiling = create_box(
        "Classroom_Ceiling",
        (W, 0.08, D),
        (0, H + 0.04, 0),
        mats['ceiling_tile'],
        root_group
    )

    # 3. North (Front / Teaching) Wall at Z = -3.8m
    # Lower Dado Wall
    create_box(
        "Wall_North_Dado",
        (W + T * 2, dado_h, T),
        (0, dado_h * 0.5, -D * 0.5 - T * 0.5),
        mats['wall_dado'],
        root_group
    )
    # Upper Plaster Wall
    create_box(
        "Wall_North_Upper",
        (W + T * 2, H - dado_h, T),
        (0, dado_h + (H - dado_h) * 0.5, -D * 0.5 - T * 0.5),
        mats['wall_plaster'],
        root_group
    )

    # 4. South (Back) Wall at Z = +3.8m
    # Lower Dado Wall
    create_box(
        "Wall_South_Dado",
        (W + T * 2, dado_h, T),
        (0, dado_h * 0.5, D * 0.5 + T * 0.5),
        mats['wall_dado'],
        root_group
    )
    # Upper Plaster Wall
    create_box(
        "Wall_South_Upper",
        (W + T * 2, H - dado_h, T),
        (0, dado_h + (H - dado_h) * 0.5, D * 0.5 + T * 0.5),
        mats['wall_plaster'],
        root_group
    )

    # 5. Dado Moldings (Front & Back interior rails)
    create_box(
        "Molding_Dado_North",
        (W, 0.04, 0.025),
        (0, dado_h, -D * 0.5 + 0.0125),
        mats['trim_wood'],
        root_group
    )
    create_box(
        "Molding_Dado_South",
        (W, 0.04, 0.025),
        (0, dado_h, D * 0.5 - 0.0125),
        mats['trim_wood'],
        root_group
    )

    # 6. Baseboards / Skirting along North & South
    create_box(
        "Skirting_North",
        (W, 0.08, 0.02),
        (0, 0.04, -D * 0.5 + 0.01),
        mats['trim_wood'],
        root_group
    )
    create_box(
        "Skirting_South",
        (W, 0.08, 0.02),
        (0, 0.04, D * 0.5 - 0.01),
        mats['trim_wood'],
        root_group
    )

    # 7. West (Left / Entrance) Wall at X = -3.8m with Doorway Opening
    # Doorway: Z in [-3.20m, -2.20m] (width = 1.0m, height = 2.15m)
    # Segment 1: North of door (Z: -3.8 to -3.2, depth = 0.60m)
    create_box(
        "Wall_West_Dado_1",
        (T, dado_h, 0.60),
        (-W * 0.5 - T * 0.5, dado_h * 0.5, -3.50),
        mats['wall_dado'],
        root_group
    )
    create_box(
        "Wall_West_Upper_1",
        (T, H - dado_h, 0.60),
        (-W * 0.5 - T * 0.5, dado_h + (H - dado_h) * 0.5, -3.50),
        mats['wall_plaster'],
        root_group
    )
    # Segment 2: South of door (Z: -2.20 to +3.80, depth = 6.0m)
    create_box(
        "Wall_West_Dado_2",
        (T, dado_h, 6.00),
        (-W * 0.5 - T * 0.5, dado_h * 0.5, 0.80),
        mats['wall_dado'],
        root_group
    )
    create_box(
        "Wall_West_Upper_2",
        (T, H - dado_h, 6.00),
        (-W * 0.5 - T * 0.5, dado_h + (H - dado_h) * 0.5, 0.80),
        mats['wall_plaster'],
        root_group
    )
    # Transom lintel above door: Y from 2.15m to H (height = 1.20m), Z from -3.2 to -2.2
    create_box(
        "Wall_West_Door_Transom",
        (T, H - 2.15, 1.00),
        (-W * 0.5 - T * 0.5, 2.15 + (H - 2.15) * 0.5, -2.70),
        mats['wall_plaster'],
        root_group
    )
    # West Dado Molding along segment 2
    create_box(
        "Molding_Dado_West",
        (0.025, 0.04, 6.00),
        (-W * 0.5 + 0.0125, dado_h, 0.80),
        mats['trim_wood'],
        root_group
    )
    create_box(
        "Skirting_West",
        (0.02, 0.08, 6.00),
        (-W * 0.5 + 0.01, 0.04, 0.80),
        mats['trim_wood'],
        root_group
    )

    # 8. East (Right / Exterior Window) Wall at X = +3.8m with 2 Large Window Openings
    # Window 1: Z in [-2.40m, -0.80m], Window 2: Z in [0.80m, 2.40m]
    # Window sill at Y = 0.95m, window head at Y = 2.30m
    # Segment 1: North pier (Z: -3.8 to -2.4, depth = 1.4m)
    create_box("Wall_East_Dado_1", (T, dado_h, 1.40), (W * 0.5 + T * 0.5, dado_h * 0.5, -3.10), mats['wall_dado'], root_group)
    create_box("Wall_East_Upper_1", (T, H - dado_h, 1.40), (W * 0.5 + T * 0.5, dado_h + (H - dado_h) * 0.5, -3.10), mats['wall_plaster'], root_group)
    # Segment 2: Central pier (Z: -0.8 to +0.8, depth = 1.6m)
    create_box("Wall_East_Dado_2", (T, dado_h, 1.60), (W * 0.5 + T * 0.5, dado_h * 0.5, 0.00), mats['wall_dado'], root_group)
    create_box("Wall_East_Upper_2", (T, H - dado_h, 1.60), (W * 0.5 + T * 0.5, dado_h + (H - dado_h) * 0.5, 0.00), mats['wall_plaster'], root_group)
    # Segment 3: South pier (Z: 2.4 to 3.8, depth = 1.4m)
    create_box("Wall_East_Dado_3", (T, dado_h, 1.40), (W * 0.5 + T * 0.5, dado_h * 0.5, 3.10), mats['wall_dado'], root_group)
    create_box("Wall_East_Upper_3", (T, H - dado_h, 1.40), (W * 0.5 + T * 0.5, dado_h + (H - dado_h) * 0.5, 3.10), mats['wall_plaster'], root_group)

    # Window Spandrels (below sill, Y: 0 to 0.95m)
    create_box("Wall_East_Spandrel_1", (T, 0.95, 1.60), (W * 0.5 + T * 0.5, 0.475, -1.60), mats['wall_dado'], root_group)
    create_box("Wall_East_Spandrel_2", (T, 0.95, 1.60), (W * 0.5 + T * 0.5, 0.475, 1.60), mats['wall_dado'], root_group)

    # Window Lintels (above head, Y: 2.30m to H)
    create_box("Wall_East_Lintel_1", (T, H - 2.30, 1.60), (W * 0.5 + T * 0.5, 2.30 + (H - 2.30) * 0.5, -1.60), mats['wall_plaster'], root_group)
    create_box("Wall_East_Lintel_2", (T, H - 2.30, 1.60), (W * 0.5 + T * 0.5, 2.30 + (H - 2.30) * 0.5, 1.60), mats['wall_plaster'], root_group)

    # East Dado Moldings & Skirtings on solid piers
    for z_c, z_len in [(-3.10, 1.40), (0.00, 1.60), (3.10, 1.40)]:
        create_box(f"Molding_Dado_East_{z_c}", (0.025, 0.04, z_len), (W * 0.5 - 0.0125, dado_h, z_c), mats['trim_wood'], root_group)
        create_box(f"Skirting_East_{z_c}", (0.02, 0.08, z_len), (W * 0.5 - 0.01, 0.04, z_c), mats['trim_wood'], root_group)

    # 9. Lecture Dais (Raised Teaching Platform at front)
    create_box(
        "Lecture_Dais",
        (5.4, 0.14, 1.40),
        (0, 0.07, -D * 0.5 + 0.70 + 0.05),
        mats['dais_concrete'],
        root_group
    )

def build_doors_and_windows(mats, root_group):
    """Builds realistic door frame, interactive hinged door leaf, and 2 glazed windows."""
    W = 7.6
    D = 7.6

    # 1. Door Frame at X = -3.8m, Z in [-3.20m, -2.20m], height 2.15m
    frame_th = 0.06
    frame_depth = 0.22
    # Left jamb
    create_box("Door_Frame_Jamb_L", (frame_depth, 2.15, frame_th), (-W * 0.5 - 0.01, 1.075, -3.20 + frame_th * 0.5), mats['aluminum_brushed'], root_group)
    # Right jamb
    create_box("Door_Frame_Jamb_R", (frame_depth, 2.15, frame_th), (-W * 0.5 - 0.01, 1.075, -2.20 - frame_th * 0.5), mats['aluminum_brushed'], root_group)
    # Head jamb
    create_box("Door_Frame_Head", (frame_depth, frame_th, 1.00), (-W * 0.5 - 0.01, 2.15 - frame_th * 0.5, -2.70), mats['aluminum_brushed'], root_group)
    # Floor threshold
    create_box("Door_Threshold", (frame_depth + 0.04, 0.02, 1.00), (-W * 0.5 - 0.01, 0.01, -2.70), mats['aluminum_brushed'], root_group)

    # 2. Interactive Hinged Door Leaf
    # Width = 0.94m, Height = 2.10m, Thickness = 0.045m
    # Hinge is at (X = -3.78, Y = 0, Z = -3.17). Pivoting around Y rotates the door leaf into the classroom (+X).
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    door_leaf = bpy.context.active_object
    door_leaf.name = "Door_Leaf_Classroom"
    door_leaf.data.materials.append(mats['wood_varnish'])
    door_leaf.parent = root_group

    # Size: width along Z = 0.94m, height along Y = 2.10m, thickness along X = 0.045m
    # We position geometry so the origin is at the hinge edge!
    me = door_leaf.data
    bm = bmesh.new()
    bm.from_mesh(me)
    # Transform vertices so (0,0,0) is bottom hinge edge
    for v in bm.verts:
        v.co.x = (v.co.x + 0.5) * 0.045 - 0.0225
        v.co.y = (v.co.y + 0.5) * 2.10
        v.co.z = (v.co.z + 0.5) * 0.94  # extends along +Z from hinge
    bm.to_mesh(me)
    bm.free()
    door_leaf.location = Vector((-W * 0.5 + 0.02, 0.01, -3.17))
    door_leaf.rotation_euler = (0, 0, 0)

    # Add door handle / latch hardware as child of door leaf
    handle_base = create_box("Door_Handle_Escutcheon", (0.012, 0.18, 0.04), (0.025, 0.98, 0.84), mats['aluminum_brushed'], door_leaf)
    handle_lever = create_box("Door_Handle_Lever", (0.08, 0.02, 0.12), (0.065, 0.98, 0.88), mats['aluminum_brushed'], door_leaf)

    # 3. Two Windows on East Wall at X = +3.8m (Z = -1.6m and Z = +1.6m)
    # Window opening: 1.60m wide, 1.35m high (Y: 0.95m to 2.30m)
    for w_idx, win_z in enumerate([-1.60, 1.60], start=1):
        # Outer aluminum frame
        win_frame = create_box(f"Window_Frame_{w_idx}", (0.18, 1.35, 1.60), (W * 0.5 + 0.01, 1.625, win_z), mats['aluminum_brushed'], root_group)
        # Interior sill ledge
        win_sill = create_box(f"Window_Sill_{w_idx}", (0.24, 0.04, 1.68), (W * 0.5 - 0.04, 0.95, win_z), mats['trim_wood'], root_group)
        # Central mullion & transom
        create_box(f"Window_Mullion_{w_idx}", (0.12, 1.35, 0.04), (W * 0.5 + 0.01, 1.625, win_z), mats['aluminum_brushed'], root_group)
        create_box(f"Window_Transom_{w_idx}", (0.12, 0.04, 1.60), (W * 0.5 + 0.01, 1.625, win_z), mats['aluminum_brushed'], root_group)
        # Glass Panes (Transparent PBR)
        create_box(f"Window_Glass_{w_idx}", (0.01, 1.30, 1.54), (W * 0.5 + 0.01, 1.625, win_z), mats['window_glass'], root_group)

def build_front_whiteboard_and_clock(mats, root_group):
    """Builds front university whiteboard/chalkboard combo with aluminum tray and stopped wall clock."""
    D = 7.6

    # 1. Whiteboard / Chalkboard combo (4.2m wide x 1.25m tall x 0.04m deep) mounted at Z = -3.76m, Y = 1.85m
    board_z = -D * 0.5 + 0.03
    # Aluminum border frame
    create_box("Whiteboard_Frame", (4.24, 1.29, 0.03), (0, 1.85, board_z), mats['aluminum_brushed'], root_group)
    # Left Section: Whiteboard (2.2m wide)
    create_box("Whiteboard_Surface", (2.10, 1.21, 0.02), (-1.02, 1.85, board_z + 0.01), mats['whiteboard_surface'], root_group)
    # Right Section: Green Chalkboard (2.0m wide)
    create_box("Chalkboard_Surface", (1.98, 1.21, 0.02), (1.05, 1.85, board_z + 0.01), mats['chalkboard_surface'], root_group)
    # Horizontal divider strip
    create_box("Board_Divider", (0.03, 1.21, 0.025), (0.04, 1.85, board_z + 0.012), mats['aluminum_brushed'], root_group)
    # Marker / Chalk Tray along bottom
    create_box("Board_Tray", (4.24, 0.03, 0.10), (0, 1.21, board_z + 0.05), mats['aluminum_brushed'], root_group)
    # Eraser and markers on tray
    create_box("Board_Eraser", (0.14, 0.04, 0.06), (-0.45, 1.245, board_z + 0.05), mats['steel_frame'], root_group)
    create_cylinder("Board_Marker_Blue", 0.01, 0.12, (0.25, 1.235, board_z + 0.05), (0, 0, math.pi*0.5), 8, mats['wood_desk_top'], root_group)

    # 2. Wall Clock mounted centered above whiteboard at X = 0, Y = 2.75m, Z = -3.76m
    # Stopped at 10:17
    clock_z = -D * 0.5 + 0.035
    clock_body = create_cylinder("Wall_Clock_Rim", 0.22, 0.04, (0, 2.75, clock_z), (math.pi*0.5, 0, 0), 24, mats['aluminum_brushed'], root_group)
    clock_face = create_cylinder("Wall_Clock_Dial", 0.20, 0.01, (0, 2.75, clock_z + 0.016), (math.pi*0.5, 0, 0), 24, mats['clock_dial'], root_group)
    clock_glass = create_cylinder("Wall_Clock_Glass", 0.20, 0.005, (0, 2.75, clock_z + 0.022), (math.pi*0.5, 0, 0), 24, mats['window_glass'], root_group)

    # Hands pointing to 10:17 (Hour hand ~310 deg, Minute hand ~102 deg)
    # Hour hand (shorter, thicker)
    hr_rot = math.radians(310)
    create_box(
        "Clock_Hand_Hour",
        (0.012, 0.08, 0.003),
        (math.sin(hr_rot) * 0.035, 2.75 + math.cos(hr_rot) * 0.035, clock_z + 0.018),
        mats['clock_hands'],
        root_group
    ).rotation_euler = (0, 0, -hr_rot)

    # Minute hand (longer, slender)
    min_rot = math.radians(102)
    create_box(
        "Clock_Hand_Minute",
        (0.008, 0.12, 0.003),
        (math.sin(min_rot) * 0.05, 2.75 + math.cos(min_rot) * 0.05, clock_z + 0.019),
        mats['clock_hands'],
        root_group
    ).rotation_euler = (0, 0, -min_rot)

def build_teacher_desk_and_podium(mats, root_group):
    """Builds teacher podium, lecture desk, interactive drawer, and teacher chair."""
    t_desk_x = -1.0
    t_desk_z = -2.6
    dais_top = 0.14

    # 1. Teacher Lecture Desk
    desk_root = bpy.data.objects.new("TeacherDesk", None)
    desk_root.location = Vector((t_desk_x, dais_top, t_desk_z))
    bpy.context.scene.collection.objects.link(desk_root)
    desk_root.parent = root_group

    # Wood Desktop: 1.40m wide x 0.75m deep x 0.035m thick at Y = 0.76m
    create_box("TeacherDesk_Top", (1.40, 0.035, 0.75), (0, 0.74, 0), mats['wood_varnish'], desk_root)

    # Steel frame legs & modesty panel
    # Left & Right legs
    create_box("TeacherDesk_Leg_L", (0.04, 0.72, 0.65), (-0.64, 0.36, 0), mats['steel_frame'], desk_root)
    create_box("TeacherDesk_Leg_R", (0.04, 0.72, 0.65), (0.64, 0.36, 0), mats['steel_frame'], desk_root)
    # Front modesty panel
    create_box("TeacherDesk_ModestyPanel", (1.24, 0.45, 0.02), (0, 0.45, -0.32), mats['wood_varnish'], desk_root)

    # 2. Interactive Drawer Pedestal Unit (Right side)
    # Pedestal casing: X in [0.20, 0.64], Y in [0.20, 0.72], Z in [-0.30, 0.30]
    create_box("TeacherDesk_Pedestal", (0.42, 0.50, 0.60), (0.42, 0.46, 0.02), mats['wood_varnish'], desk_root)

    # Interactive Pull-Out Drawer Mesh: slides along -Z (toward teacher chair)
    drawer_obj = create_box(
        "TeacherDesk_Drawer",
        (0.38, 0.16, 0.52),
        (0.42, 0.58, 0.02),
        mats['wood_varnish'],
        desk_root
    )
    # Drawer Handle
    create_box("TeacherDesk_Drawer_Handle", (0.12, 0.02, 0.02), (0.42, 0.58, 0.29), mats['aluminum_brushed'], drawer_obj)

    # 3. Item: Main Switchboard Brass Key (inside drawer or on top)
    create_cylinder("Item_Brass_Key", 0.015, 0.07, (0.42, 0.52, 0.05), (math.pi*0.5, 0, 0.4), 8, mats['brass_key'], drawer_obj)

    # 4. Desk Props: Open Attendance Register Book
    create_box("TeacherDesk_Book", (0.32, 0.02, 0.24), (-0.25, 0.765, 0.05), mats['paper_sheet'], desk_root)

    # 5. Teacher Ergonomic Chair
    chair_root = bpy.data.objects.new("TeacherChair", None)
    chair_root.location = Vector((t_desk_x, dais_top, t_desk_z + 0.62))
    bpy.context.scene.collection.objects.link(chair_root)
    chair_root.parent = root_group

    create_box("TeacherChair_Seat", (0.48, 0.04, 0.46), (0, 0.44, 0), mats['wood_varnish'], chair_root)
    create_box("TeacherChair_Back", (0.46, 0.34, 0.03), (0, 0.72, 0.20), mats['wood_varnish'], chair_root)
    # Tubular steel chair legs
    for lx in [-0.20, 0.20]:
        for lz in [-0.18, 0.18]:
            create_cylinder(f"TeacherChair_Leg_{lx}_{lz}", 0.016, 0.44, (lx, 0.22, lz), (0, 0, 0), 10, mats['steel_frame'], chair_root)

def build_student_workstations(mats, root_group):
    """
    Builds 6 student workstations arranged in 3 columns x 2 rows.
    Guarantees >= 1.05m aisle clearance and realistic dual desks + chairs.
    """
    col_x = [-2.15, 0.0, 2.15]
    row_z = [-0.70, 1.25]

    st_idx = 1
    for r_i, rz in enumerate(row_z):
        for c_i, cx in enumerate(col_x):
            desk_name = f"StudentDesk_{st_idx}"
            desk_root = bpy.data.objects.new(desk_name, None)
            desk_root.location = Vector((cx, 0, rz))
            bpy.context.scene.collection.objects.link(desk_root)
            desk_root.parent = root_group

            # 1. Desktop: 1.10m wide x 0.52m deep x 0.028m thick at Y = 0.75m
            create_box(f"{desk_name}_Top", (1.10, 0.028, 0.52), (0, 0.736, 0), mats['wood_desk_top'], desk_root)

            # 2. Modesty Panel
            create_box(f"{desk_name}_Modesty", (1.02, 0.32, 0.018), (0, 0.52, -0.22), mats['wood_desk_top'], desk_root)

            # 3. Book Storage Wire Shelf Rack under desk
            create_box(f"{desk_name}_Shelf", (1.00, 0.015, 0.38), (0, 0.42, 0.02), mats['steel_frame'], desk_root)

            # 4. Steel tubular frame legs (C-frame cantilever or 4 legs)
            for lx in [-0.50, 0.50]:
                create_cylinder(f"{desk_name}_Leg_{lx}_F", 0.018, 0.72, (lx, 0.36, -0.20), (0,0,0), 10, mats['steel_frame'], desk_root)
                create_cylinder(f"{desk_name}_Leg_{lx}_B", 0.018, 0.72, (lx, 0.36, 0.20), (0,0,0), 10, mats['steel_frame'], desk_root)
                create_box(f"{desk_name}_Foot_{lx}", (0.04, 0.02, 0.48), (lx, 0.01, 0), mats['steel_frame'], desk_root)

            # 5. Dual Student Chairs behind desk (at Z = +0.48m)
            for ch_side, ch_x in [("L", -0.30), ("R", 0.30)]:
                create_box(f"{desk_name}_Chair_{ch_side}_Seat", (0.40, 0.03, 0.38), (ch_x, 0.44, 0.48), mats['wood_varnish'], desk_root)
                create_box(f"{desk_name}_Chair_{ch_side}_Back", (0.38, 0.26, 0.02), (ch_x, 0.68, 0.65), mats['wood_varnish'], desk_root)
                for clx in [ch_x - 0.16, ch_x + 0.16]:
                    for clz in [0.34, 0.62]:
                        create_cylinder(f"{desk_name}_Chair_{ch_side}_Leg", 0.014, 0.44, (clx, 0.22, clz), (0,0,0), 8, mats['steel_frame'], desk_root)

            # 6. Props on desk (Notebooks, pens, backpacks)
            if (st_idx % 2 == 1):
                # Notebook on desk
                create_box(f"{desk_name}_Notebook", (0.22, 0.012, 0.16), (-0.28, 0.755, 0.04), mats['paper_sheet'], desk_root)
                # Backpack beside chair
                b_mat = mats['backpack_navy'] if st_idx % 3 == 0 else mats['backpack_maroon']
                create_box(f"{desk_name}_Backpack", (0.32, 0.40, 0.22), (cx + 0.55, 0.20, rz + 0.45), b_mat, root_group)
            else:
                create_box(f"{desk_name}_Textbook", (0.24, 0.025, 0.18), (0.26, 0.76, -0.02), mats['wood_varnish'], desk_root)

            st_idx += 1

def build_noticeboard_and_back_wall(mats, root_group):
    """Builds noticeboard with pinned paper notices, wall cupboard, and bookshelves on back wall."""
    D = 7.6

    # 1. University Noticeboard on Back Wall (Z = +3.76m, X = 0.5m, Y = 1.80m)
    board_z = D * 0.5 - 0.03
    create_box("Noticeboard_Frame", (1.84, 1.14, 0.04), (0.50, 1.80, board_z), mats['wood_varnish'], root_group)
    create_box("Noticeboard_Felt", (1.74, 1.04, 0.02), (0.50, 1.80, board_z - 0.01), mats['noticeboard_felt'], root_group)

    # 3 Pinned Notices
    for p_i, px in enumerate([0.15, 0.50, 0.85]):
        p_note = create_box(f"Notice_Sheet_{p_i+1}", (0.24, 0.32, 0.004), (px, 1.82 + (p_i - 1) * 0.04, board_z - 0.02), mats['paper_sheet'], root_group)
        p_note.rotation_euler = (0, 0, (p_i - 1) * 0.05)

    # 2. Departmental Storage Cupboard along West wall near rear (X = -3.55m, Z = 2.4m)
    create_box("Storage_Cupboard", (0.50, 1.85, 1.00), (-3.50, 0.925, 2.40), mats['steel_frame'], root_group)
    create_box("Storage_Cupboard_Door_L", (0.02, 1.75, 0.46), (-3.24, 0.925, 2.16), mats['aluminum_brushed'], root_group)
    create_box("Storage_Cupboard_Door_R", (0.02, 1.75, 0.46), (-3.24, 0.925, 2.64), mats['aluminum_brushed'], root_group)

    # 3. Wall Shelves with Books along Back Wall (X in [-3.0, -1.2])
    create_box("Wall_Shelf_Lower", (1.60, 0.03, 0.24), (-2.20, 1.60, board_z - 0.12), mats['wood_varnish'], root_group)
    create_box("Wall_Shelf_Upper", (1.60, 0.03, 0.24), (-2.20, 2.10, board_z - 0.12), mats['wood_varnish'], root_group)
    # Books on lower shelf
    create_box("Book_Stack_1", (0.45, 0.24, 0.18), (-2.50, 1.73, board_z - 0.10), mats['wall_dado'], root_group)
    create_box("Book_Stack_2", (0.55, 0.22, 0.18), (-1.90, 1.72, board_z - 0.10), mats['backpack_navy'], root_group)

def build_ceiling_equipment(mats, root_group):
    """Builds 3 twin fluorescent tube fixtures, wiring conduits, and 2 animated ceiling fans."""
    # 1. Fluorescent Troffer Fixtures at Z = [-2.20, 0.0, 2.20], centered at X = 0, Y = 3.30m
    for f_i, fz in enumerate([-2.20, 0.0, 2.20], start=1):
        # Housing
        create_box(f"TubeLight_Fixture_{f_i}", (1.30, 0.06, 0.22), (0, 3.31, fz), mats['light_fixture_housing'], root_group)
        # Twin Fluorescent Lamps
        create_cylinder(f"TubeLight_Lamp_{f_i}_A", 0.016, 1.20, (0, 3.27, fz - 0.05), (0, 0, math.pi*0.5), 12, mats['fluorescent_emissive'], root_group)
        create_cylinder(f"TubeLight_Lamp_{f_i}_B", 0.016, 1.20, (0, 3.27, fz + 0.05), (0, 0, math.pi*0.5), 12, mats['fluorescent_emissive'], root_group)

    # 2. Ceiling Fans: Spaced at Z = -1.20m and Z = +1.20m, centered at X = 0
    for fan_i, fan_z in enumerate([-1.20, 1.20], start=1):
        fan_root = bpy.data.objects.new(f"CeilingFan_{fan_i}", None)
        fan_root.location = Vector((0, 3.35, fan_z))
        bpy.context.scene.collection.objects.link(fan_root)
        fan_root.parent = root_group

        # Ceiling Mount Rosette & Downrod
        create_cylinder(f"CeilingFan_Mount_{fan_i}", 0.10, 0.04, (0, -0.02, 0), (0,0,0), 16, mats['steel_frame'], fan_root)
        create_cylinder(f"CeilingFan_Rod_{fan_i}", 0.016, 0.34, (0, -0.19, 0), (0,0,0), 10, mats['steel_frame'], fan_root)

        # Separate Rotatable Hub Mesh (so Three.js can animate fan rotation cleanly)
        hub_obj = create_cylinder(f"CeilingFan_Hub_{fan_i}", 0.12, 0.08, (0, -0.38, 0), (0,0,0), 16, mats['steel_frame'], fan_root)

        # 3 Aerodynamic Blades attached to Hub
        for b_idx in range(3):
            b_angle = b_idx * (2.0 * math.pi / 3.0)
            blade = create_box(
                f"CeilingFan_{fan_i}_Blade_{b_idx+1}",
                (0.14, 0.012, 0.65),
                (math.sin(b_angle) * 0.40, -0.01, math.cos(b_angle) * 0.40),
                mats['steel_frame'],
                hub_obj
            )
            blade.rotation_euler = (0.12, b_angle, 0) # slight pitch angle

def build_switchboard_and_dustbins(mats, root_group):
    """Builds sub-breaker switchboard near door and 2 classroom waste bins."""
    W = 7.6

    # 1. Electrical Sub-Panel Switchboard on West Wall at X = -3.76m, Y = 1.35m, Z = -1.85m (right beside door)
    sw_x = -W * 0.5 + 0.05
    sw_box = create_box("Switchboard_Panel", (0.08, 0.42, 0.32), (sw_x, 1.35, -1.85), mats['switchboard_metal'], root_group)
    # Conduit pipe running up to ceiling
    create_cylinder("Switchboard_Conduit", 0.015, 2.00, (sw_x - 0.01, 2.35, -1.85), (0,0,0), 10, mats['switchboard_metal'], root_group)

    # Main Red Breaker switch + 4 miniature circuit breakers
    create_box("Switchboard_Main_Breaker", (0.03, 0.08, 0.04), (sw_x + 0.045, 1.42, -1.92), mats['breaker_red'], sw_box)
    for bk_i, bk_z in enumerate([-1.86, -1.82, -1.78, -1.74]):
        create_box(f"Switchboard_Breaker_{bk_i+1}", (0.025, 0.04, 0.02), (sw_x + 0.045, 1.32, bk_z), mats['breaker_black'], sw_box)

    # Interactive Switchboard Cover Door
    create_box("Switchboard_Door", (0.01, 0.40, 0.30), (sw_x + 0.045, 1.35, -1.85), mats['aluminum_brushed'], sw_box)

    # 2. Dustbin near Teacher Desk
    create_cylinder("Dustbin_Teacher", 0.16, 0.40, (-2.0, 0.20, -3.20), (0,0,0), 16, mats['dustbin_body'], root_group)
    # Inner rim / liner
    create_cylinder("Dustbin_Teacher_Liner", 0.155, 0.02, (-2.0, 0.39, -3.20), (0,0,0), 16, mats['steel_frame'], root_group)

    # 3. Dustbin near Entrance Door
    create_cylinder("Dustbin_Entrance", 0.16, 0.40, (-3.40, 0.20, -1.85), (0,0,0), 16, mats['dustbin_body'], root_group)

def construct_full_classroom():
    """Main builder function assembling the entire scene."""
    from classroom_materials import build_classroom_material_library, get_or_create_gltf_output_group

    print("[Builder] Initializing factory scene...")
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Ensure glTF Material Output group is available
    get_or_create_gltf_output_group()

    # Create Material Library
    mats = build_classroom_material_library()

    # Create Master Root Group
    root_group = bpy.data.objects.new("ProductionClassroomRoot", None)
    bpy.context.scene.collection.objects.link(root_group)

    print("[Builder] Constructing architectural shell...")
    build_architectural_shell(mats, root_group)

    print("[Builder] Constructing doors and windows...")
    build_doors_and_windows(mats, root_group)

    print("[Builder] Constructing whiteboard and wall clock...")
    build_front_whiteboard_and_clock(mats, root_group)

    print("[Builder] Constructing teacher desk, podium, and drawer...")
    build_teacher_desk_and_podium(mats, root_group)

    print("[Builder] Constructing student workstations...")
    build_student_workstations(mats, root_group)

    print("[Builder] Constructing noticeboard and back wall...")
    build_noticeboard_and_back_wall(mats, root_group)

    print("[Builder] Constructing ceiling lighting and fans...")
    build_ceiling_equipment(mats, root_group)

    print("[Builder] Constructing switchboard and dustbins...")
    build_switchboard_and_dustbins(mats, root_group)

    print(f"[Builder] Assembly complete! Total objects in scene: {len(bpy.data.objects)}")
    return root_group

