"""
Production Classroom Geometry Builder for Blender.
Constructs architectural structure, wall openings, doors, windows, desks,
chairs, whiteboard, clock, fans, tube lights, switchboard, dustbins, and props.

Coordinate System Mapping:
Blender native (Z is Up, X is East-West, Y is North-South):
- Width:  X in [-3.8m, +3.8m] (7.6m)  --> Three.js X in [-3.8m, +3.8m] (Width = 7.6m)
- Depth:  Y in [-3.8m, +3.8m] (7.6m)  --> Three.js Z in [-3.8m, +3.8m] (Depth = 7.6m)
- Height: Z in [0.0m,  +3.35m] (3.35m) --> Three.js Y in [0.0m,  +3.35m] (Height = 3.35m)
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
      X = Width (-3.8 to +3.8)
      Y = Depth (-3.8 = South/Back, +3.8 = North/Front Teaching wall)
      Z = Height (0 = Floor, 3.35 = Ceiling)
    """
    W = 7.6   # Room width
    D = 7.6   # Room depth
    H = 3.35  # Ceiling height
    T = 0.20  # Wall thickness
    dado_h = 1.05

    # 1. Floor Slab (top walking surface at Z = 0)
    create_box(
        "Classroom_Floor",
        (W + 0.4, D + 0.4, 0.15),
        (0, 0, -0.075),
        mats['floor_terrazzo'],
        root_group
    )

    # 2. Drop Acoustic Ceiling at Z = H
    create_box(
        "Classroom_Ceiling",
        (W, D, 0.08),
        (0, 0, H + 0.04),
        mats['ceiling_tile'],
        root_group
    )

    # 3. North (Front / Teaching) Wall at Y = +3.8m
    # Lower Dado Wall
    create_box(
        "Wall_North_Dado",
        (W + T * 2, T, dado_h),
        (0, D * 0.5 + T * 0.5, dado_h * 0.5),
        mats['wall_dado'],
        root_group
    )
    # Upper Plaster Wall
    create_box(
        "Wall_North_Upper",
        (W + T * 2, T, H - dado_h),
        (0, D * 0.5 + T * 0.5, dado_h + (H - dado_h) * 0.5),
        mats['wall_plaster'],
        root_group
    )

    # 4. South (Back) Wall at Y = -3.8m
    # Lower Dado Wall
    create_box(
        "Wall_South_Dado",
        (W + T * 2, T, dado_h),
        (0, -D * 0.5 - T * 0.5, dado_h * 0.5),
        mats['wall_dado'],
        root_group
    )
    # Upper Plaster Wall
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

    # 7. West (Left / Entrance) Wall at X = -3.8m with Doorway Opening
    # Doorway: Y in [2.20m, 3.20m] (width = 1.0m, height = 2.15m in Z)
    # Segment 1: North of door (Y: 3.20 to 3.80, depth = 0.60m)
    create_box("Wall_West_Dado_1", (T, 0.60, dado_h), (-W * 0.5 - T * 0.5, 3.50, dado_h * 0.5), mats['wall_dado'], root_group)
    create_box("Wall_West_Upper_1", (T, 0.60, H - dado_h), (-W * 0.5 - T * 0.5, 3.50, dado_h + (H - dado_h) * 0.5), mats['wall_plaster'], root_group)
    # Segment 2: South of door (Y: -3.80 to 2.20, depth = 6.0m)
    create_box("Wall_West_Dado_2", (T, 6.00, dado_h), (-W * 0.5 - T * 0.5, -0.80, dado_h * 0.5), mats['wall_dado'], root_group)
    create_box("Wall_West_Upper_2", (T, 6.00, H - dado_h), (-W * 0.5 - T * 0.5, -0.80, dado_h + (H - dado_h) * 0.5), mats['wall_plaster'], root_group)
    # Transom lintel above door: Z from 2.15m to H (height = 1.20m), Y from 2.20 to 3.20
    create_box("Wall_West_Door_Transom", (T, 1.00, H - 2.15), (-W * 0.5 - T * 0.5, 2.70, 2.15 + (H - 2.15) * 0.5), mats['wall_plaster'], root_group)
    # West Dado Molding & Skirting
    create_box("Molding_Dado_West", (0.025, 6.00, 0.04), (-W * 0.5 + 0.0125, -0.80, dado_h), mats['trim_wood'], root_group)
    create_box("Skirting_West", (0.02, 6.00, 0.08), (-W * 0.5 + 0.01, -0.80, 0.04), mats['trim_wood'], root_group)

    # 8. East (Right / Exterior Window) Wall at X = +3.8m with 2 Large Window Openings
    # Window 1: Y in [0.80m, 2.40m], Window 2: Y in [-2.40m, -0.80m]
    # Window sill at Z = 0.95m, window head at Z = 2.30m
    # Solid piers
    create_box("Wall_East_Dado_1", (T, 1.40, dado_h), (W * 0.5 + T * 0.5, 3.10, dado_h * 0.5), mats['wall_dado'], root_group)
    create_box("Wall_East_Upper_1", (T, 1.40, H - dado_h), (W * 0.5 + T * 0.5, 3.10, dado_h + (H - dado_h) * 0.5), mats['wall_plaster'], root_group)
    create_box("Wall_East_Dado_2", (T, 1.60, dado_h), (W * 0.5 + T * 0.5, 0.00, dado_h * 0.5), mats['wall_dado'], root_group)
    create_box("Wall_East_Upper_2", (T, 1.60, H - dado_h), (W * 0.5 + T * 0.5, 0.00, dado_h + (H - dado_h) * 0.5), mats['wall_plaster'], root_group)
    create_box("Wall_East_Dado_3", (T, 1.40, dado_h), (W * 0.5 + T * 0.5, -3.10, dado_h * 0.5), mats['wall_dado'], root_group)
    create_box("Wall_East_Upper_3", (T, 1.40, H - dado_h), (W * 0.5 + T * 0.5, -3.10, dado_h + (H - dado_h) * 0.5), mats['wall_plaster'], root_group)

    # Window Spandrels (below sill, Z: 0 to 0.95m)
    create_box("Wall_East_Spandrel_1", (T, 1.60, 0.95), (W * 0.5 + T * 0.5, 1.60, 0.475), mats['wall_dado'], root_group)
    create_box("Wall_East_Spandrel_2", (T, 1.60, 0.95), (W * 0.5 + T * 0.5, -1.60, 0.475), mats['wall_dado'], root_group)

    # Window Lintels (above head, Z: 2.30m to H)
    create_box("Wall_East_Lintel_1", (T, 1.60, H - 2.30), (W * 0.5 + T * 0.5, 1.60, 2.30 + (H - 2.30) * 0.5), mats['wall_plaster'], root_group)
    create_box("Wall_East_Lintel_2", (T, 1.60, H - 2.30), (W * 0.5 + T * 0.5, -1.60, 2.30 + (H - 2.30) * 0.5), mats['wall_plaster'], root_group)

    # East Dado Moldings & Skirtings on piers
    for y_c, y_len in [(3.10, 1.40), (0.00, 1.60), (-3.10, 1.40)]:
        create_box(f"Molding_Dado_East_{y_c}", (0.025, y_len, 0.04), (W * 0.5 - 0.0125, y_c, dado_h), mats['trim_wood'], root_group)
        create_box(f"Skirting_East_{y_c}", (0.02, y_len, 0.08), (W * 0.5 - 0.01, y_c, 0.04), mats['trim_wood'], root_group)

    # 9. Lecture Dais (Raised Teaching Platform at front, Y = +3.8m)
    create_box(
        "Lecture_Dais",
        (5.4, 1.40, 0.14),
        (0, D * 0.5 - 0.70 - 0.05, 0.07),
        mats['dais_concrete'],
        root_group
    )

