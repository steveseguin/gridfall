"""Compile GRIDFALL's authored floor plans into vanilla Doom map lumps.

Coordinates in levels.json use a 128-unit architectural grid. Each occupied
square is a convex subsector; a balanced axial BSP indexes those subsectors.
No geometry, nodes, placements or visibility data are read from Doom's maps.

Beyond rooms, passages and doors, a map can describe machines:
  surface "tag"      names a floor that a trigger moves
  link "gate"        a shutter opened by every switch or trigger of that name
  link "heavy"       that shutter grinds open over about a minute
  link "lift"        a platform cell joining two floor heights
  link "window"      a sill to see and shoot across, too high to climb
  link "block"       a barrier cell (named by "tag") that a trigger sinks into the floor
  link "z"           a level run at a set height, instead of a ramp
  "triggers"         switches and walk-over lines; see ACTIONS
"""
import collections
import json
import math
import random
import struct
from pathlib import Path

UNIT = 128
KEYS = {"blue": (5, 32, "DOORBLU"), "yellow": (6, 34, "DOORYEL"), "red": (13, 33, "DOORRED")}
MONSTERS = {"sentry": 3004, "breacher": 9, "welder": 3001, "rammer": 3002,
            "cloaked rammer": 58, "drone": 3005, "interceptor": 3006, "bastion": 3003}
THEMES = {
    "service": ("STWAR02", "FLOOR4_8", "CEIL5_1", 160),
    "public": ("STWAR01", "FLAT14", "TLITE6_4", 192),
    "office": ("STWAR02", "FLOOR5_4", "TLITE6_6", 176),
    "power": ("METAL", "FLOOR4_8", "TLITE6_4", 168),
    "compute": ("STWAR02", "FLAT23", "TLITE6_6", 160),
    "medical": ("STWAR01", "FLAT14", "TLITE6_6", 208),
    "yard": ("BRICK03", "ROCKS", "F_SKY1", 192),
    "water": ("STWAR01", "FLOOR0_3", "CEIL5_1", 176),
    "machine": ("METAL", "FLOOR7_1", "CEIL5_1", 136),
}


# Line actions by name, in this engine's numbering (it differs from PC Doom's):
# (switch once, switch repeatable, walk-over once, walk-over repeatable).
ACTIONS = {
    "open": (103, 61, 2, 86),           # shutters rise and stay open
    "lower": (102, 45, 19, 83),         # floor drops to the highest floor beside it
    "sink": (23, 60, 38, 82),           # floor drops to the lowest floor beside it
    "raise": (18, 69, 22, 95),          # floor rises to the next higher floor beside it
    "lift": (21, 62, 10, 88),           # platform goes down, waits, then returns
    "crush": (None, None, 25, 73),      # ceiling pounds the floor until stopped
    "stop": (None, None, 57, 74),       # halt a pounding ceiling
    "dark": (None, None, 35, 79),       # lights fall to near black
    "bright": (None, None, 13, 81),     # lights to full
    "teleport": (None, None, 39, 97),   # carry whoever crosses to the tagged pad
}
# Things that give off light, and how much they add to the floor around them.
LIGHT_WALLS = {"LITE5": 56, "EXITSIGN": 40}
LIGHT_PROPS = {2028: 72}        # street lamps
SWITCH_GLOW = 32
FACES = {"W": (-1, 0), "N": (0, 1), "E": (1, 0), "S": (0, -1)}
OPPOSITE = {"W": "E", "E": "W", "N": "S", "S": "N"}
HEADROOM = 56   # player height
STEP = 24       # tallest rise a player can climb


def definitions():
    return json.loads((Path(__file__).parent / "maps/levels.json").read_text(encoding="utf-8"))


def beside(pos):
    return ((pos[0]-1, pos[1]), (pos[0]+1, pos[1]), (pos[0], pos[1]-1), (pos[0], pos[1]+1))


