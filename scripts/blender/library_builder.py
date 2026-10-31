"""
Production University Library Geometry Builder for Blender.
Constructs architectural shell, entrance & reception counter, student lockers, noticeboard,
large reading tables, student study carrels, wooden chairs, banker desk lamps,
tall double-sided bookshelves with varied academic books, archive partition wall with door,
steel filing cabinets with sliding drawers, archive storage cupboards, ceiling troffers,
switchboard, diyo, and marigold garlands.

Coordinate System Mapping:
Blender native (Z is Up, X is East-West, Y is North-South):
- Width:  X in [-4.6m, +4.6m] (9.2m)  --> Three.js X relative to unit center (28.5m)
- Depth:  Y in [-10.2m, +10.2m] (20.4m) --> Three.js Z relative to unit center (19.0m)
- Height: Z in [0.0m,  +3.50m] (3.50m) --> Three.js Y relative to unit floor (1.62m)
- Entrance Door at X = -4.60m, Y = 0.0m --> Three.js X = 23.9m, Z = 19.0m (Aligned with veranda steps & Torana garland!)
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
    Builds the university library's floor, ceiling, exterior walls with door and window cutouts,
    protective dado wainscoting, archive partition wall, and structural concrete pillars.
    """
    W = 9.2   # X: -4.6 to +4.6
    D = 20.4  # Y: -10.2 to +10.2
    H = 3.50  # Z: 0.0 to 3.50

    # 1. Floor Slab (terrazzo tiles)
    create_box(
        name="Library_Floor_Slab",
        size=(W, D, 0.15),
        location=(0, 0, -0.075),
        material=mats['floor'],
        parent=root_group
    )

    # 2. Ceiling Slab (drop-ceiling acoustic tiles)
    create_box(
        name="Library_Ceiling_Slab",
        size=(W, D, 0.10),
        location=(0, 0, H + 0.05),
        material=mats['ceiling'],
        parent=root_group
    )

    # 3. North Solid Wall (Y = +10.2m)
    create_box(
        name="Library_Wall_North",
        size=(W + 0.3, 0.20, H),
        location=(0, D/2 + 0.10, H/2),
        material=mats['wall'],
        parent=root_group
    )
    create_box(
        name="Library_Dado_North",
        size=(W + 0.3, 0.04, 1.0),
        location=(0, D/2 - 0.02, 0.50),
        material=mats['wall_dado'],
        parent=root_group
    )

    # 4. South Solid Wall (Y = -10.2m)
    create_box(
        name="Library_Wall_South",
        size=(W + 0.3, 0.20, H),
        location=(0, -D/2 - 0.10, H/2),
        material=mats['wall'],
        parent=root_group
    )
    create_box(
        name="Library_Dado_South",
        size=(W + 0.3, 0.04, 1.0),
        location=(0, -D/2 + 0.02, 0.50),
        material=mats['wall_dado'],
        parent=root_group
    )

    # 5. West Wall (X = -4.6m, facing courtyard veranda)
    # Main Entrance Door is centered at Y = 0.0m (width 1.4m, height 2.3m)
    # West Wall South Section (Y from -10.2 to -0.7) -> length 9.5m
    create_box(
        name="Library_Wall_West_South",
        size=(0.20, 9.50, H),
        location=(-W/2 - 0.10, -5.45, H/2),
        material=mats['wall'],
        parent=root_group
    )
    # Lintel above Entrance Door (Y from -0.7 to +0.7) -> length 1.40m, height H - 2.30 = 1.20m
    create_box(
        name="Library_Wall_West_DoorLintel",
        size=(0.20, 1.40, H - 2.30),
        location=(-W/2 - 0.10, 0.0, 2.30 + (H - 2.30)/2),
        material=mats['wall'],
        parent=root_group
    )
    # West Wall North Section (Y from +0.7 to +10.2) -> length 9.5m
    create_box(
        name="Library_Wall_West_North",
        size=(0.20, 9.50, H),
        location=(-W/2 - 0.10, 5.45, H/2),
        material=mats['wall'],
        parent=root_group
    )

    # West Wall Dado
    create_box(
        name="Library_Dado_West_S",
        size=(0.04, 9.50, 1.0),
        location=(-W/2 + 0.02, -5.45, 0.50),
        material=mats['wall_dado'],
        parent=root_group
    )
    create_box(
        name="Library_Dado_West_N",
        size=(0.04, 9.50, 1.0),
        location=(-W/2 + 0.02, 5.45, 0.50),
        material=mats['wall_dado'],
        parent=root_group
    )

    # 6. East Wall (X = +4.6m, Campus exterior with reading room windows)
    create_box(
        name="Library_Wall_East_Lower",
        size=(0.20, D, 1.0),
        location=(W/2 + 0.10, 0, 0.50),
        material=mats['wall'],
        parent=root_group
    )
    create_box(
        name="Library_Wall_East_Upper",
        size=(0.20, D, H - 2.60),
        location=(W/2 + 0.10, 0, 2.60 + (H - 2.60)/2),
        material=mats['wall'],
        parent=root_group
    )
    east_piers = [-7.5, -2.5, 2.5, 7.5]
    for idx, py in enumerate(east_piers):
        create_box(
            name=f"Library_Wall_East_Pier_{idx}",
            size=(0.20, 1.20, 1.60),
            location=(W/2 + 0.10, py, 1.80),
            material=mats['wall'],
            parent=root_group
        )
    east_windows = [-5.0, 0.0, 5.0]
    for idx, wy in enumerate(east_windows):
        create_box(
            name=f"Library_Window_Glass_East_{idx}",
            size=(0.04, 3.20, 1.50),
            location=(W/2 + 0.05, wy, 1.80),
            material=mats['window_glass'],
            parent=root_group
        )
        create_box(
            name=f"Library_Window_Frame_East_{idx}",
            size=(0.10, 3.25, 1.55),
            location=(W/2 + 0.05, wy, 1.80),
            material=mats['window_frame'],
            parent=root_group
        )

    # 7. Interior Partition Wall for Restricted Archive Room (at Y = +7.2m)
    create_box(
        name="Library_Archive_Partition_West",
        size=(4.05, 0.15, H),
        location=(-2.575, 7.20, H/2),
        material=mats['wall'],
        parent=root_group
    )
    create_box(
        name="Library_Archive_Partition_East",
        size=(4.05, 0.15, H),
        location=(2.575, 7.20, H/2),
        material=mats['wall'],
        parent=root_group
    )
    create_box(
        name="Library_Archive_Door_Lintel",
        size=(1.10, 0.15, H - 2.20),
        location=(0, 7.20, 2.20 + (H - 2.20)/2),
        material=mats['wall'],
        parent=root_group
    )

    # 8. Structural Concrete Pillars
    for idx, px in enumerate([-1.60, 1.60]):
        create_box(
            name=f"Library_Pillar_{idx+1}",
            size=(0.45, 0.45, H),
            location=(px, -3.0, H/2),
            material=mats['pillar_concrete'],
            parent=root_group
        )