def build_doors_and_windows(mats, root_group):
    """Builds realistic door frame, interactive hinged door leaf, and 2 glazed windows."""
    W = 7.6
    D = 7.6

    # 1. Door Frame at X = -3.8m, Y in [2.20m, 3.20m], height 2.15m in Z
    frame_th = 0.06
    frame_depth = 0.22
    # North jamb (Y = 3.20)
    create_box("Door_Frame_Jamb_N", (frame_depth, frame_th, 2.15), (-W * 0.5 - 0.01, 3.20 - frame_th * 0.5, 1.075), mats['aluminum_brushed'], root_group)
    # South jamb (Y = 2.20)
    create_box("Door_Frame_Jamb_S", (frame_depth, frame_th, 2.15), (-W * 0.5 - 0.01, 2.20 + frame_th * 0.5, 1.075), mats['aluminum_brushed'], root_group)
    # Head jamb
    create_box("Door_Frame_Head", (frame_depth, 1.00, frame_th), (-W * 0.5 - 0.01, 2.70, 2.15 - frame_th * 0.5), mats['aluminum_brushed'], root_group)
    # Floor threshold
    create_box("Door_Threshold", (frame_depth + 0.04, 1.00, 0.02), (-W * 0.5 - 0.01, 2.70, 0.01), mats['aluminum_brushed'], root_group)

    # 2. Interactive Hinged Door Leaf
    # Width = 0.94m along Y, Height = 2.10m along Z, Thickness = 0.045m along X
    # Hinge is at North jamb edge (X = -3.78, Y = 3.17, Z = 0.01).
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    door_leaf = bpy.context.active_object
    door_leaf.name = "Door_Leaf_Classroom"
    door_leaf.data.materials.append(mats['wood_varnish'])
    door_leaf.parent = root_group

    me = door_leaf.data
    bm = bmesh.new()
    bm.from_mesh(me)
    # Pivot at hinge (0, 0, 0)
    for v in bm.verts:
        v.co.x = (v.co.x + 0.5) * 0.045 - 0.0225
        v.co.y = (v.co.y - 0.5) * 0.94  # extends along -Y from hinge
        v.co.z = (v.co.z + 0.5) * 2.10  # extends along +Z
    bm.to_mesh(me)
    bm.free()
    door_leaf.location = Vector((-W * 0.5 + 0.02, 3.17, 0.01))
    door_leaf.rotation_euler = (0, 0, 0)

    # Door Handle Hardware
    create_box("Door_Handle_Escutcheon", (0.012, 0.04, 0.18), (0.025, -0.84, 0.98), mats['aluminum_brushed'], door_leaf)
    create_box("Door_Handle_Lever", (0.08, 0.12, 0.02), (0.065, -0.88, 0.98), mats['aluminum_brushed'], door_leaf)

    # 3. Two Windows on East Wall at X = +3.8m (Y = 1.6m and Y = -1.6m)
    # Window opening: 1.60m wide in Y, 1.35m high in Z (Z: 0.95m to 2.30m)
    # Open hollow aluminum frames with jambs, head, sill, mullion, transom, and glazed glass
    f_th = 0.045
    f_d = 0.18
    for w_idx, win_y in enumerate([1.60, -1.60], start=1):
        # Outer aluminum frame perimeter
        create_box(f"Window_Frame_Head_{w_idx}", (f_d, 1.60, f_th), (W * 0.5 + 0.01, win_y, 2.30 - f_th * 0.5), mats['aluminum_brushed'], root_group)
        create_box(f"Window_Frame_Sill_{w_idx}", (f_d, 1.60, f_th), (W * 0.5 + 0.01, win_y, 0.95 + f_th * 0.5), mats['aluminum_brushed'], root_group)
        create_box(f"Window_Frame_Jamb_L_{w_idx}", (f_d, f_th, 1.35 - 2 * f_th), (W * 0.5 + 0.01, win_y - 0.80 + f_th * 0.5, 1.625), mats['aluminum_brushed'], root_group)
        create_box(f"Window_Frame_Jamb_R_{w_idx}", (f_d, f_th, 1.35 - 2 * f_th), (W * 0.5 + 0.01, win_y + 0.80 - f_th * 0.5, 1.625), mats['aluminum_brushed'], root_group)
        # Interior sill ledge
        create_box(f"Window_Sill_{w_idx}", (0.24, 1.68, 0.04), (W * 0.5 - 0.04, win_y, 0.95), mats['trim_wood'], root_group)
        # Central mullion & transom
        create_box(f"Window_Mullion_{w_idx}", (0.12, 0.04, 1.35 - 2 * f_th), (W * 0.5 + 0.01, win_y, 1.625), mats['aluminum_brushed'], root_group)
        create_box(f"Window_Transom_{w_idx}", (0.12, 1.60 - 2 * f_th, 0.04), (W * 0.5 + 0.01, win_y, 1.625), mats['aluminum_brushed'], root_group)
        # Glass Panes (Transparent PBR)
        create_box(f"Window_Glass_{w_idx}", (0.01, 1.51, 1.26), (W * 0.5 + 0.01, win_y, 1.625), mats['window_glass'], root_group)

