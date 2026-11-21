# UNITS = mm
"""Parametric passenger elevator cabin (CadQuery).

Source spec: notes/cabin-spec.md (part names and coordinates follow it).

Units
-----
All dimensions are in millimetres (mm). UNITS = "mm".
STEP and STL files are written in mm. The GLB file is written in metres
(glTF convention): every part is scaled by GLB_SCALE = 0.001 before export.

Coordinate system
-----------------
- Origin O(0,0,0): front-left corner of the clear inner space, on the finished
  floor surface.
- View: standing outside the door, looking into the cabin.
- +X: left -> right (width). +Y: front wall (door) -> back wall (depth).
  +Z: up.
- Clear space: X 0..1100, Y 0..1400, Z 0..2300.
- Outer envelope (walls + floor + ceiling, without door/sill):
  X -25..1125, Y -25..1425, Z -50..2350.

Given by the user
-----------------
- Clear width 1100, clear depth 1400, clear height 2300 (finished floor to
  underside of ceiling).
- Wall material: stainless steel hairline ("Inox soc nhuyen").
- Use: passenger cabin.

Assumptions (assumed - can nguoi dung xac nhan)
-----------------------------------------------
- Wall thickness 25 (folded-edge panel), floor 50, ceiling 50.
- Door: centre opening, 2 panels, clear opening 800 x 2100, panel thickness 30,
  each panel overlaps the front wall by 25, 10 mm gap in front of the front
  wall. Modelled in the CLOSED state. Door material = same stainless hairline.
- Door sill: door clear width + 100 (= 900) x 75 x 50.
- Handrail only on the back wall: round tube D38, 100 short of each side wall
  (length 900), top edge at Z = 900, 50 mm clear from the back wall; two D25
  brackets 100 in from each tube end (X = 200 and X = 900), each running from
  the tube centre line to the back wall face (length 69) so it is embedded in
  the tube.
- Hairline grain direction vertical (Z) - visual only, not modelled.
- Rated load, floor finish, ceiling finish/lighting, sill material: not given
  (can nguoi dung xac nhan); floor/ceiling/sill get a neutral grey placeholder.
- Not modelled: door operator/tracks, lights, fan, COP.

Each part is a separate closed solid; parts are gathered in a cq.Assembly with
stainless colour for walls, door panels and handrail.

Output: STEP, STL, GLB written to OUTPUT_DIR (env var OUTPUT_DIR, or first
command-line argument, default: ./outputs next to this script), plus one STL
per part in OUTPUT_DIR/parts/.

Run (inside a virtual environment, see README.md):
    python -m venv .venv
    .venv\\Scripts\\activate        (Windows)  or  source .venv/bin/activate
    pip install cadquery
    python cabin.py [OUTPUT_DIR]
"""

UNITS = "mm"

# =============================================================================
# PARAMETERS (mm)
# =============================================================================
# --- Given ------------------------------------------------------------------
CABIN_CLEAR_WIDTH = 1100.0      # clear inner width, X (given)
CABIN_CLEAR_DEPTH = 1400.0      # clear inner depth, Y (given)
CABIN_CLEAR_HEIGHT = 2300.0     # finished floor -> underside of ceiling, Z (given)

# --- Shell (assumed, can nguoi dung xac nhan) -------------------------------
WALL_THICKNESS = 25.0           # wall panel thickness
WALL_SHEET_THICKNESS = 1.5      # stainless sheet thickness (info only, not modelled)
FLOOR_THICKNESS = 50.0          # floor slab thickness
CEILING_THICKNESS = 50.0        # ceiling thickness

# --- Door (assumed, can nguoi dung xac nhan) --------------------------------
DOOR_CLEAR_WIDTH = 800.0        # clear door opening width (centred in front wall)
DOOR_CLEAR_HEIGHT = 2100.0      # clear door opening height
DOOR_PANEL_THICKNESS = 30.0     # door leaf thickness
DOOR_PANEL_OVERLAP = 25.0       # each leaf overlaps the front wall jamb
DOOR_GAP_TO_WALL = 10.0         # gap between front wall outer face and door leaf
DOOR_OPEN_FRACTION = 0.0        # 0 = closed (spec state), 1 = fully open