def build_entrance_and_reception(mats, root_group):
    """
    Constructs the Main Entrance Door at X = -4.6m, Y = 0.0m,
    Reception / Circulation Counter, Librarian Workstation,
    Student Bag Cubbies, Noticeboard, Waiting Chairs,
    Tihar Clay Diyo and Marigold Garland.
    """
    # 1. Main Entrance Door (West wall at X = -4.6, Y = 0.0)
    door_frame = create_box(
        name="Door_Frame_Library_Entrance",
        size=(0.18, 1.40, 2.30),
        location=(-4.60, 0.0, 1.15),
        material=mats['door_wood'],
        parent=root_group
    )

    door_pivot = bpy.data.objects.new("Door_Library_Entrance_Pivot", None)
    door_pivot.location = Vector((-4.60, -0.60, 0.0))
    bpy.context.scene.collection.objects.link(door_pivot)
    door_pivot.parent = root_group

    door_leaf = create_box(
        name="Door_Leaf_Library_Entrance",
        size=(0.06, 1.20, 2.20),
        location=(0.0, 0.60, 1.10),
        material=mats['door_wood'],
        parent=door_pivot
    )

    create_box(
        name="Door_Handle_Entrance_In",
        size=(0.04, 0.14, 0.05),
        location=(0.04, 1.10, 1.05),
        material=mats['hardware_brass'],
        parent=door_leaf
    )
    create_box(
        name="Door_Handle_Entrance_Out",
        size=(0.04, 0.14, 0.05),
        location=(-0.04, 1.10, 1.05),
        material=mats['hardware_brass'],
        parent=door_leaf
    )

    # 2. Reception & Circulation Counter (South of entrance at X = -2.2m, Y = -2.5m)
    create_box(
        name="Reception_Counter_Body",
        size=(0.70, 2.60, 1.00),
        location=(-2.20, -2.50, 0.50),
        material=mats['wood_teak'],
        parent=root_group
    )
    create_box(
        name="Reception_Counter_Top",
        size=(0.80, 2.70, 0.06),
        location=(-2.20, -2.50, 1.03),
        material=mats['wood_teak'],
        parent=root_group
    )
    create_box(
        name="Reception_Counter_Return",
        size=(1.20, 0.60, 1.00),
        location=(-3.15, -3.50, 0.50),
        material=mats['wood_teak'],
        parent=root_group
    )
    create_box(
        name="Reception_Counter_Return_Top",
        size=(1.25, 0.65, 0.06),
        location=(-3.15, -3.50, 1.03),
        material=mats['wood_teak'],
        parent=root_group
    )

    # Interactive Reception Desk Drawer (sliding along +Y)
    reception_drawer = create_box(
        name="Reception_Desk_Drawer",
        size=(0.45, 0.40, 0.18),
        location=(-2.20, -2.20, 0.75),
        material=mats['wood_teak'],
        parent=root_group
    )
    create_box(
        name="Reception_Drawer_Handle",
        size=(0.04, 0.10, 0.03),
        location=(-2.20, -1.99, 0.75),
        material=mats['hardware_brass'],
        parent=reception_drawer
    )

    key_mesh = create_box(
        name="Item_Library_Key",
        size=(0.02, 0.08, 0.015),
        location=(-2.20, -2.20, 0.70),
        material=mats['hardware_brass'],
        parent=reception_drawer
    )

    # Check-in Ledger (Open Book on counter)
    create_box(
        name="Reception_Ledger_Cover",
        size=(0.35, 0.45, 0.03),
        location=(-2.20, -3.00, 1.07),
        material=mats['book_burgundy'],
        parent=root_group
    )
    create_box(
        name="Reception_Ledger_Pages",
        size=(0.32, 0.42, 0.025),
        location=(-2.20, -3.00, 1.085),
        material=mats['book_pages'],
        parent=root_group
    )

    # Tihar Diyo on Brass Plate at Reception Counter
    create_cylinder(
        name="Reception_Brass_Thali",
        radius=0.12,
        depth=0.015,
        location=(-2.20, -1.60, 1.065),
        material=mats['lamp_brass'],
        parent=root_group
    )
    create_cylinder(
        name="Reception_Diyo_Clay",
        radius=0.06,
        depth=0.03,
        location=(-2.20, -1.60, 1.085),
        material=mats['diyo_clay'],
        parent=root_group
    )
    create_cylinder(
        name="Diyo_Reception_Flame",
        radius=0.018,
        depth=0.04,
        location=(-2.20, -1.60, 1.115),
        material=mats['diyo_flame'],
        parent=root_group
    )

    # Marigold (Sayapatri) Garland draped along front counter
    create_box(
        name="Garland_Reception_Desk",
        size=(0.06, 2.50, 0.06),
        location=(-1.82, -2.50, 0.95),
        material=mats['garland_marigold'],
        parent=root_group
    )

    # 3. Librarian Workstation
    create_box(
        name="Librarian_Workdesk",
        size=(0.75, 1.40, 0.74),
        location=(-1.40, -2.50, 0.37),
        material=mats['wood_teak'],
        parent=root_group
    )
    create_box(
        name="Librarian_Chair_Seat",
        size=(0.50, 0.50, 0.08),
        location=(-0.85, -2.50, 0.48),
        material=mats['chair_fabric'],
        parent=root_group
    )
    create_box(
        name="Librarian_Chair_Back",
        size=(0.08, 0.48, 0.45),
        location=(-0.60, -2.50, 0.72),
        material=mats['chair_fabric'],
        parent=root_group
    )

    create_box(
        name="Librarian_Monitor_Casing",
        size=(0.35, 0.40, 0.32),
        location=(-1.40, -2.50, 0.92),
        material=mats['monitor_casing'],
        parent=root_group
    )
    create_box(
        name="Librarian_Monitor",
        size=(0.02, 0.34, 0.26),
        location=(-1.22, -2.50, 0.92),
        material=mats['monitor_screen'],
        parent=root_group
    )
    create_box(
        name="Librarian_Keyboard",
        size=(0.18, 0.42, 0.02),
        location=(-1.10, -2.50, 0.75),
        material=mats['monitor_casing'],
        parent=root_group
    )

    # 4. Student Bag Storage Cubbies (South Wall: Y = -10.0m, X = -2.2m)
    create_box(
        name="Student_Bag_Cubbies_Frame",
        size=(2.20, 0.40, 1.50),
        location=(-2.20, -9.95, 0.75),
        material=mats['wood_cubbies'],
        parent=root_group
    )
    for sy in [0.45, 0.95]:
        create_box(
            name=f"Cubby_Shelf_{int(sy*100)}",
            size=(2.15, 0.38, 0.03),
            location=(-2.20, -9.95, sy),
            material=mats['wood_cubbies'],
            parent=root_group
        )

    # 5. Noticeboard with University Notices (South Wall: Y = -10.0m, X = +2.0m)
    create_box(
        name="Library_Noticeboard_Frame",
        size=(2.40, 0.06, 1.40),
        location=(2.00, -9.95, 1.80),
        material=mats['wood_sal'],
        parent=root_group
    )
    create_box(
        name="Library_Noticeboard_Felt",
        size=(2.30, 0.04, 1.30),
        location=(2.00, -9.92, 1.80),
        material=mats['noticeboard'],
        parent=root_group
    )
    for idx, (px, pz) in enumerate([(-0.6, 0.2), (0.0, 0.2), (0.6, 0.2), (-0.4, -0.2), (0.4, -0.2)]):
        create_box(
            name=f"Notice_Paper_{idx+1}",
            size=(0.35, 0.02, 0.45),
            location=(2.00 + px, -9.89, 1.80 + pz),
            material=mats['notice_paper'],
            parent=root_group
        )

    # 6. Waiting Lounge Chairs (East of entrance: X = +2.2m, Y = -1.0m)
    for idx, wy in enumerate([-1.60, -0.60]):
        create_box(
            name=f"Waiting_Chair_Seat_{idx+1}",
            size=(0.55, 0.55, 0.08),
            location=(2.20, wy, 0.45),
            material=mats['chair_fabric'],
            parent=root_group
        )
        create_box(
            name=f"Waiting_Chair_Back_{idx+1}",
            size=(0.08, 0.52, 0.45),
            location=(2.45, wy, 0.70),
            material=mats['chair_fabric'],
            parent=root_group
        )