def build_front_whiteboard_and_clock(mats, root_group):
    """Builds front university whiteboard/chalkboard combo with aluminum tray and stopped wall clock."""
    D = 7.6

    # Whiteboard / Chalkboard combo mounted at North wall (Y = +3.76m, Z = 1.85m)
    board_y = D * 0.5 - 0.03
    create_box("Whiteboard_Frame", (4.24, 0.03, 1.29), (0, board_y, 1.85), mats['aluminum_brushed'], root_group)
    create_box("Whiteboard_Surface", (2.10, 0.02, 1.21), (-1.02, board_y - 0.01, 1.85), mats['whiteboard_surface'], root_group)
    create_box("Chalkboard_Surface", (1.98, 0.02, 1.21), (1.05, board_y - 0.01, 1.85), mats['chalkboard_surface'], root_group)
    create_box("Board_Divider", (0.03, 0.025, 1.21), (0.04, board_y - 0.012, 1.85), mats['aluminum_brushed'], root_group)
    create_box("Board_Tray", (4.24, 0.10, 0.03), (0, board_y - 0.05, 1.21), mats['aluminum_brushed'], root_group)
    create_box("Board_Eraser", (0.14, 0.06, 0.04), (-0.45, board_y - 0.05, 1.245), mats['steel_frame'], root_group)
    create_cylinder("Board_Marker_Blue", 0.01, 0.12, (0.25, board_y - 0.05, 1.235), (0, math.pi*0.5, 0), 8, mats['wood_desk_top'], root_group)

    # Wall Clock mounted above board at X = 0, Y = +3.76m, Z = 2.75m (Hands at 10:17)
    clock_y = D * 0.5 - 0.035
    create_cylinder("Wall_Clock_Rim", 0.22, 0.04, (0, clock_y, 2.75), (math.pi*0.5, 0, 0), 24, mats['aluminum_brushed'], root_group)
    create_cylinder("Wall_Clock_Dial", 0.20, 0.01, (0, clock_y - 0.016, 2.75), (math.pi*0.5, 0, 0), 24, mats['clock_dial'], root_group)
    create_cylinder("Wall_Clock_Glass", 0.20, 0.005, (0, clock_y - 0.022, 2.75), (math.pi*0.5, 0, 0), 24, mats['window_glass'], root_group)

    # Hands pointing to 10:17
    hr_rot = math.radians(310)
    create_box(
        "Clock_Hand_Hour",
        (0.012, 0.003, 0.08),
        (math.sin(hr_rot) * 0.035, clock_y - 0.018, 2.75 + math.cos(hr_rot) * 0.035),
        mats['clock_hands'],
        root_group
    ).rotation_euler = (0, -hr_rot, 0)

    min_rot = math.radians(102)
    create_box(
        "Clock_Hand_Minute",
        (0.008, 0.003, 0.12),
        (math.sin(min_rot) * 0.05, clock_y - 0.019, 2.75 + math.cos(min_rot) * 0.05),
        mats['clock_hands'],
        root_group
    ).rotation_euler = (0, -min_rot, 0)