def passage_cells(link):
    path = []
    for (x0, y0), (x1, y1) in zip(link["path"], link["path"][1:]):
        length = abs(x1-x0)+abs(y1-y0)
        for step in range(length+1):
            pos = (x0+(x1-x0)*step//max(1,length), y0+(y1-y0)*step//max(1,length))
            if not path or path[-1] != pos: path.append(pos)
    return path


def machine_tags(spec):
    """Sector tags for named shutters, tagged floors, lifts and trigger targets."""
    tags = {}
    for i, link in enumerate(spec["links"]):
        if link.get("gate"): tags.setdefault(link["gate"], 100+i)
    names = [patch["tag"] for room in spec["rooms"] for patch in room.get("surfaces", []) if patch.get("tag")]
    names += ["lift/%d" % i for i, link in enumerate(spec["links"]) if "lift" in link]
    names += [link["tag"] for link in spec["links"] if "block" in link]
    names += [t["target"] for t in spec.get("triggers", [])]
    for name in names: tags.setdefault(name, 300+len(tags))
    return tags


def all_triggers(spec, cells):
    """Authored triggers, plus each lift's approach, call and boarding lines."""
    triggers = list(spec.get("triggers", []))
    for i, link in enumerate(spec["links"]):
        if "lift" not in link: continue
        path, lift = passage_cells(link), tuple(link["lift"])
        k = path.index(lift)
        low, high = (path[k-1], path[k+1]) if cells[path[0]]["z"] < cells[path[-1]]["z"] else (path[k+1], path[k-1])
        assert low in (path[0], path[-1]), (spec["id"], "a lift must stand beside the lower room", link)
        # Call the lift on entering its lower landing, before the player reaches
        # the raised edge. Keep the front usable if someone waits through a cycle.
        for face, d in FACES.items():
            approach = (low[0]+d[0], low[1]+d[1])
            if approach == lift or approach not in cells: continue
            if cells[approach]["room"] != cells[low]["room"]: continue
            triggers.append(dict(kind="walk", cell=list(low), face=face, action="lift", target="lift/%d" % i, once=False))
        for cell, kind in ((low, "switch"), (high, "walk")):
            face = next(f for f, d in FACES.items() if (cell[0]+d[0], cell[1]+d[1]) == lift)
            triggers.append(dict(kind=kind, cell=list(cell), face=face, action="lift", target="lift/%d" % i, once=False))
    return triggers


def floorplan(spec):
    cells, solid, rooms = {}, {}, {}
    tags = machine_tags(spec)
    for room in spec["rooms"]:
        name = room["id"]
        x, y, w, h = room["rect"]
        wall, floor, ceiling, light = THEMES[room.get("theme", "service")]
        wall, ceiling = room.get("wall", wall), room.get("ceiling", ceiling)
        z = room.get("z", 0)
        base = dict(room=name, wall=wall, floor=room.get("floor", floor), ceiling=ceiling,
                    z=z, top=z+(192 if ceiling == "F_SKY1" else room.get("height", 128)),
                    light=room.get("light", light), special=9 if room.get("secret") else room.get("effect", 0),
                    tag=0, group=name)
        rooms[name] = room
        for xx in range(x, x+w):
            for yy in range(y, y+h):
                assert (xx, yy) not in cells, (spec["id"], "overlapping rooms", name, xx, yy)
                cells[xx, yy] = dict(base)
        for bx, by, bw, bh, texture in room.get("blocks", []):
            for xx in range(x+bx, x+bx+bw):
                for yy in range(y+by, y+by+bh):
                    del cells[xx, yy]
                    solid[xx, yy] = texture
        for fx, fy, fw, fh, z, flat, brightness, special in room.get("floors", []):
            for xx in range(x+fx, x+fx+fw):
                for yy in range(y+fy, y+fy+fh):
                    if (xx, yy) in cells:
                        cells[xx, yy].update(z=z+room.get("z",0), floor=flat, light=brightness, special=special,
                                             group=name+"/"+str((z, flat, brightness, special)))
        # Counters, machinery plinths, skylights and pools are static sectors.
        # Their material changes follow a physical edge, not a painted floor patch.
        for patch_index, patch in enumerate(room.get("surfaces", [])):
            px, py, pw, ph = patch["rect"]
            for xx in range(x+px, x+px+pw):
                for yy in range(y+py, y+py+ph):
                    if (xx, yy) not in cells: continue
                    c = cells[xx, yy]
                    for key in ("floor", "ceiling", "wall", "light", "special"):
                        if key in patch: c[key] = patch[key]
                    if "z" in patch: c["z"] = room.get("z", 0)+patch["z"]
                    if "height" in patch: c["top"] = room.get("z", 0)+patch["height"]
                    if "tag" in patch: c.update(tag=tags.get(patch["tag"], 0), name=patch["tag"] or None)
                    c["group"] = name+"/surface/"+str(patch_index)
    gates = {}
    for i, link in enumerate(spec["links"]):
        points = link["path"]
        for (x0, y0), (x1, y1) in zip(points, points[1:]):
            assert x0 == x1 or y0 == y1, (spec["id"], "non-axial passage", link)
        path = passage_cells(link)
        z0, z1 = cells[tuple(points[0])]["z"], cells[tuple(points[-1])]["z"]
        height = link.get("height", 128)
        for j, pos in enumerate(path):
            assert pos not in solid, (spec["id"], "passage crosses solid", pos)
            if pos not in cells:
                z = round((z0+(z1-z0)*j/max(1,len(path)-1))/8)*8
                top = max(z0,z1)+height
                if "z" in link: z, top = link["z"], link["z"]+height
                if "lift" in link: z = max(z0, z1)
                if link.get("window"): z, top = max(z0,z1)+32, max(z0,z1)+96
                cells[pos] = dict(room="passage", wall=link.get("wall", "STWAR02"),
                                  floor=link.get("floor", "FLOOR4_8"), ceiling=link.get("ceiling", "CEIL5_1"),
                                  z=z, top=top, light=link.get("light",160),
                                  special=link.get("effect", 0), tag=0, group="passage")
        if "lift" in link:
            pos, name = tuple(link["lift"]), "lift/%d" % i
            assert pos in path and cells[pos]["room"] == "passage" and abs(z0-z1) > STEP, (spec["id"], "lift", link)
            cells[pos].update(tag=tags[name], name=name, group=name, floor="STEP1", wall="COMPSPAN")
            # A distinct lower landing keeps the call active while somebody waits.
            landing = path[0] if z0 < z1 else path[-1]
            assert cells[landing]["special"] == 0 and not cells[landing]["tag"], (spec["id"], "lift landing", landing)
            cells[landing].update(special=20, group=name+"/landing")
        if "block" in link:
            pos = tuple(link["block"])
            assert pos in path and cells[pos]["room"] == "passage", (spec["id"], "barrier", link)
            cells[pos].update(z=cells[pos]["z"]+64, tag=tags[link["tag"]], name=link["tag"], group="block/%d" % i,
                              floor="STEP1", wall="COMPSPAN")
        if "at" in link:
            pos = tuple(link["at"])
            assert pos in cells and pos not in gates
            gate = dict(link, tag=tags.get(link.get("gate"), 100+i))
            gates[pos] = gate
            cells[pos].update(top=cells[pos]["z"], tag=gate["tag"], group="gate/"+str(i),
                              special=15 if link.get("heavy") else 0)
    for trigger in spec.get("triggers", []):
        if trigger["action"] == "teleport":     # the arrival pad is its own tagged sector
            pos = tuple(trigger["dest"])
            assert pos in cells and pos not in gates, (spec["id"], "teleport pad", trigger)
            cells[pos].update(tag=tags[trigger["target"]], name=trigger["target"], group="pad/"+trigger["target"])
    # Lights light: lamps, light panels and controls brighten the floor around them, within their own room.
    glow = {}
    def shine(pos, amount, spread=True):
        if pos not in cells: return
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                near = (pos[0]+dx, pos[1]+dy)
                if (dx or dy) and not spread: continue
                if near not in cells or cells[near]["room"] != cells[pos]["room"]: continue
                if dx and dy and ((pos[0]+dx, pos[1]) not in cells or (pos[0], pos[1]+dy) not in cells): continue
                part = amount if not (dx or dy) else amount*2//3 if not (dx and dy) else amount//2
                glow[near] = max(glow.get(near, 0), part)
    for accent in spec.get("walls", []):
        if accent["texture"] in LIGHT_WALLS: shine(tuple(accent["cell"]), LIGHT_WALLS[accent["texture"]])
    for prop in spec.get("props", []):
        if prop["type"] in LIGHT_PROPS: shine(tuple(prop["cell"]), LIGHT_PROPS[prop["type"]])
    for control in spec.get("switches", [])+[t for t in spec.get("triggers", []) if t["kind"] == "switch"]:
        shine(tuple(control["cell"]), SWITCH_GLOW, False)
    pads = [tuple(spec["exit"]["cell"])]
    if "secret_exit" in spec: pads.append(tuple(spec["secret_exit"]["cell"]))
    for pos, amount in glow.items():
        c = cells[pos]
        if c["tag"] or c.get("name") or c["special"] == 9 or pos in gates or pos in pads: continue
        c["light"] = min(255, c["light"]+amount)
    # The end control stands in the same booth on every map: hazard floor, lit canopy, pulsing light.
    for i, pad in enumerate(pads):
        cells[pad].update(floor="GATE3", ceiling="TLITE6_6", top=cells[pad]["z"]+128, light=255, special=8,
                          group="exit" if not i else "secret-exit")
    return cells, solid, rooms, gates


def compile_map(spec):
    cells, solid, rooms, gates = floorplan(spec)
    validate_routes(spec, cells, gates)
    positions = sorted(cells)
    sectors, sector_ids, cell_sector = [], {}, {}
    def name(s): return s.encode("ascii").ljust(8, b"\0")
    for pos, c in sorted(cells.items()):
        key = (c["group"], c["z"], c["top"], c["floor"], c["ceiling"], c["light"], c["special"], c["tag"])
        if key not in sector_ids:
            sector_ids[key] = len(sectors)
            sectors.append((c["z"], c["top"], name(c["floor"]), name(c["ceiling"]), c["light"], c["special"], c["tag"]))
        cell_sector[pos] = sector_ids[key]
    # A shutter is a 16-unit panel between two stationary door recesses.
    # Only authored narrow passages opt in; other maps retain their geometry.
    regions = [dict(cell=pos, data=cells[pos], gate=gates.get(pos),
                    rect=(pos[0]*UNIT, pos[1]*UNIT, (pos[0]+1)*UNIT, (pos[1]+1)*UNIT))
               for pos in positions]
    door_leaves = {}
    for index, pos in enumerate(positions):
        gate = gates.get(pos)
        if not gate or not gate.get("thin"): continue
        x, y = pos
        neighbors = [(x-1,y), (x+1,y), (x,y-1), (x,y+1)]
        available = [p in cells for p in neighbors]
        assert available in ([True,True,False,False], [False,False,True,True]), (spec["id"], "shutter needs straight jambs", pos)
        axis = 0 if available[0] else 1
        lo = (x if axis == 0 else y)*UNIT
        cuts = (lo, lo+56, lo+72, lo+UNIT)
        leaves = []
        full_rect = regions[index]["rect"]
        for part in range(3):
            rect = list(full_rect)
            rect[axis], rect[axis+2] = cuts[part], cuts[part+1]
            if part == 1:
                regions[index]["rect"] = tuple(rect)
                leaves.append(index)
            else:
                approach = cells[neighbors[(0 if axis == 0 else 2)+(part//2)]]
                c = dict(cells[pos], top=min(approach["top"], cells[pos]["z"]+gate.get("height",128)),
                         tag=0, group="jamb/"+str(pos)+"/"+str(part))
                sector = len(sectors)
                sectors.append((c["z"], c["top"], name(c["floor"]), name(c["ceiling"]), c["light"], 0, 0))
                leaves.append(len(regions))
                regions.append(dict(cell=pos, data=c, gate=None, rect=tuple(rect), sector=sector))
        door_leaves[index] = (axis, cuts[1:3], leaves)
    for region in regions:
        if "sector" not in region: region["sector"] = cell_sector[region["cell"]]
    vertices, vertex_ids, lines, sides, edge_ids = [], {}, [], [], {}
    segs, subsectors, nodes = [], [], []
    def vertex(p):
        if p not in vertex_ids: vertex_ids[p] = len(vertices); vertices.append(p)
        return vertex_ids[p]
    switches = {}
    accents = {(tuple(a["cell"]), a["face"]): a["texture"] for a in spec.get("walls", [])}
    tags = machine_tags(spec)
    for switch in spec.get("switches", []):
        assert any(g.get("gate") == switch["opens"] for g in gates.values()), (spec["id"], "switch target", switch)
        switches[tuple(switch["cell"]), switch["face"]] = (103, tags[switch["opens"]], "SW1STAR")
    # Triggers on a wall become switches. On an open edge they are walk-over
    # lines (or a lift's call face); the cell they name is the line's front.
    crossings = {}
    for trigger in all_triggers(spec, cells):
        cell, face = tuple(trigger["cell"]), trigger["face"]
        assert cell in cells and cell not in gates, (spec["id"], "trigger", trigger)
        column = (0 if trigger["kind"] == "switch" else 2)+(0 if trigger.get("once", True) else 1)
        special = ACTIONS[trigger["action"]][column]
        assert special, (spec["id"], "no such trigger", trigger)
        beyond = (cell[0]+FACES[face][0], cell[1]+FACES[face][1])
        assert (cell, face) not in crossings and (beyond, OPPOSITE[face]) not in crossings, (spec["id"], "two triggers on one line", trigger)
        if beyond in cells: crossings[cell, face] = (special, tags[trigger["target"]])
        else:
            assert trigger["kind"] == "switch", (spec["id"], "walk-over line on a wall", trigger)
            switches[cell, face] = (special, tags[trigger["target"]], trigger.get("texture", "SW1STAR"))
    switches[tuple(spec["exit"]["cell"]), spec["exit"]["face"]] = (11, 0, "SW1GARG")
    if "secret_exit" in spec:
        switches[tuple(spec["secret_exit"]["cell"]), spec["secret_exit"]["face"]] = (51, 0, "SW1GARG")
    edges = [("W", (0,0), (0,1), (-1,0)), ("N", (0,1), (1,1), (0,1)),
             ("E", (1,1), (1,0), (1,0)), ("S", (1,0), (0,0), (0,-1))]
    region_edges, owners = [], {}
    for index, region in enumerate(regions):
        x0, y0, x1, y1 = region["rect"]
        boundary = [("W",(x0,y0),(x0,y1)), ("N",(x0,y1),(x1,y1)),
                    ("E",(x1,y1),(x1,y0)), ("S",(x1,y0),(x0,y0))]
        region_edges.append(boundary)
        for face, p, q in boundary:
            owners.setdefault(tuple(sorted((p,q))), []).append(index)
    for index, region in enumerate(regions):
        x, y = region["cell"]
        first = len(segs)
        for face, p, q in region_edges[index]:
            edge = tuple(sorted((p,q)))
            if edge not in edge_ids:
                adjacent = owners[edge]
                assert len(adjacent) <= 2
                front = index
                back = next((i for i in adjacent if i != index), None)
                v1, v2 = p, q
                # Manual doors act on the back sector, from either approach.
                if regions[front]["gate"] and back is not None:
                    front, back = back, front; v1, v2 = q, p
                delta = next(e[3] for e in edges if e[0] == face)
                neighbor = (x+delta[0], y+delta[1])
                crossing = crossings.get(((x,y), face), (0, 0))
                if back is not None and (neighbor, OPPOSITE[face]) in crossings and regions[back]["cell"] == neighbor:
                    crossing = crossings[neighbor, OPPOSITE[face]]
                    front, back = back, front; v1, v2 = q, p
                special, tag, texture = switches.get(((x,y), face),
                    (0, 0, accents.get(((x,y), face), solid.get(neighbor, region["data"]["wall"]))))
                assert not special or back is None, (spec["id"], "switch lacks a wall", x, y, face)
                gate = regions[back]["gate"] if back is not None else None
                if gate:
                    if gate.get("key"):
                        _, special, texture = KEYS[gate["key"]]
                    else:
                        special = 31 if gate.get("secret") or gate.get("door") else 0
                        texture = gate.get("texture", regions[front]["data"]["wall"] if gate.get("secret") else "DOOR1")
                indices = []
                for part in (front, back):
                    if part is None: indices.append(65535); continue
                    indices.append(len(sides))
                    c = regions[part]["data"]
                    side_texture = texture if special or gate or back is None else c["wall"]
                    lower = side_texture
                    if spec.get("architectural_edges") and back is not None:
                        other_part = regions[back if part == front else front]
                        other = other_part["data"]
                        if other["z"] > c["z"]:
                            lower = other["wall"]
                            low_cell, high_cell = regions[part]["cell"], other_part["cell"]
                            direction = (low_cell[0]-high_cell[0], low_cell[1]-high_cell[1])
                            high_face = next((e[0] for e in edges if e[3] == direction), None)
                            lower = accents.get((high_cell, high_face), lower)
                    # On a solid wall taller than its picture, hang the picture from the floor up, so a
                    # control, sign or lamp is whole at eye level and any repeat is overhead.
                    tall = c["top"]-c["z"] if back is None else 0
                    drop = (UNIT-tall%UNIT)%UNIT if tall > UNIT else 0
                    sides.append((0, drop, name(side_texture), name(lower), name(texture if back is None else "-"), regions[part]["sector"]))
                flags = 4 if back is not None else 1
                if gate and gate.get("secret"): flags |= 32
                edge_ids[edge] = len(lines)
                lines.append((vertex(v1), vertex(v2), flags, special or crossing[0], tag or crossing[1], *indices))
            line_index = edge_ids[edge]; line = lines[line_index]
            side = 0 if vertices[line[0]] == p else 1
            angle = round(math.atan2(q[1]-p[1], q[0]-p[0]) * 65536 / (2*math.pi)) & 65535
            segs.append((vertex(p), vertex(q), angle, line_index, side, 0))
        subsectors.append((len(segs)-first, first))
    def region_box(index):
        x0,y0,x1,y1 = regions[index]["rect"]
        return y1,y0,x0,x1
    def door_bsp(index):
        axis, cuts, leaves = door_leaves[index]
        def divider(cut): return (cut,0,0,UNIT) if axis == 0 else (0,cut,UNIT,0)
        low, middle, high = leaves
        front, back = (high,middle) if axis == 0 else (middle,high)
        nodes.append((*divider(cuts[1]), *region_box(front), *region_box(back), 0x8000|front, 0x8000|back))
        upper = len(nodes)-1
        midbox, highbox = region_box(middle), region_box(high)
        joined = (max(midbox[0],highbox[0]), min(midbox[1],highbox[1]), min(midbox[2],highbox[2]), max(midbox[3],highbox[3]))
        if axis == 0:
            nodes.append((*divider(cuts[0]), *joined, *region_box(low), upper, 0x8000|low))
        else:
            nodes.append((*divider(cuts[0]), *region_box(low), *joined, 0x8000|low, upper))
        return len(nodes)-1
    def bbox(indices):
        points = [positions[i] for i in indices]
        return ((max(p[1] for p in points)+1)*UNIT, min(p[1] for p in points)*UNIT,
                min(p[0] for p in points)*UNIT, (max(p[0] for p in points)+1)*UNIT)
    def bsp(indices):
        if len(indices) == 1:
            index = indices[0]
            return door_bsp(index) if index in door_leaves else 0x8000 | index
        axis = 0 if len({positions[i][0] for i in indices}) >= len({positions[i][1] for i in indices}) else 1
        values = sorted({positions[i][axis] for i in indices}); split = values[len(values)//2]
        low = [i for i in indices if positions[i][axis] < split]; high = [i for i in indices if positions[i][axis] >= split]
        assert low and high
        front, back = (high, low) if axis == 0 else (low, high)
        a, b = bsp(front), bsp(back)
        node = (split*UNIT, 0, 0, UNIT) if axis == 0 else (0, split*UNIT, UNIT, 0)
        nodes.append((*node, *bbox(front), *bbox(back), a, b))
        return len(nodes)-1
    bsp(list(range(len(positions))))
    things, occupied = [], set()
    def thing(cell, kind, flags=7, angle=0, offset=(0,0)):
        pos = tuple(cell); assert pos in cells and pos not in gates, (spec["id"], "invalid thing", cell, kind)
        assert cells[pos]["top"]-cells[pos]["z"] >= 64
        things.append((pos[0]*UNIT+UNIT//2+offset[0], pos[1]*UNIT+UNIT//2+offset[1], angle, kind, flags))
        occupied.add(pos)
    thing(spec["start"]["cell"], 1, angle=spec["start"].get("angle", 90))
    for key in spec.get("keys", []): thing(key["cell"], KEYS[key["color"]][0])
    for t in spec.get("items", [])+spec.get("props", [])+spec.get("enemies", []):
        thing(t["cell"], t["type"], t.get("flags",7), t.get("angle",0), t.get("offset",(0,0)))
    for trigger in spec.get("triggers", []):
        if trigger["action"] == "teleport": thing(trigger["dest"], 14, angle=trigger.get("angle", 0))
    rng = random.Random(47000+spec["id"])
    candidates = [p for p in positions if p not in occupied and p not in gates and cells[p]["room"] not in ("passage", spec["start"]["room"])
                  and cells[p]["z"]-rooms[cells[p]["room"]].get("z",0) < 24 and not rooms[cells[p]["room"]].get("secret")]
    rng.shuffle(candidates)
    enemies = [MONSTERS[kind] for kind, count in spec.get("monsters", {}).items() for _ in range(count)]
    assert len(candidates) >= len(enemies), (spec["id"], "encounter capacity")
    # Keep heavy machines deeper in the facility. A pistol start must not open
    # directly onto a randomly placed group of armored machines.
    distance = {tuple(spec["start"]["cell"]): 0}
    queue = collections.deque(distance)
    while queue:
        x, y = queue.popleft()
        for pos in ((x-1,y), (x+1,y), (x,y-1), (x,y+1)):
            if pos in cells and pos not in distance:
                distance[pos] = distance[x,y]+1
                queue.append(pos)
    enemies.sort(key=lambda kind: {3003: 4, 3005: 3, 3002: 2, 58: 2}.get(kind, 0), reverse=True)
    for i, kind in enumerate(enemies):
        # Every third encounter is medium/hard only; others also appear on easy.
        if kind in (3003, 3005, 3002, 58):
            allowed = spec.get("encounters", {}).get(str(kind))
            pool = [p for p in candidates if cells[p]["room"] in allowed] if allowed else candidates
            assert pool, (spec["id"], "encounter area exhausted", kind)
            ranked = sorted(pool, key=lambda p: distance.get(p, 0))
            pos = rng.choice(ranked if allowed else ranked[len(ranked)//2:])
            candidates.remove(pos)
        else:
            pos = candidates.pop()
        thing(pos, kind, (6 if i%3 == 2 else 7) | (8 if i%3 else 0), rng.choice((0,90,180,270)))
    # Supplies are placed in room interiors, never inside a door or solid prop.
    supplies = spec.get("supplies", [2008, 2007, 2011, 2008, 2049, 2012])
    for i in range(min(len(candidates), spec.get("supply_count", max(4, len(enemies)//2)))):
        thing(candidates.pop(), supplies[i%len(supplies)])
    # Spread eight starts across distinct rooms; avoid raised props and hazards.
    deathmatch = spec.get("deathmatch")
    if deathmatch is None:
        deathmatch = [spec["start"]["cell"]]
        for room in spec["rooms"][1:]:
            choices = [p for p in positions if cells[p]["room"] == room["id"] and p not in gates
                       and cells[p]["z"] == room.get("z", 0) and cells[p]["special"] != 5
                       and (not spec.get("architectural_edges") or p not in occupied)]
            if choices:
                deathmatch.append(list(rng.choice(choices)))
            if len(deathmatch) == 8: break
    assert len(deathmatch) >= 4, (spec["id"], "not enough deathmatch starts")
    # A campaign switch may be on the far side of a spawn's only way out.
    # Keep each start able to return to the common area on a fresh deathmatch.
    routes = Routes(spec, cells, gates)
    home = tuple(spec["start"]["cell"])
    safe, queue = {home}, collections.deque([home])
    while queue:
        a = queue.popleft()
        for b in beside(a):
            if b in cells and b not in safe and routes.step(a, b, 7, 0) and routes.step(b, a, 7, 0):
                safe.add(b); queue.append(b)
    deathmatch = [list(p) for p in deathmatch[:8]]
    for i, pos in enumerate(deathmatch):
        if home in routes.explore(start_pos=tuple(pos), held=7)[0]: continue
        choices = sorted(p for p in safe if p not in occupied and p not in gates
                         and list(p) not in deathmatch and cells[p]["special"] not in (4, 5, 7, 16)
                         and cells[p]["top"] - cells[p]["z"] >= HEADROOM)
        assert choices, (spec["id"], "no escapable deathmatch spawn", pos)
        deathmatch[i] = list(max(choices, key=lambda p: min((p[0]-q[0])**2+(p[1]-q[1])**2 for q in deathmatch)))
    for i, pos in enumerate(deathmatch[:8]): thing(pos, 11, angle=i*45)
    minx, miny = min(x for x,y in vertices)-8, min(y for x,y in vertices)-8
    width = (max(x for x,y in vertices)-minx)//128+1; height = (max(y for x,y in vertices)-miny)//128+1
    blocks = [[] for _ in range(width*height)]
    for i, line in enumerate(lines):
        a, b = vertices[line[0]], vertices[line[1]]
        for cy in range((min(a[1],b[1])-miny)//128,(max(a[1],b[1])-miny)//128+1):
            for cx in range((min(a[0],b[0])-minx)//128,(max(a[0],b[0])-minx)//128+1): blocks[cy*width+cx].append(i)
    blockmap = [minx&65535, miny&65535, width, height]+[0]*len(blocks)
    for i, block in enumerate(blocks): blockmap[4+i] = len(blockmap); blockmap.extend([0]+block+[65535])
    assert len(blockmap) < 65536 and len(segs) < 65536 and len(subsectors) < 32768
    def pack(fmt, rows): return b"".join(struct.pack("<"+fmt,*row) for row in rows)
    lumps = {"THINGS":pack("hhhHH",things), "LINEDEFS":pack("7H",lines), "SIDEDEFS":pack("hh8s8s8sH",sides),
             "VERTEXES":pack("hh",vertices), "SEGS":pack("6H",segs), "SSECTORS":pack("HH",subsectors),
             "SECTORS":pack("hh8s8shHH",sectors), "NODES":pack("12h2H",nodes),
             "REJECT":bytes((len(sectors)**2+7)//8), "BLOCKMAP":struct.pack("<"+"H"*len(blockmap),*blockmap)}
    return lumps, dict(cells=cells, gates=gates, things=things, sectors=sectors, lines=lines, vertices=vertices)


class Routes:
    """Where a player on foot can go as cards, switches and machines change the map."""

    def __init__(self, spec, cells, gates):
        self.spec, self.cells, self.gates = spec, cells, gates
        self.keys = {tuple(k["cell"]): k["color"] for k in spec.get("keys", [])}
        self.key_bits = {color: 1 << i for i, color in enumerate(KEYS)}
        triggers = all_triggers(spec, cells)
        names = [g["gate"] for g in gates.values() if g.get("gate")]+[t["target"] for t in triggers]
        self.bits = {name: 1 << i for i, name in enumerate(dict.fromkeys(names))}
        self.worked = collections.defaultdict(int)      # switches, by the cell they are worked from
        self.crossed = collections.defaultdict(int)     # walk-over lines, in either direction
        self.teleports = {}
        self.faces = collections.defaultdict(list)      # cell -> [(name, wall face)]
        for switch in spec.get("switches", []):
            self.worked[tuple(switch["cell"])] |= self.bits[switch["opens"]]
            self.faces[tuple(switch["cell"])].append((switch["opens"], switch["face"]))
        for trigger in triggers:
            a, d = tuple(trigger["cell"]), FACES[trigger["face"]]
            b, bit = (a[0]+d[0], a[1]+d[1]), self.bits[trigger["target"]]
            if trigger["action"] == "teleport": self.teleports[a, b] = tuple(trigger["dest"])
            elif trigger["kind"] == "switch":
                self.worked[a] |= bit
                self.faces[a].append((trigger["target"], trigger["face"]))
            else:
                self.crossed[a, b] |= bit; self.crossed[b, a] |= bit
        # Where each tagged floor comes to rest, by the engine's own rules.
        self.moved, self.lifts = {}, {}
        actions = {t["target"]: t["action"] for t in triggers}
        floors = collections.defaultdict(list)
        for pos, c in cells.items():
            if c.get("name") in actions: floors[c["name"], c["group"]].append(pos)
        for (name, _), members in floors.items():
            here = cells[members[0]]["z"]
            around = [cells[n]["z"] for p in members for n in beside(p) if n in cells and cells[n].get("name") != name]
            if actions[name] == "lower": rest = max(around)
            elif actions[name] == "sink": rest = min(around+[here])
            elif actions[name] == "raise":
                assert any(z > here for z in around), (spec["id"], "nothing higher to rise to", name)
                rest = min(z for z in around if z > here)
            elif actions[name] == "lift":
                for p in members: self.lifts[p] = min(around+[here])
                continue
            else: continue
            for p in members: self.moved[p] = (self.bits[name], rest)

    def z(self, pos, active):
        moved = self.moved.get(pos)
        return moved[1] if moved and active & moved[0] else self.cells[pos]["z"]

    def step(self, a, b, held, active):
        gate = self.gates.get(b, {})
        if gate.get("key") and not held & self.key_bits[gate["key"]]: return False
        if gate.get("gate") and not active & self.bits[gate["gate"]]: return False
        za, zb = self.z(a, active), self.z(b, active)
        stops_a = (za, self.lifts[a]) if a in self.lifts else (za,)
        stops_b = (zb, self.lifts[b]) if b in self.lifts else (zb,)
        # Players can drop farther than 24 units; only climbing has that limit.
        if not any(q-p <= STEP for p in stops_a for q in stops_b): return False
        if a in self.gates or b in self.gates or a in self.lifts or b in self.lifts: return True
        return min(self.cells[a]["top"], self.cells[b]["top"])-max(za, zb) >= HEADROOM

    def explore(self, without_key=None, without=None, start_pos=None, held=0):
        """Reached cells, and how each (cell, cards, machines) state was first entered."""
        start = (tuple(self.spec["start"]["cell"]) if start_pos is None else start_pos, held, 0)
        queue, came, reached = collections.deque([start]), {start: None}, set()
        while queue:
            state = queue.popleft()
            pos, held, active = state
            reached.add(pos)
            for step in beside(pos):
                if step not in self.cells or not self.step(pos, step, held, active): continue
                arrive = self.teleports.get((pos, step), step)
                gain = self.crossed.get((pos, step), 0) | self.worked.get(arrive, 0)
                if without: gain &= ~self.bits[without]
                color = self.keys.get(arrive)
                found = self.key_bits[color] if color and color != without_key else 0
                after = (arrive, held | found, active | gain)
                if after not in came: came[after] = (state, step); queue.append(after)
        return reached, came


def validate_routes(spec, cells, gates):
    """Reject disconnected objectives, and cards or controls that can be bypassed."""
    routes = Routes(spec, cells, gates)
    exit_cell = tuple(spec["exit"]["cell"])
    reached, _ = routes.explore()
    if exit_cell not in reached: raise ValueError(f"Map {spec['id']}: exit is unreachable")
    if "secret_exit" in spec and tuple(spec["secret_exit"]["cell"]) not in reached:
        raise ValueError(f"Map {spec['id']}: secret exit is unreachable")
    for color in set(routes.keys.values()):
        if exit_cell in routes.explore(without_key=color)[0]:
            raise ValueError(f"Map {spec['id']}: {color} card is not required")
    required = [s["opens"] for s in spec.get("switches", [])]
    required += [t["target"] for t in spec.get("triggers", []) if t.get("required")]
    for name in dict.fromkeys(required):
        if exit_cell in routes.explore(without=name)[0]:
            raise ValueError(f"Map {spec['id']}: the {name} control can be bypassed")
    for item in spec.get("items", [])+spec.get("keys", []):
        if tuple(item["cell"]) not in reached:
            raise ValueError(f"Map {spec['id']}: unreachable item at {item['cell']}")


def walkthrough(spec):
    """One way to finish the map: cells to walk through and wall faces to use, in order."""
    cells, solid, rooms, gates = floorplan(spec)
    routes = Routes(spec, cells, gates)
    exit_cell = tuple(spec["exit"]["cell"])
    reached, came = routes.explore()
    state = next(s for s in came if s[0] == exit_cell)
    chain = []
    while came[state]:
        chain.append((state, *came[state]))
        state = came[state][0]
    steps = []
    for (pos, held, active), before, via in reversed(chain):
        steps.append(["go", *via])
        if via != pos: steps.append(["arrive", *pos])
        for name, face in routes.faces.get(pos, []):
            if routes.bits[name] & active & ~before[2]: steps.append(["use", face])
    steps.append(["use", spec["exit"]["face"]])
    return steps