# --- Door sill (assumed, material can nguoi dung xac nhan) ------------------
SILL_EXTRA_WIDTH = 100.0        # sill length minus door clear width (total, centred)
SILL_DEPTH = 75.0               # sill depth along -Y, in front of front wall
SILL_THICKNESS = 50.0           # sill thickness (top flush with finished floor)

# --- Handrail (assumed, can nguoi dung xac nhan) ----------------------------
HANDRAIL_TUBE_DIAMETER = 38.0   # tube outer diameter
HANDRAIL_TOP_HEIGHT = 900.0     # top of tube above finished floor
HANDRAIL_WALL_CLEARANCE = 50.0  # back wall face -> tube surface
HANDRAIL_END_MARGIN = 100.0     # side wall inner face -> tube end (each side)
HANDRAIL_BRACKET_DIAMETER = 25.0  # bracket rod diameter
HANDRAIL_BRACKET_INSET = 100.0  # tube end -> bracket centre (each end)

# --- Not given ---------------------------------------------------------------
RATED_LOAD_KG = None            # rated load, kg - can nguoi dung xac nhan

# --- Colours (RGBA 0..1) ----------------------------------------------------
COLOR_STAINLESS = (0.78, 0.79, 0.80, 1.0)    # stainless hairline look
COLOR_PLACEHOLDER = (0.45, 0.45, 0.45, 1.0)  # floor/ceiling/sill (material TBD)

# --- Output -----------------------------------------------------------------
PART_NAME = "elevator_cabin"     # base name for output files
OUTPUT_SUBDIR = "outputs"        # default output folder next to this script
PARTS_SUBDIR = "parts"           # subfolder of OUTPUT_DIR for per-part STL files
STL_TOLERANCE = 0.5              # mesh linear deflection, mm (STL and GLB)
STL_ANGULAR_TOLERANCE = 0.2      # mesh angular deflection, rad (STL and GLB)
GLB_SCALE = 0.001                # mm -> m for GLB (glTF unit is metre)
# =============================================================================

import os
import sys

import cadquery as cq


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def box_from_bounds(x0, x1, y0, y1, z0, z1):
    """Closed rectangular solid from min/max bounds."""
    return (
        cq.Workplane("XY")
        .box(x1 - x0, y1 - y0, z1 - z0, centered=False)
        .translate((x0, y0, z0))
    )


def cylinder_along(axis, diameter, start, length, center_a, center_b):
    """Closed cylinder along 'X' or 'Y'.

    start/length are along the axis; center_a/center_b are the two other
    coordinates (for X: (y, z); for Y: (x, z)).
    """
    r = diameter / 2.0
    if axis == "X":
        return (
            cq.Workplane("YZ", origin=(start, center_a, center_b))
            .circle(r)
            .extrude(length)
        )
    if axis == "Y":
        # XZ workplane normal is -Y, so extrude negative to go +Y
        return (
            cq.Workplane("XZ", origin=(center_a, start, center_b))
            .circle(r)
            .extrude(-length)
        )
    raise ValueError("axis must be 'X' or 'Y'")