def build_teacher_desk_and_podium(mats, root_group):
    """Builds teacher lecture desk, drawer, chair, register book, and key."""
    t_desk_x = -1.0
    t_desk_y = 2.6
    dais_top = 0.14

    desk_root = bpy.data.objects.new("TeacherDesk", None)
    desk_root.location = Vector((t_desk_x, t_desk_y, dais_top))
    bpy.context.scene.collection.objects.link(desk_root)
    desk_root.parent = root_group

    # Desktop: 1.40m wide x 0.75m deep in Y x 0.035m thick in Z at Z = 0.74m
    create_box("TeacherDesk_Top", (1.40, 0.75, 0.035), (0, 0, 0.74), mats['wood_varnish'], desk_root)
    # Legs & modesty panel
    create_box("TeacherDesk_Leg_L", (0.04, 0.65, 0.72), (-0.64, 0, 0.36), mats['steel_frame'], desk_root)
    create_box("TeacherDesk_Leg_R", (0.04, 0.65, 0.72), (0.64, 0, 0.36), mats['steel_frame'], desk_root)
    create_box("TeacherDesk_ModestyPanel", (1.24, 0.02, 0.45), (0, 0.32, 0.45), mats['wood_varnish'], desk_root)

    # Pedestal casing
    create_box("TeacherDesk_Pedestal", (0.42, 0.60, 0.50), (0.42, -0.02, 0.46), mats['wood_varnish'], desk_root)

    # Interactive Drawer Mesh: slides along -Y
    drawer_obj = create_box(
        "TeacherDesk_Drawer",
        (0.38, 0.52, 0.16),
        (0.42, -0.02, 0.58),
        mats['wood_varnish'],
        desk_root
    )
    # Drawer Handle
    create_box("TeacherDesk_Drawer_Handle", (0.12, 0.02, 0.02), (0.42, -0.29, 0.58), mats['aluminum_brushed'], drawer_obj)

    # Key inside drawer
    create_cylinder("Item_Brass_Key", 0.015, 0.07, (0.42, -0.05, 0.52), (0, math.pi*0.5, 0.4), 8, mats['brass_key'], drawer_obj)

    # Open Attendance Register Book
    create_box("TeacherDesk_Book", (0.32, 0.24, 0.02), (-0.25, -0.05, 0.765), mats['paper_sheet'], desk_root)

    # Teacher Chair behind desk
    chair_root = bpy.data.objects.new("TeacherChair", None)
    chair_root.location = Vector((t_desk_x, t_desk_y - 0.62, dais_top))
    bpy.context.scene.collection.objects.link(chair_root)
    chair_root.parent = root_group

    create_box("TeacherChair_Seat", (0.48, 0.46, 0.04), (0, 0, 0.44), mats['wood_varnish'], chair_root)
    create_box("TeacherChair_Back", (0.46, 0.03, 0.34), (0, -0.20, 0.72), mats['wood_varnish'], chair_root)
    for lx in [-0.20, 0.20]:
        for ly in [-0.18, 0.18]:
            create_cylinder(f"TeacherChair_Leg_{lx}_{ly}", 0.016, 0.44, (lx, ly, 0.22), (0,0,0), 10, mats['steel_frame'], chair_root)