def build_reading_hall(mats, root_group):
    """
    Constructs the Main Reading Hall:
    - 3 Large Solid Teak Study Tables with reading chairs
    - Individual Study Carrel with partition dividers
    - Interactive classic Banker Desk Lamps
    - Scattered books, spiral notebooks, stationery
    - Under-table hiding location
    """
    table_configs = [
        ("Table_1", -2.00, -6.50, True),
        ("Table_2",  2.00, -6.50, True),
        ("Table_3", -2.00,  2.50, False),
    ]

    for name, tx, ty, has_lamp in table_configs:
        create_box(
            name=f"{name}_Top",
            size=(1.20, 2.40, 0.06),
            location=(tx, ty, 0.73),
            material=mats['wood_teak'],
            parent=root_group
        )
        for lx in [-0.52, 0.52]:
            for ly in [-1.10, 1.10]:
                create_box(
                    name=f"{name}_Leg_{lx}_{ly}",
                    size=(0.08, 0.08, 0.70),
                    location=(tx + lx, ty + ly, 0.35),
                    material=mats['wood_teak'],
                    parent=root_group
                )

        for c_idx, cy in enumerate([-0.65, 0.65]):
            create_box(
                name=f"{name}_Chair_W_{c_idx}_Seat",
                size=(0.46, 0.46, 0.06),
                location=(tx - 0.75, ty + cy, 0.44),
                material=mats['chair_fabric'],
                parent=root_group
            )
            create_box(
                name=f"{name}_Chair_W_{c_idx}_Back",
                size=(0.06, 0.44, 0.40),
                location=(tx - 0.96, ty + cy, 0.66),
                material=mats['chair_wood'],
                parent=root_group
            )
            create_box(
                name=f"{name}_Chair_E_{c_idx}_Seat",
                size=(0.46, 0.46, 0.06),
                location=(tx + 0.75, ty + cy, 0.44),
                material=mats['chair_fabric'],
                parent=root_group
            )
            create_box(
                name=f"{name}_Chair_E_{c_idx}_Back",
                size=(0.06, 0.44, 0.40),
                location=(tx + 0.96, ty + cy, 0.66),
                material=mats['chair_wood'],
                parent=root_group
            )

        create_box(
            name=f"{name}_Open_Book_Spread",
            size=(0.32, 0.44, 0.025),
            location=(tx - 0.20, ty - 0.40, 0.77),
            material=mats['book_pages'],
            parent=root_group
        )
        create_box(
            name=f"{name}_Stacked_Book_1",
            size=(0.22, 0.28, 0.04),
            location=(tx + 0.25, ty + 0.50, 0.78),
            material=mats['book_navy'],
            parent=root_group
        )
        create_box(
            name=f"{name}_Stacked_Book_2",
            size=(0.20, 0.26, 0.035),
            location=(tx + 0.25, ty + 0.50, 0.815),
            material=mats['book_green'],
            parent=root_group
        )

    # Interactive Banker Desk Lamps
    create_cylinder(
        name="Desk_Lamp_Banker_1_Base",
        radius=0.08,
        depth=0.02,
        location=(-2.00, -6.50, 0.77),
        material=mats['lamp_brass'],
        parent=root_group
    )
    create_cylinder(
        name="Desk_Lamp_Banker_1_Stem",
        radius=0.015,
        depth=0.28,
        location=(-2.00, -6.50, 0.91),
        material=mats['lamp_brass'],
        parent=root_group
    )
    create_cylinder(
        name="Desk_Lamp_Banker_1",
        radius=0.06,
        depth=0.22,
        location=(-2.00, -6.50, 1.05),
        rotation=(0, math.radians(90), 0),
        material=mats['lamp_green_glass'],
        parent=root_group
    )
    create_cylinder(
        name="Desk_Lamp_Banker_1_Bulb",
        radius=0.02,
        depth=0.14,
        location=(-2.00, -6.50, 1.03),
        rotation=(0, math.radians(90), 0),
        material=mats['lamp_bulb_warm'],
        parent=root_group
    )

    create_cylinder(
        name="Desk_Lamp_Banker_2_Base",
        radius=0.08,
        depth=0.02,
        location=(2.00, -6.50, 0.77),
        material=mats['lamp_brass'],
        parent=root_group
    )
    create_cylinder(
        name="Desk_Lamp_Banker_2_Stem",
        radius=0.015,
        depth=0.28,
        location=(2.00, -6.50, 0.91),
        material=mats['lamp_brass'],
        parent=root_group
    )
    create_cylinder(
        name="Desk_Lamp_Banker_2",
        radius=0.06,
        depth=0.22,
        location=(2.00, -6.50, 1.05),
        rotation=(0, math.radians(90), 0),
        material=mats['lamp_green_glass'],
        parent=root_group
    )

    # Study Carrel Station (X = +2.0m, Y = +2.5m)
    create_box(
        name="Carrel_Desk_Top",
        size=(1.20, 2.20, 0.05),
        location=(2.00, 2.50, 0.73),
        material=mats['wood_teak'],
        parent=root_group
    )
    create_box(
        name="Carrel_Divider_Center",
        size=(0.04, 2.20, 0.50),
        location=(2.00, 2.50, 1.00),
        material=mats['wood_teak'],
        parent=root_group
    )
    create_box(
        name="Carrel_Divider_Cross",
        size=(1.18, 0.04, 0.50),
        location=(2.00, 2.50, 1.00),
        material=mats['wood_teak'],
        parent=root_group
    )