# Derived values
W = CABIN_CLEAR_WIDTH
D = CABIN_CLEAR_DEPTH
H = CABIN_CLEAR_HEIGHT
T = WALL_THICKNESS
DOOR_X0 = (W - DOOR_CLEAR_WIDTH) / 2.0
DOOR_X1 = DOOR_X0 + DOOR_CLEAR_WIDTH
SILL_WIDTH = DOOR_CLEAR_WIDTH + SILL_EXTRA_WIDTH          # 900 by default
HANDRAIL_R = HANDRAIL_TUBE_DIAMETER / 2.0
HANDRAIL_CY = D - HANDRAIL_WALL_CLEARANCE - HANDRAIL_R
HANDRAIL_CZ = HANDRAIL_TOP_HEIGHT - HANDRAIL_R
HANDRAIL_X0 = HANDRAIL_END_MARGIN                         # tube start
HANDRAIL_LENGTH = W - 2.0 * HANDRAIL_END_MARGIN           # 900 by default
HANDRAIL_X1 = HANDRAIL_X0 + HANDRAIL_LENGTH               # tube end
HANDRAIL_BRACKET_X = (
    HANDRAIL_X0 + HANDRAIL_BRACKET_INSET,                 # 200 by default
    HANDRAIL_X1 - HANDRAIL_BRACKET_INSET,                 # 900 by default
)


# -----------------------------------------------------------------------------
# Parts
# -----------------------------------------------------------------------------
def make_floor():
    return box_from_bounds(-T, W + T, -T, D + T, -FLOOR_THICKNESS, 0.0)


def make_ceiling():
    return box_from_bounds(-T, W + T, -T, D + T, H, H + CEILING_THICKNESS)


def make_wall_left():
    return box_from_bounds(-T, 0.0, -T, D + T, 0.0, H)


def make_wall_right():
    return box_from_bounds(W, W + T, -T, D + T, 0.0, H)


def make_wall_back():
    return box_from_bounds(0.0, W, D, D + T, 0.0, H)


def make_wall_front_left():
    return box_from_bounds(0.0, DOOR_X0, -T, 0.0, 0.0, H)


def make_wall_front_right():
    return box_from_bounds(DOOR_X1, W, -T, 0.0, 0.0, H)


def make_front_transom():
    return box_from_bounds(DOOR_X0, DOOR_X1, -T, 0.0, DOOR_CLEAR_HEIGHT, H)


def _door_y_bounds():
    y1 = -T - DOOR_GAP_TO_WALL
    return y1 - DOOR_PANEL_THICKNESS, y1


def _door_slide():
    return DOOR_OPEN_FRACTION * DOOR_CLEAR_WIDTH / 2.0


def make_door_panel_left():
    y0, y1 = _door_y_bounds()
    x0 = DOOR_X0 - DOOR_PANEL_OVERLAP - _door_slide()
    x1 = W / 2.0 - _door_slide()
    return box_from_bounds(x0, x1, y0, y1, 0.0, DOOR_CLEAR_HEIGHT)


def make_door_panel_right():
    y0, y1 = _door_y_bounds()
    x0 = W / 2.0 + _door_slide()
    x1 = DOOR_X1 + DOOR_PANEL_OVERLAP + _door_slide()
    return box_from_bounds(x0, x1, y0, y1, 0.0, DOOR_CLEAR_HEIGHT)


def make_door_sill():
    x0 = (W - SILL_WIDTH) / 2.0
    return box_from_bounds(
        x0, x0 + SILL_WIDTH, -T - SILL_DEPTH, -T, -SILL_THICKNESS, 0.0
    )


def make_handrail_back():
    return cylinder_along(
        "X", HANDRAIL_TUBE_DIAMETER, HANDRAIL_X0, HANDRAIL_LENGTH,
        HANDRAIL_CY, HANDRAIL_CZ,
    )


def make_handrail_bracket(x_center):
    # From the tube centre line to the back wall face, so the bracket is
    # embedded in the tube (no gap at the tube edge).
    y_start = HANDRAIL_CY
    return cylinder_along(
        "Y", HANDRAIL_BRACKET_DIAMETER, y_start, D - y_start, x_center, HANDRAIL_CZ
    )