def build_student_workstations(mats, root_group):
    """
    Builds 6 student workstations arranged in 3 columns x 2 rows.
    Guarantees >= 1.05m aisle clearance and realistic dual desks + chairs.
    """
    col_x = [-2.15, 0.0, 2.15]
    row_y = [0.70, -1.25]

    st_idx = 1
    for r_i, ry in enumerate(row_y):
        for c_i, cx in enumerate(col_x):
            desk_name = f"StudentDesk_{st_idx}"
            desk_root = bpy.data.objects.new(desk_name, None)
            desk_root.location = Vector((cx, ry, 0))
            bpy.context.scene.collection.objects.link(desk_root)
            desk_root.parent = root_group

            # Desktop: 1.10m wide x 0.52m deep in Y x 0.028m in Z at Z = 0.736m
            create_box(f"{desk_name}_Top", (1.10, 0.52, 0.028), (0, 0, 0.736), mats['wood_desk_top'], desk_root)
            # Modesty panel
            create_box(f"{desk_name}_Modesty", (1.02, 0.018, 0.32), (0, 0.22, 0.52), mats['wood_desk_top'], desk_root)
            # Book shelf under desk
            create_box(f"{desk_name}_Shelf", (1.00, 0.38, 0.015), (0, -0.02, 0.42), mats['steel_frame'], desk_root)

            # Frame legs
            for lx in [-0.50, 0.50]:
                create_cylinder(f"{desk_name}_Leg_{lx}_F", 0.018, 0.72, (lx, 0.20, 0.36), (0,0,0), 10, mats['steel_frame'], desk_root)
                create_cylinder(f"{desk_name}_Leg_{lx}_B", 0.018, 0.72, (lx, -0.20, 0.36), (0,0,0), 10, mats['steel_frame'], desk_root)
                create_box(f"{desk_name}_Foot_{lx}", (0.04, 0.48, 0.02), (lx, 0, 0.01), mats['steel_frame'], desk_root)

            # Dual Student Chairs behind desk (at Y = -0.48m)
            for ch_side, ch_x in [("L", -0.30), ("R", 0.30)]:
                create_box(f"{desk_name}_Chair_{ch_side}_Seat", (0.40, 0.38, 0.03), (ch_x, -0.48, 0.44), mats['wood_varnish'], desk_root)
                create_box(f"{desk_name}_Chair_{ch_side}_Back", (0.38, 0.02, 0.26), (ch_x, -0.65, 0.68), mats['wood_varnish'], desk_root)
                for clx in [ch_x - 0.16, ch_x + 0.16]:
                    for cly in [-0.34, -0.62]:
                        create_cylinder(f"{desk_name}_Chair_{ch_side}_Leg", 0.014, 0.44, (clx, cly, 0.22), (0,0,0), 8, mats['steel_frame'], desk_root)

            # Props on desk
            if st_idx % 2 == 1:
                create_box(f"{desk_name}_Notebook", (0.22, 0.16, 0.012), (-0.28, -0.04, 0.755), mats['paper_sheet'], desk_root)
                b_mat = mats['backpack_navy'] if st_idx % 3 == 0 else mats['backpack_maroon']
                create_box(f"{desk_name}_Backpack", (0.32, 0.22, 0.40), (cx + 0.55, ry - 0.45, 0.20), b_mat, root_group)
            else:
                create_box(f"{desk_name}_Textbook", (0.24, 0.18, 0.025), (0.26, 0.02, 0.76), mats['wood_varnish'], desk_root)

            st_idx += 1