def build_bookshelves_and_aisles(mats, root_group):
    """
    Constructs the Main Book Stack Aisles (Y in [+4.2, +6.8]):
    - 4 Tall double-sided book stacks with 5 tier shelves
    - Hundreds of academic books with varied heights, thicknesses, tilt angles, and colors
    - Category classification signs
    - Interactive Rare Book volume
    """
    stack_coords = [
        ("ShelfStack_R1_W", -2.30, 4.60, "COMPUTER SCIENCE & ENGINEERING"),
        ("ShelfStack_R1_E",  2.30, 4.60, "ELECTRICAL & ELECTRONICS"),
        ("ShelfStack_R2_W", -2.30, 5.90, "NEPALI LITERATURE & HISTORY"),
        ("ShelfStack_R2_E",  2.30, 5.90, "MATHEMATICS & NATURAL SCIENCES"),
    ]

    book_mats = [
        mats['book_burgundy'], mats['book_navy'], mats['book_green'],
        mats['book_ochre'], mats['book_black']
    ]

    for s_name, sx, sy, category_title in stack_coords:
        for ex in [-1.65, 1.65]:
            create_box(
                name=f"{s_name}_EndPanel_{ex}",
                size=(0.06, 0.65, 2.30),
                location=(sx + ex, sy, 1.15),
                material=mats['wood_sal'],
                parent=root_group
            )
        create_box(
            name=f"{s_name}_SpineDivider",
            size=(3.30, 0.04, 2.30),
            location=(sx, sy, 1.15),
            material=mats['wood_sal'],
            parent=root_group
        )
        shelf_zs = [0.15, 0.60, 1.05, 1.50, 1.95]
        for idx, sz in enumerate(shelf_zs):
            create_box(
                name=f"{s_name}_Shelf_{idx+1}",
                size=(3.30, 0.62, 0.04),
                location=(sx, sy, sz),
                material=mats['wood_sal'],
                parent=root_group
            )

        plaque_x = sx + (1.67 if sx < 0 else -1.67)
        create_box(
            name=f"{s_name}_CategoryPlaque",
            size=(0.02, 0.45, 0.12),
            location=(plaque_x, sy, 1.75),
            material=mats['lamp_brass'],
            parent=root_group
        )

        for tier_idx, sz in enumerate(shelf_zs[1:4]):
            for side in [-0.18, 0.18]:
                book_count = 14
                shelf_half_len = 1.45
                spacing = (shelf_half_len * 2) / book_count

                for b_i in range(book_count):
                    bx = (sx - shelf_half_len) + (b_i * spacing) + (spacing * 0.5)
                    seed = (tier_idx * 31 + b_i * 17 + int(abs(sx) * 10)) % 100
                    b_height = 0.22 + (seed % 7) * 0.015
                    b_thick = 0.035 + (seed % 5) * 0.012
                    b_depth = 0.24
                    b_mat = book_mats[seed % len(book_mats)]

                    create_box(
                        name=f"{s_name}_Book_T{tier_idx}_S{b_i}",
                        size=(b_thick, b_depth, b_height),
                        location=(bx, sy + side, sz + 0.02 + b_height/2),
                        material=b_mat,
                        parent=root_group
                    )

    # Interactive Rare Book Volume on Bookshelf Row 2 West at eye level
    rare_book = create_box(
        name="Bookshelf_Interaction",
        size=(0.05, 0.26, 0.30),
        location=(-1.20, 5.72, 1.22),
        material=mats['book_burgundy'],
        parent=root_group
    )
    create_box(
        name="Bookshelf_Interaction_Trim",
        size=(0.01, 0.04, 0.28),
        location=(-1.20, 5.58, 1.22),
        material=mats['lamp_brass'],
        parent=rare_book
    )