# -----------------------------------------------------------------------------
# Assembly
# -----------------------------------------------------------------------------
def build_parts():
    """List of (name, Workplane, colour) for every part, in mm."""
    steel = cq.Color(*COLOR_STAINLESS)
    grey = cq.Color(*COLOR_PLACEHOLDER)

    parts = [
        ("floor", make_floor(), grey),
        ("ceiling", make_ceiling(), grey),
        ("wall_left", make_wall_left(), steel),
        ("wall_right", make_wall_right(), steel),
        ("wall_back", make_wall_back(), steel),
        ("wall_front_left", make_wall_front_left(), steel),
        ("wall_front_right", make_wall_front_right(), steel),
        ("front_transom", make_front_transom(), steel),
        ("door_panel_left", make_door_panel_left(), steel),
        ("door_panel_right", make_door_panel_right(), steel),
        ("door_sill", make_door_sill(), grey),
        ("handrail_back", make_handrail_back(), steel),
    ]
    for i, xc in enumerate(HANDRAIL_BRACKET_X, start=1):
        parts.append((f"handrail_bracket_{i}", make_handrail_bracket(xc), steel))
    return parts


def build_assembly(parts, scale=None):
    """cq.Assembly from parts. scale=None keeps mm; otherwise every solid is
    scaled about the origin by that factor (used for the GLB in metres)."""
    assy = cq.Assembly(name=PART_NAME)
    for name, wp, color in parts:
        shape = wp.val() if scale is None else wp.val().scale(scale)
        assy.add(shape, name=name, color=color)
    return assy


def resolve_output_dir():
    if len(sys.argv) > 1 and sys.argv[1].strip():
        out = sys.argv[1]
    elif os.environ.get("OUTPUT_DIR"):
        out = os.environ["OUTPUT_DIR"]
    else:
        out = os.path.join(os.path.dirname(os.path.abspath(__file__)), OUTPUT_SUBDIR)
    os.makedirs(out, exist_ok=True)
    return out


def _assy_export(assy, path, export_type, **kwargs):
    if hasattr(assy, "export"):
        assy.export(path, exportType=export_type, **kwargs)
    else:
        assy.save(path, exportType=export_type, **kwargs)


def export_all(parts, out_dir):
    step_path = os.path.join(out_dir, f"{PART_NAME}.step")
    stl_path = os.path.join(out_dir, f"{PART_NAME}.stl")
    glb_path = os.path.join(out_dir, f"{PART_NAME}.glb")
    written = []

    assy_mm = build_assembly(parts)

    # STEP (mm): keeps part names and colours
    _assy_export(assy_mm, step_path, "STEP")
    written.append(step_path)

    # STL (mm): one combined mesh of all parts (no colours). Parts touch but
    # are not fused, so this is not a single watertight body.
    cq.exporters.export(
        assy_mm.toCompound(),
        stl_path,
        exportType="STL",
        tolerance=STL_TOLERANCE,
        angularTolerance=STL_ANGULAR_TOLERANCE,
    )
    written.append(stl_path)

    # STL per part (mm): each file is one closed solid
    parts_dir = os.path.join(out_dir, PARTS_SUBDIR)
    os.makedirs(parts_dir, exist_ok=True)
    for name, wp, _color in parts:
        part_path = os.path.join(parts_dir, f"{PART_NAME}_{name}.stl")
        cq.exporters.export(
            wp,
            part_path,
            exportType="STL",
            tolerance=STL_TOLERANCE,
            angularTolerance=STL_ANGULAR_TOLERANCE,
        )
        written.append(part_path)

    # GLB (metres): binary glTF with colours (.glb extension selects binary).
    # Geometry is scaled by GLB_SCALE; the linear tolerance is scaled too so the
    # mesh density matches the STL.
    assy_m = build_assembly(parts, scale=GLB_SCALE)
    _assy_export(
        assy_m,
        glb_path,
        "GLTF",
        tolerance=STL_TOLERANCE * GLB_SCALE,
        angularTolerance=STL_ANGULAR_TOLERANCE,
    )
    written.append(glb_path)

    return written


def main():
    out_dir = resolve_output_dir()
    parts = build_parts()
    for p in export_all(parts, out_dir):
        print("wrote", p)


if __name__ == "__main__":
    main()