def build_noticeboard_and_back_wall(mats, root_group):
    """Builds noticeboard with pinned paper notices, storage cupboard, and bookshelves on South wall."""
    D = 7.6
    board_y = -D * 0.5 + 0.03

    # Noticeboard on South wall (Y = -3.76m, Z = 1.80m)
    create_box("Noticeboard_Frame", (1.84, 0.04, 1.14), (0.50, board_y, 1.80), mats['wood_varnish'], root_group)
    create_box("Noticeboard_Felt", (1.74, 0.02, 1.04), (0.50, board_y + 0.01, 1.80), mats['noticeboard_felt'], root_group)

    # 3 Pinned Notices
    for p_i, px in enumerate([0.15, 0.50, 0.85]):
        p_note = create_box(f"Notice_Sheet_{p_i+1}", (0.24, 0.004, 0.32), (px, board_y + 0.02, 1.82 + (p_i - 1) * 0.04), mats['paper_sheet'], root_group)
        p_note.rotation_euler = (0, 0, (p_i - 1) * 0.05)

    # Departmental Storage Cupboard along West wall (X = -3.50m, Y = -2.40m)
    create_box("Storage_Cupboard", (0.50, 1.00, 1.85), (-3.50, -2.40, 0.925), mats['steel_frame'], root_group)
    create_box("Storage_Cupboard_Door_L", (0.02, 0.46, 1.75), (-3.24, -2.16, 0.925), mats['aluminum_brushed'], root_group)
    create_box("Storage_Cupboard_Door_R", (0.02, 0.46, 1.75), (-3.24, -2.64, 0.925), mats['aluminum_brushed'], root_group)

    # Wall Shelves with Books
    create_box("Wall_Shelf_Lower", (1.60, 0.24, 0.03), (-2.20, board_y + 0.12, 1.60), mats['wood_varnish'], root_group)
    create_box("Wall_Shelf_Upper", (1.60, 0.24, 0.03), (-2.20, board_y + 0.12, 2.10), mats['wood_varnish'], root_group)
    create_box("Book_Stack_1", (0.45, 0.18, 0.24), (-2.50, board_y + 0.10, 1.73), mats['wall_dado'], root_group)
    create_box("Book_Stack_2", (0.55, 0.18, 0.22), (-1.90, board_y + 0.10, 1.72), mats['backpack_navy'], root_group)