def build_archive_and_storage(mats, root_group):
    """
    Constructs the Archive & Storage Area (Y in [+7.2, +10.2]):
    - Functional Archive Room Partition Door
    - Heavy Steel 4-Drawer Filing Cabinets with sliding drawer
    - Double-door Archive Metal Storage Cupboard with hinged door & hiding interior
    - Slotted archival document shelves with labeled document storage boxes
    """
    # 1. Archive Room Partition Door (at Y = +7.2m, X = 0.0m)
    door_frame = create_box(
        name="Door_Frame_Archive",
        size=(1.10, 0.16, 2.22),
        location=(0.0, 7.20, 1.11),
        material=mats['door_wood'],
        parent=root_group
    )

    door_pivot = bpy.data.objects.new("Door_Archive_Pivot", None)
    door_pivot.location = Vector((-0.50, 7.20, 0.0))
    bpy.context.scene.collection.objects.link(door_pivot)
    door_pivot.parent = root_group

    door_leaf = create_box(
        name="Door_Leaf_Archive",
        size=(0.96, 0.05, 2.15),
        location=(0.48, 0.0, 1.075),
        material=mats['door_wood'],
        parent=door_pivot
    )
    create_box(
        name="Door_Handle_Archive_In",
        size=(0.04, 0.12, 0.04),
        location=(0.88, 0.04, 1.05),
        material=mats['hardware_brass'],
        parent=door_leaf
    )
    create_box(
        name="Door_Handle_Archive_Out",
        size=(0.04, 0.12, 0.04),
        location=(0.88, -0.04, 1.05),
        material=mats['hardware_brass'],
        parent=door_leaf
    )

    # 2. Steel 4-Drawer Filing Cabinet (West wall: X = -3.8m, Y = +8.6m)
    create_box(
        name="Filing_Cabinet_Archive_Body",
        size=(0.60, 0.65, 1.45),
        location=(-3.80, 8.60, 0.725),
        material=mats['steel_cabinet'],
        parent=root_group
    )
    for idx, dz in enumerate([0.22, 0.56, 0.90]):
        create_box(
            name=f"Filing_Cabinet_Drawer_Fixed_{idx}",
            size=(0.54, 0.04, 0.30),
            location=(-3.80, 8.27, dz),
            material=mats['steel_cabinet'],
            parent=root_group
        )
    filing_drawer = create_box(
        name="Filing_Cabinet_Drawer",
        size=(0.54, 0.58, 0.30),
        location=(-3.80, 8.56, 1.24),
        material=mats['steel_cabinet'],
        parent=root_group
    )
    create_box(
        name="Filing_Cabinet_Drawer_Handle",
        size=(0.14, 0.04, 0.03),
        location=(-3.80, 8.25, 1.24),
        material=mats['hardware_brass'],
        parent=filing_drawer
    )

    # 3. Archive Storage Cupboard with Double Doors (East wall: X = +3.8m, Y = +8.6m)
    create_box(
        name="Archive_Storage_Cabinet_Body",
        size=(0.75, 1.20, 2.10),
        location=(3.80, 8.60, 1.05),
        material=mats['steel_cabinet'],
        parent=root_group
    )
    create_box(
        name="Archive_Cabinet_Door_Right",
        size=(0.04, 0.56, 2.02),
        location=(3.40, 8.89, 1.05),
        material=mats['steel_cabinet'],
        parent=root_group
    )

    cab_door_pivot = bpy.data.objects.new("Archive_Cabinet_Door_Pivot", None)
    cab_door_pivot.location = Vector((3.40, 8.31, 0.0))
    bpy.context.scene.collection.objects.link(cab_door_pivot)
    cab_door_pivot.parent = root_group

    cab_door_left = create_box(
        name="Archive_Cabinet_Door",
        size=(0.04, 0.56, 2.02),
        location=(0.0, 0.28, 1.05),
        material=mats['steel_cabinet'],
        parent=cab_door_pivot
    )
    create_box(
        name="Archive_Cabinet_Handle",
        size=(0.04, 0.08, 0.12),
        location=(-0.03, 0.50, 1.05),
        material=mats['hardware_brass'],
        parent=cab_door_left
    )

    # 4. Archival Document Shelving along North Wall (Y = +9.8m)
    for idx, sx in enumerate([-2.20, 0.0, 2.20]):
        create_box(
            name=f"Archive_Rack_{idx+1}_Frame",
            size=(1.80, 0.55, 2.20),
            location=(sx, 9.80, 1.10),
            material=mats['steel_dark'],
            parent=root_group
        )
        for sz in [0.30, 0.85, 1.40, 1.95]:
            create_box(
                name=f"Archive_Rack_{idx+1}_Shelf_{int(sz*100)}",
                size=(1.75, 0.52, 0.03),
                location=(sx, 9.80, sz),
                material=mats['steel_dark'],
                parent=root_group
            )
            for bx_idx, bx_off in enumerate([-0.50, 0.0, 0.50]):
                create_box(
                    name=f"Archive_Box_{idx}_{int(sz*10)}_{bx_idx}",
                    size=(0.38, 0.46, 0.28),
                    location=(sx + bx_off, 9.80, sz + 0.155),
                    material=mats['cardboard_box'],
                    parent=root_group
                )

def build_ceiling_fixtures_and_switches(mats, root_group):
    """
    Constructs:
    - 6 Ceiling Fluorescent Troffer Fixtures
    - Main Electrical Switchboard Panel with functional toggle
    - Secondary Reading Hall Light Switch
    """
    troffer_coords = [
        (-2.00, -6.50, False),  # Reading Table 1
        ( 2.00, -6.50, False),  # Reading Table 2
        (-2.00, -1.50, False),  # Reception West
        ( 2.00, -1.50, False),  # Reception East
        (-2.00,  4.50, False),  # Bookshelves West
        ( 2.00,  4.50, True),   # Bookshelves East (Subtle horror flicker)
    ]

    for idx, (tx, ty, is_flicker) in enumerate(troffer_coords):
        create_box(
            name=f"Troffer_Housing_{idx+1}",
            size=(0.40, 1.40, 0.10),
            location=(tx, ty, 3.45),
            material=mats['fluorescent_housing'],
            parent=root_group
        )
        tube_mat = mats['fluorescent_tube_dim'] if is_flicker else mats['fluorescent_tube']
        for tube_off in [-0.08, 0.08]:
            create_cylinder(
                name=f"Fluorescent_Tube_{idx+1}_{tube_off}",
                radius=0.02,
                depth=1.20,
                location=(tx + tube_off, ty, 3.42),
                rotation=(math.radians(90), 0, 0),
                material=tube_mat,
                parent=root_group
            )

    create_box(
        name="Archive_Troffer_Housing",
        size=(0.35, 1.20, 0.08),
        location=(0.0, 8.50, 3.45),
        material=mats['fluorescent_housing'],
        parent=root_group
    )
    create_cylinder(
        name="Archive_Fluorescent_Tube",
        radius=0.02,
        depth=1.00,
        location=(0.0, 8.50, 3.42),
        rotation=(math.radians(90), 0, 0),
        material=mats['fluorescent_tube_dim'],
        parent=root_group
    )

    create_box(
        name="Switchboard_Box_Library",
        size=(0.08, 0.35, 0.50),
        location=(-4.55, -1.20, 1.50),
        material=mats['switchboard_metal'],
        parent=root_group
    )
    create_box(
        name="Library_Switchboard",
        size=(0.04, 0.12, 0.16),
        location=(-4.50, -1.20, 1.50),
        material=mats['switchboard_metal'],
        parent=root_group
    )

    create_box(
        name="Interior_Light_Switch",
        size=(0.03, 0.10, 0.12),
        location=(-4.55, 2.00, 1.40),
        material=mats['switchboard_metal'],
        parent=root_group
    )

def build_university_library_scene(mats):
    """Master scene builder orchestrating all library sections."""
    print("[Library Builder] Creating root group and assembling University Library architecture...")

    root_group = bpy.data.objects.new("Root_University_Library", None)
    bpy.context.scene.collection.objects.link(root_group)

    build_architectural_shell(mats, root_group)
    build_entrance_and_reception(mats, root_group)
    build_reading_hall(mats, root_group)
    build_bookshelves_and_aisles(mats, root_group)
    build_archive_and_storage(mats, root_group)
    build_ceiling_fixtures_and_switches(mats, root_group)

    print("[Library Builder] University Library scene geometry constructed successfully.")
    return root_group