def build_ceiling_equipment(mats, root_group):
    """Builds 3 fluorescent fixtures and 2 animated ceiling fans."""
    # 3 Fluorescent Troffers at Y = [2.20, 0.0, -2.20], Z = 3.31m
    for f_i, fy in enumerate([2.20, 0.0, -2.20], start=1):
        create_box(f"TubeLight_Fixture_{f_i}", (1.30, 0.22, 0.06), (0, fy, 3.31), mats['light_fixture_housing'], root_group)
        create_cylinder(f"TubeLight_Lamp_{f_i}_A", 0.016, 1.20, (0, fy - 0.05, 3.27), (0, math.pi*0.5, 0), 12, mats['fluorescent_emissive'], root_group)
        create_cylinder(f"TubeLight_Lamp_{f_i}_B", 0.016, 1.20, (0, fy + 0.05, 3.27), (0, math.pi*0.5, 0), 12, mats['fluorescent_emissive'], root_group)

    # 2 Ceiling Fans at Y = [1.20, -1.20], Z = 3.35m
    for fan_i, fan_y in enumerate([1.20, -1.20], start=1):
        fan_root = bpy.data.objects.new(f"CeilingFan_{fan_i}", None)
        fan_root.location = Vector((0, fan_y, 3.35))
        bpy.context.scene.collection.objects.link(fan_root)
        fan_root.parent = root_group

        create_cylinder(f"CeilingFan_Mount_{fan_i}", 0.10, 0.04, (0, 0, -0.02), (0,0,0), 16, mats['steel_frame'], fan_root)
        create_cylinder(f"CeilingFan_Rod_{fan_i}", 0.016, 0.34, (0, 0, -0.19), (0,0,0), 10, mats['steel_frame'], fan_root)

        # Separate Rotatable Hub Mesh
        hub_obj = create_cylinder(f"CeilingFan_Hub_{fan_i}", 0.12, 0.08, (0, 0, -0.38), (0,0,0), 16, mats['steel_frame'], fan_root)

        for b_idx in range(3):
            b_angle = b_idx * (2.0 * math.pi / 3.0)
            blade = create_box(
                f"CeilingFan_{fan_i}_Blade_{b_idx+1}",
                (0.14, 0.65, 0.012),
                (math.sin(b_angle) * 0.40, math.cos(b_angle) * 0.40, -0.01),
                mats['steel_frame'],
                hub_obj
            )
            blade.rotation_euler = (0, 0, -b_angle)

def build_switchboard_and_dustbins(mats, root_group):
    """Builds sub-breaker switchboard near door and 2 classroom waste bins."""
    W = 7.6

    # Electrical Sub-Panel Switchboard on West Wall (X = -3.76m, Y = 1.85m, Z = 1.35m)
    sw_x = -W * 0.5 + 0.05
    sw_box = create_box("Switchboard_Panel", (0.08, 0.32, 0.42), (sw_x, 1.85, 1.35), mats['switchboard_metal'], root_group)
    create_cylinder("Switchboard_Conduit", 0.015, 2.00, (sw_x - 0.01, 1.85, 2.35), (0,0,0), 10, mats['switchboard_metal'], root_group)

    # Breakers attached directly to root_group with clean world coordinates
    create_box("Switchboard_Main_Breaker", (0.03, 0.04, 0.08), (sw_x + 0.045, 1.92, 1.42), mats['breaker_red'], root_group)
    for bk_i, bk_y in enumerate([1.86, 1.82, 1.78, 1.74]):
        create_box(f"Switchboard_Breaker_{bk_i+1}", (0.025, 0.02, 0.04), (sw_x + 0.045, bk_y, 1.32), mats['breaker_black'], root_group)

    # Interactive Switchboard Cover Door
    create_box("Switchboard_Door", (0.01, 0.30, 0.40), (sw_x + 0.045, 1.85, 1.35), mats['aluminum_brushed'], root_group)

    # Dustbins
    create_cylinder("Dustbin_Teacher", 0.16, 0.40, (-2.0, 3.20, 0.20), (0,0,0), 16, mats['dustbin_body'], root_group)
    create_cylinder("Dustbin_Teacher_Liner", 0.155, 0.02, (-2.0, 3.20, 0.39), (0,0,0), 16, mats['steel_frame'], root_group)
    create_cylinder("Dustbin_Entrance", 0.16, 0.40, (-3.40, 1.85, 0.20), (0,0,0), 16, mats['dustbin_body'], root_group)

def construct_full_classroom():
    """Main builder function assembling the entire scene."""
    from classroom_materials import build_classroom_material_library, get_or_create_gltf_output_group

    print("[Builder] Initializing factory scene...")
    bpy.ops.wm.read_factory_settings(use_empty=True)

    get_or_create_gltf_output_group()
    mats = build_classroom_material_library()

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
