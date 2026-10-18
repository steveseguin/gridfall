"""Floor-plan helpers for the room designs in map_designs.py.

Room shapes, corridor routing, vault placement and the order a player
reaches each room. Everything works on the 128-unit grid of campaign_maps.
"""
import collections
import heapq
import math

from campaign_maps import Routes, floorplan

DIRS = {'E': (1, 0), 'N': (0, 1), 'W': (-1, 0), 'S': (0, -1)}
MON = {'s': 3004, 'b': 9, 'w': 3001, 'r': 3002, 'c': 58, 'd': 3005, 'i': 3006, 'B': 3003}
HP = {3004: 20, 9: 30, 3001: 60, 3002: 150, 58: 150, 3005: 400, 3006: 100, 3003: 1000}
FLYERS = {3005, 3006}
ITEM = {'SG': 2001, 'MG': 2002, 'RL': 2003, 'PR': 2004, 'SAW': 2005, 'EMP': 2006,
        'ARM': 2018, 'MEGA': 2019, 'SOUL': 2013, 'INV': 2022, 'BSK': 2023, 'INVIS': 2024,
        'SUIT': 2025, 'MAP': 2026, 'VIS': 2045, 'MEDI': 2012, 'STIM': 2011,
        'CLIP': 2007, 'BULL': 2048, 'SHEL': 2008, 'SBOX': 2049, 'RBOX': 2046, 'CELL': 2047, 'CPAK': 17}
STYLES = {
    'office':   dict(wall='STWAR01', floor='FLOOR5_4', ceiling='TLITE6_6', light=192, height=112, alt='FLAT23', trim='METAL', acc=['COMTAL02', 'LITE5'], pillar='STWAR01'),
    'service':  dict(wall='STWAR02', floor='FLOOR4_8', ceiling='CEIL3_4', light=176, height=112, alt='STEP1', trim='METAL', acc=['LITE5', 'PIPE2'], pillar='METAL'),
    'concrete': dict(wall='GRAY5', floor='FLOOR0_3', ceiling='CEIL3_2', light=176, height=128, alt='STEP1', trim='GRAY5', acc=['PIPE2', 'LITE5'], pillar='GRAY5'),
    'tile':     dict(wall='CBLUE01', floor='FLOOR0_1', ceiling='TLITE6_6', light=200, height=128, alt='FLOOR5_4', trim='CBLUE01', acc=['LITE5', 'BRICK02'], pillar='CBLUE01'),
    'ruin':     dict(wall='BRICK03', floor='FLOOR0_1', ceiling='CEIL3_2', light=176, height=128, alt='FLOOR0_3', trim='BRICK03', acc=['BRICK02', 'BRICK01'], pillar='BRICK03'),
    'plant':    dict(wall='METAL', floor='STEP1', ceiling='CEIL3_4', light=176, height=160, alt='FLOOR4_8', trim='METAL', acc=['TECH02', 'PIPE2', 'LITE5'], pillar='PIPE2'),
    'power':    dict(wall='METAL', floor='FLOOR4_8', ceiling='CEIL3_4', light=176, height=144, alt='STEP1', trim='TECH02', acc=['TECH02', 'LITE5'], pillar='TECH02'),
    'compute':  dict(wall='COMPSPAN', floor='FLAT23', ceiling='TLITE6_6', light=184, height=128, alt='FLOOR6_1', trim='COMPTALL', acc=['COMPTALL', 'COMTAL02'], pillar='COMPTALL'),
    'warn':     dict(wall='BROWN1', floor='FLOOR4_8', ceiling='CEIL3_4', light=184, height=128, alt='STEP1', trim='METAL', acc=['TECH02', 'LITE5'], pillar='METAL'),
    'yard':     dict(wall='BRICK03', floor='FLOOR0_3', ceiling='F_SKY1', light=208, alt='STEP1', trim='BRICK03', acc=['BRICK02'], pillar='BRICK03'),
    'street':   dict(wall='BRICK03', floor='FLOOR0_3', ceiling='F_SKY1', light=208, alt='FLOOR0_1', trim='GRAY5', acc=['BRICK02', 'BRICK01'], pillar='GRAY5'),
    'field':    dict(wall='METAL', floor='GRASS', ceiling='F_SKY1', light=208, alt='STEP1', trim='TECH02', acc=['TECH02'], pillar='TECH02'),
    'machine':  dict(wall='METAL', floor='FLOOR6_1', ceiling='CEIL3_4', light=184, height=160, alt='STEP1', trim='SP_HOT1', acc=['SP_HOT1', 'PIPE2'], pillar='SP_HOT1'),
    'core':     dict(wall='COMPSPAN', floor='FLOOR6_2', ceiling='CEIL5_1', light=184, height=144, alt='FLAT23', trim='COMPTALL', acc=['SP_HOT1', 'COMPTALL'], pillar='SP_HOT1'),
    'water':    dict(wall='GRAY5', floor='FLOOR0_1', ceiling='CEIL3_4', light=176, height=128, alt='STEP1', trim='GRAY5', acc=['PIPE2', 'LITE5'], pillar='PIPE2'),
    'medical':  dict(wall='STWAR01', floor='FLOOR0_1', ceiling='TLITE6_6', light=208, height=112, alt='FLOOR5_4', trim='STWAR01', acc=['LITE5', 'COMTAL02'], pillar='STWAR01'),
    'vault':    dict(wall='STWAR02', floor='FLOOR5_4', ceiling='TLITE6_6', light=192, height=96, alt='FLAT23', trim='METAL', acc=['LITE5'], pillar='METAL'),
}
INDUSTRIAL = ('plant', 'power', 'machine', 'core', 'warn', 'service', 'compute', 'field', 'yard')


def sign(v): return (v > 0) - (v < 0)


def room_at(spec, cell):
    for r in spec['rooms']:
        x, y, w, h = r['rect']
        if x <= cell[0] < x + w and y <= cell[1] < y + h: return r
    return None


def mouths(spec):
    """(link index, room id, mouth cell, outward direction) for both ends of every link."""
    out = []
    for i, link in enumerate(spec['links']):
        p = link['path']
        for end, nxt in ((p[0], p[1]), (p[-1], p[-2])):
            r = room_at(spec, end)
            out.append((i, r['id'] if r else None, tuple(end), (sign(nxt[0] - end[0]), sign(nxt[1] - end[1]))))
    return out


def lcg(seed):
    state = [sum((i + 1) * ord(c) for i, c in enumerate(str(seed))) * 2654435761 % 2**32 or 1]
    def nxt(n):
        state[0] = (state[0] * 1103515245 + 12345) % 2**31
        return (state[0] >> 8) % n
    return nxt


# ---------------------------------------------------------------- room shapes
def build_shape(room, style, ops, hard, seed, lane=frozenset()):
    """Return (blocks, surfaces) in room-local cells; never covers a protected cell."""
    W, H = room['rect'][2], room['rect'][3]
    st = STYLES[style]
    sky = st['ceiling'] == 'F_SKY1'
    height = room.get('height', st.get('height', 128))
    blocks, surfaces = [], []
    solid = set()        # local cells removed or raised out of reach

    def cells_of(rect): return {(x, y) for x in range(rect[0], rect[0] + rect[2]) for y in range(rect[1], rect[1] + rect[3])}
    def inside(rect): return rect[2] > 0 and rect[3] > 0 and rect[0] >= 0 and rect[1] >= 0 and rect[0] + rect[2] <= W and rect[1] + rect[3] <= H
    def clear(rect, pad=0):
        if not inside(rect): return False
        grown = cells_of((rect[0] - pad, rect[1] - pad, rect[2] + 2 * pad, rect[3] + 2 * pad))
        return not (cells_of(rect) & (hard | lane)) and not (grown & solid)
    def block(rect, tex, pad=0):
        if clear(rect, pad):
            blocks.append([*rect, tex]); solid.update(cells_of(rect)); return True
        return False
    def raised(rect, z, floor, wall, pad=1, light=None):
        if clear(rect, pad):
            s = dict(rect=list(rect), z=z, floor=floor, wall=wall)
            if light is not None: s['light'] = light
            surfaces.append(s); solid.update(cells_of(rect)); return True
        return False
    def side_strip(side, start, depth):
        if side == 'N': return (0, H - start - depth, W, depth)
        if side == 'S': return (0, start, W, depth)
        if side == 'E': return (W - start - depth, 0, depth, H)
        return (start, 0, depth, H)

    for op in ops:
        name, *args = op.split(':')
        if name == 'cut':
            which = args[0] if args and not args[0].isdigit() else 'NE+NW+SE+SW'
            n = int(args[-1]) if args and args[-1].isdigit() else (2 if min(W, H) >= 8 else 1)
            for c in which.split('+'):
                rect = (W - n if 'E' in c else 0, H - n if 'N' in c else 0, n, n)
                block(rect, st['wall'])
        elif name == 'pillars':
            tex = args[0] if args else st['pillar']
            xs = [x for x in range(2, W - 2, 3)] if W >= 7 else [W // 2]
            ys = [y for y in range(2, H - 2, 3)] if H >= 7 else [H // 2]
            for x in xs:
                for y in ys: block((x, y, 1, 1), tex)
        elif name == 'aisles':
            tex = args[0] if args else st['pillar']
            long_x = W >= H
            short, long_ = (H, W) if long_x else (W, H)
            lines = list(range(2, short - 2, 2 if short % 2 else 3)) or [short // 2]
            mid = long_ // 2
            for q in lines:
                for a, b in ((1, mid - 1), (mid + 1, long_ - 2)) if long_ >= 8 else ((1, long_ - 2),):
                    run = []          # one block per unbroken length of rack
                    for p in list(range(a, b + 1)) + [None]:
                        cell = None if p is None else (p, q) if long_x else (q, p)
                        if cell is not None and clear((*cell, 1, 1)): run.append(p)
                        elif run:
                            block((run[0], q, len(run), 1) if long_x else (q, run[0], 1, len(run)), tex); run = []
        elif name == 'island':
            m = int(args[0]) if args else 2
            tex = args[1] if len(args) > 1 else st['pillar']
            if not block((m, m, W - 2 * m, H - 2 * m), tex):
                for rect in ((m, m, (W - 2 * m) // 2, H - 2 * m), (m + (W - 2 * m + 1) // 2, m, (W - 2 * m) // 2, H - 2 * m)):
                    block(rect, tex)
        elif name == 'bays':
            tex = args[0] if args else st['wall']
            if W >= H:
                d = 2 if H >= 7 else 1
                for x in range(2, W - 1, 3):
                    block((x, 0, 1, d), tex); block((x, H - d, 1, d), tex)
            else:
                d = 2 if W >= 7 else 1
                for y in range(2, H - 1, 3):
                    block((0, y, d, 1), tex); block((W - d, y, d, 1), tex)
        elif name == 'pit':
            kind = args[0] if args else 'plain'
            m = 2 if min(W, H) >= 7 else 1
            props = {'haz': dict(floor='NUKAGE1', special=5, light=192), 'lava': dict(floor='LAVA1', special=5, light=208),
                     'water': dict(floor='FWATER1', light=max(96, st['light'] - 16)),
                     'plain': dict(floor=st['alt'], light=max(96, st['light'] - 24))}[kind]
            rects = [(m, m, W - 2 * m, H - 2 * m)]
            if kind in ('haz', 'lava'):       # a dry crossing through the middle
                if W >= H:
                    half = (W - 2 * m) // 2
                    rects = [(m, m, half, H - 2 * m), (W - m - half, m, half, H - 2 * m)] if (W - 2 * m) % 2 else [(m, m, half - 1, H - 2 * m), (m + half + 1, m, half - 1, H - 2 * m)]
                else:
                    half = (H - 2 * m) // 2
                    rects = [(m, m, W - 2 * m, half), (m, H - m - half, W - 2 * m, half)] if (H - 2 * m) % 2 else [(m, m, W - 2 * m, half - 1), (m, m + half + 1, W - 2 * m, half - 1)]
            for rect in rects:
                if inside(rect) and not (cells_of(rect) & solid) and not (props.get('special') and cells_of(rect) & hard):
                    surfaces.append(dict(rect=list(rect), z=-16, wall=st['trim'], **props))
        elif name == 'dais':
            side = args[0]; depth = int(args[1]) if len(args) > 1 else 2
            rect = side_strip(side, 0, depth)
            if not cells_of(rect) & solid:
                surfaces.append(dict(rect=list(rect), z=16, floor=st['alt'], wall=st['trim'], light=min(240, st['light'] + 16)))
        elif name in ('mezz', 'steps'):
            side = args[0]
            tiers = (16, 32, 48) if name == 'mezz' else (16, 32)
            top_depth = int(args[1]) if len(args) > 1 else 2
            total = len(tiers) - 1 + top_depth
            if not cells_of(side_strip(side, 0, total)) & solid:
                for i, z in enumerate(tiers):
                    last = i == len(tiers) - 1
                    rect = side_strip(side, 0 if last else total - 1 - i, top_depth if last else 1)
                    surfaces.append(dict(rect=list(rect), z=z, floor=st['alt'] if last else 'STEP1', wall=st['trim'],
                                         light=min(240, st['light'] + (16 if last else 0))))
        elif name in ('crates', 'planters'):
            rnd = lcg(seed + name)
            n = int(args[0]) if args else max(1, W * H // 16)
            z = 48 if (sky or height >= 112) else 32
            fl, wl, zz = ('CRATOP1', 'CRATE1', z) if name == 'crates' else ('GRASS', 'BRICK01', 32)
            sizes = [(2, 1), (1, 2), (1, 1), (2, 2), (1, 1)]
            tries = 0
            while n > 0 and tries < 200:
                tries += 1
                w, h = sizes[rnd(len(sizes))]
                rect = (1 + rnd(max(1, W - w - 1)), 1 + rnd(max(1, H - h - 1)), w, h)
                if raised(rect, zz, fl, wl): n -= 1
        elif name == 'machines':
            tex = args[0] if args else st['pillar']
            w, h = (2, 2) if min(W, H) >= 8 else (2, 1) if W >= H else (1, 2)
            spots = [(2, 2), (W - 2 - w, H - 2 - h)]
            if max(W, H) >= 10: spots += [(W - 2 - w, 2), (2, H - 2 - h)]
            for x, y in spots: block((x, y, w, h), tex, pad=1)
        elif name == 'nave' and not sky:
            if W >= H: rect = (0, H // 2 - 1, W, 2 + H % 2)
            else: rect = (W // 2 - 1, 0, 2 + W % 2, H)
            surfaces.append(dict(rect=list(rect), height=height + 48, light=min(240, st['light'] + 24)))
        elif name == 'sky' and not sky:
            m = 2 if min(W, H) >= 7 else 1
            surfaces.append(dict(rect=[m, m, W - 2 * m, H - 2 * m], ceiling='F_SKY1', height=192, light=min(240, st['light'] + 40)))
        elif name == 'lowend' and not sky:
            surfaces.append(dict(rect=list(side_strip(args[0], 0, 2)), height=max(72, height - 32), light=max(96, st['light'] - 32)))
        elif name == 'trench':
            floor = args[1] if len(args) > 1 else st['alt']
            rect = (0, H // 2, W, 1) if args[0] == 'x' else (W // 2, 0, 1, H)
            if not cells_of(rect) & solid:
                surfaces.append(dict(rect=list(rect), z=-16, floor=floor, wall=st['trim'], light=max(96, st['light'] - 24)))
        elif name == 'hazstrip':
            rect = (0, H // 2 - 1, W, 1) if args[0] == 'x' else (W // 2 - 1, 0, 1, H)
            if not cells_of(rect) & (solid | hard):
                surfaces.append(dict(rect=list(rect), z=-16, floor='NUKAGE1', wall=st['trim'], light=192, special=5))
        elif name == 'canal':
            # A two-row cut right across the room, 48 down. One step on the entry side lets a
            # player climb back out; the tagged span in the middle is raised later as the bridge.
            axis, entry, tag = args[0], args[1], args[2]
            floor = args[3] if len(args) > 3 else st['alt']
            long_, short = (W, H) if axis == 'x' else (H, W)
            first = int(args[4]) if len(args) > 4 else short // 2 - 1
            near = first if entry in 'SW' else first + 1
            strip = lambda a, b, row, rows: (a, row, b - a, rows) if axis == 'x' else (row, a, rows, b - a)
            whole = strip(0, long_, first, 2)
            if not cells_of(whole) & (solid | hard):
                mid = long_ // 2 - 1
                surfaces.append(dict(rect=list(whole), z=-48, floor=floor, wall=st['trim'], light=max(96, st['light'] - 32)))
                surfaces.append(dict(rect=list(strip(0, 1, near, 1)), z=-24, floor='STEP1', wall=st['trim']))
                surfaces.append(dict(rect=list(strip(mid, mid + 2, first, 2)), z=-48, floor='STEP1', wall='COMPSPAN', tag=tag))
                solid.update(cells_of(whole))
        elif name == 'moat':
            # A one-row cut, 24 down, with the far bank 24 up: the near bank can be climbed again, the
            # far bank only from the tagged span once it has risen level with the near side.
            axis, entry, tag = args[0], args[1], args[2]
            floor = args[3] if len(args) > 3 else st['alt']
            long_, short = (W, H) if axis == 'x' else (H, W)
            row = int(args[4]) if len(args) > 4 else short // 2
            strip = lambda a, b, r0, rows: (a, r0, b - a, rows) if axis == 'x' else (r0, a, rows, b - a)
            cut = strip(0, long_, row, 1)
            far = strip(0, long_, row + 1, short - row - 1) if entry in 'SW' else strip(0, long_, 0, row)
            if not cells_of(cut) & (solid | hard) and not cells_of(far) & solid:
                mid = long_ // 2 - 1
                surfaces.append(dict(rect=list(far), z=24, floor=st['alt'], wall=st['trim']))
                surfaces.append(dict(rect=list(cut), z=-24, floor=floor, wall=st['trim'], light=max(96, st['light'] - 32)))
                surfaces.append(dict(rect=list(strip(mid, mid + 2, row, 1)), z=-24, floor='STEP1', wall='COMPSPAN', tag=tag))
                solid.update(cells_of(cut))
        elif name == 'basin':
            # Standing water against one wall, later drained by its tag. The dry ledge is the way down.
            side, tag = args[0], args[1]
            depth = int(args[2]) if len(args) > 2 else (W if side in 'EW' else H) // 2
            rect = side_strip(side, 0, depth)
            if not cells_of(rect) & solid:
                surfaces.append(dict(rect=list(rect), z=-24, floor='FWATER1', wall=st['trim'], light=max(96, st['light'] - 16), tag=tag))
                ledge = {'E': (W - depth, 0, 1, 1), 'W': (depth - 1, 0, 1, 1), 'N': (0, H - depth, 1, 1), 'S': (0, depth - 1, 1, 1)}[side]
                surfaces.append(dict(rect=list(ledge), z=-24, floor='STEP1', wall=st['trim'], tag=''))
                solid.update(cells_of(rect))
        elif name == 'press':
            # A pounding ceiling over one lane; its tag is started by whoever walks in.
            axis, tag = args[0], args[1]
            for off in (0, 1, -1, 2, -2):       # the nearest lane to the middle that no doorway looks down
                rect = (3, H // 2 + off, W - 6, 1) if axis == 'x' else (W // 2 + off, 3, 1, H - 6)
                if inside(rect) and not cells_of(rect) & (solid | hard | lane):
                    # A lit, yellow-lined lane under the head, so it reads in a dark hall.
                    surfaces.append(dict(rect=list(rect), floor='STEP1' if st['floor'] == 'FLOOR4_8' else 'FLOOR4_8', wall='COMPSPAN',
                                         ceiling='CEIL3_4', height=96, light=224, tag=tag))
                    solid.update(cells_of(rect))
                    break
        elif name in ('plain', ''):
            pass
        else:
            raise ValueError('unknown shape op ' + op)
    return blocks, surfaces


def local_heights(room, blocks, surfaces):
    W, H = room['rect'][2], room['rect'][3]
    z = {(x, y): 0 for x in range(W) for y in range(H)}
    haz, moving = set(), set()
    for bx, by, bw, bh, _ in blocks:
        for x in range(bx, bx + bw):
            for y in range(by, by + bh): z.pop((x, y), None)
    for s in surfaces:
        x0, y0, w, h = s['rect']
        for x in range(x0, x0 + w):
            for y in range(y0, y0 + h):
                if (x, y) in z:
                    if 'z' in s: z[x, y] = s['z']
                    if s.get('special'): haz.add((x, y))
                    if 'tag' in s: moving.add((x, y)) if s['tag'] else moving.discard((x, y))
    return z, haz, moving


def connected(room, blocks, surfaces, hard):
    z, _, moving = local_heights(room, blocks, surfaces)      # a machine's floor will meet its neighbors
    need = [c for c in hard if c in z]
    if len(need) != len(hard): return False
    if not need: return True
    seen = {need[0]}; todo = [need[0]]
    while todo:
        x, y = todo.pop()
        for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if n in z and n not in seen and (abs(z[n] - z[x, y]) <= 24 or n in moving or (x, y) in moving): seen.add(n); todo.append(n)
    return all(c in seen for c in need)


# ------------------------------------------------------------------- routing
def occupancy(spec):
    cells, solid, rooms, gates = floorplan(spec)
    occ = set(cells) | set(solid)
    for r in spec['rooms']:
        x, y, w, h = r['rect']
        occ.update((xx, yy) for xx in range(x, x + w) for yy in range(y, y + h))
    return occ


def edge_cells(room, side=None):
    x, y, w, h = room['rect']
    out = []
    for name, (dx, dy) in DIRS.items():
        if side and name not in side: continue
        if dx: cells = [(x + (w - 1 if dx > 0 else 0), yy) for yy in range(y + 1, y + h - 1)]
        else: cells = [(xx, y + (h - 1 if dy > 0 else 0)) for xx in range(x + 1, x + w - 1)]
        out += [(c, (dx, dy)) for c in cells]
    return out


def route(spec, a, b, side_a=None, side_b=None, avoid=()):
    """Shortest, straightest free corridor between two rooms, clear of everything else."""
    occ = occupancy(spec)
    rooms = {r['id']: r for r in spec['rooms']}
    used = {m[2] for m in mouths(spec)} | set(avoid)
    targets = {c: d for c, d in edge_cells(rooms[b], side_b) if c not in used}
    xs = [c[0] for c in occ]; ys = [c[1] for c in occ]
    lo = (min(xs) - 4, min(ys) - 4); hi = (max(xs) + 4, max(ys) + 4)
    heap, best, count = [], {}, 0
    for cell, d in edge_cells(rooms[a], side_a):
        if cell in used: continue
        q = (cell[0] + d[0], cell[1] + d[1])
        if q in occ: continue
        if any(n in occ and n != cell for n in ((q[0] + 1, q[1]), (q[0] - 1, q[1]), (q[0], q[1] + 1), (q[0], q[1] - 1))): continue
        heapq.heappush(heap, ((0, 1), count, q, d, (cell, q))); count += 1
    while heap:
        cost, _, pos, d, path = heapq.heappop(heap)
        if best.get((pos, d), (99, 999)) <= cost: continue
        best[pos, d] = cost
        for nd in DIRS.values():
            if (nd[0], nd[1]) == (-d[0], -d[1]): continue
            q = (pos[0] + nd[0], pos[1] + nd[1])
            ncost = (cost[0] + (nd != d), cost[1] + 1)
            if q in targets and targets[q] == (-nd[0], -nd[1]) and len(path) >= 3:
                return [list(p) for p in corners(path + (q,))]
            if q in occ or q in path or not (lo[0] <= q[0] <= hi[0] and lo[1] <= q[1] <= hi[1]): continue
            near = [n for n in ((q[0] + 1, q[1]), (q[0] - 1, q[1]), (q[0], q[1] + 1), (q[0], q[1] - 1)) if n != pos]
            blocked = [n for n in near if n in occ or n in path]
            if blocked and not (len(blocked) == 1 and blocked[0] in targets and targets[blocked[0]] == (sign(q[0] - blocked[0][0]), sign(q[1] - blocked[0][1]))):
                continue
            if cost[1] > 40: continue
            heapq.heappush(heap, (ncost, count, q, nd, path + (q,))); count += 1
    return None


def corners(path):
    out = [path[0]]
    for i in range(1, len(path) - 1):
        a, b, c = path[i - 1], path[i], path[i + 1]
        if (b[0] - a[0], b[1] - a[1]) != (c[0] - b[0], c[1] - b[1]): out.append(b)
    out.append(path[-1])
    return out


def path_cells(points):
    out = []
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        n = abs(x1 - x0) + abs(y1 - y0)
        for s in range(n + 1):
            p = (x0 + (x1 - x0) * s // max(1, n), y0 + (y1 - y0) * s // max(1, n))
            if not out or out[-1] != p: out.append(p)
    return out


def door_cell(points):
    """Middle passage cell with straight jambs, or None."""
    cells = path_cells(points)
    inner = list(range(1, len(cells) - 1))
    straight = [i for i in inner if (cells[i][0] - cells[i - 1][0], cells[i][1] - cells[i - 1][1]) == (cells[i + 1][0] - cells[i][0], cells[i + 1][1] - cells[i][1])]
    if not straight: return None
    mid = (len(cells) - 1) / 2
    return list(cells[min(straight, key=lambda i: (abs(i - mid), i))])


def place_vault(spec, host, sides, size, gap=3, pack=False):
    """Find free ground beside a host room for a w x h vault; returns (rect, link path)."""
    occ = occupancy(spec)
    rooms = {r['id']: r for r in spec['rooms']}
    used = {m[2] for m in mouths(spec)}
    hx, hy, hw, hh = rooms[host]['rect']
    w, h = size
    for side in sides:
        dx, dy = DIRS[side]
        if dx: span = range(hy + 1, hy + hh - 1)
        else: span = range(hx + 1, hx + hw - 1)
        order = sorted(span) if pack else sorted(span, key=lambda v: abs(v - (hy + hh / 2 if dx else hx + hw / 2)))
        for c in order:
            for inset in sorted(range(1, (h if dx else w) - 1), key=lambda v: abs(v - (h if dx else w) / 2)) or [0]:
                if dx:
                    vx = hx + hw + gap if dx > 0 else hx - gap - w
                    rect = (vx, c - inset, w, h)
                    a = (hx + hw - 1 if dx > 0 else hx, c); bcell = (vx if dx > 0 else vx + w - 1, c)
                else:
                    vy = hy + hh + gap if dy > 0 else hy - gap - h
                    rect = (c - inset, vy, w, h)
                    a = (c, hy + hh - 1 if dy > 0 else hy); bcell = (c, vy if dy > 0 else vy + h - 1)
                if a in used: continue
                grown = {(x, y) for x in range(rect[0] - 1, rect[0] + rect[2] + 1) for y in range(rect[1] - 1, rect[1] + rect[3] + 1)}
                passage = path_cells([a, bcell])[1:-1]
                side_cells = {(p[0] + (0 if dx else s), p[1] + (s if dx else 0)) for p in passage for s in (-1, 1)}
                if grown & occ or set(passage) & occ or side_cells & occ: continue
                return list(rect), [list(a), list(bcell)]
    return None, None


# ------------------------------------------------------------- progression
def progression(spec):
    """Rooms in first-visit order with the cell the player enters by."""
    cells, solid, rooms, gates = floorplan(spec)
    reached, came = Routes(spec, cells, gates).explore()
    order, entry, dist = [], {}, {}
    for state, back in came.items():            # states are stored in the order they were found
        pos = state[0]
        if pos in dist: continue
        dist[pos] = dist[back[0][0]] + 1 if back else 0
        rid = cells[pos]['room']
        if rid != 'passage' and rid not in entry:
            entry[rid] = (pos, back[0][0] if back else None); order.append(rid)
    return order, entry, dist, cells, gates


def los(cells, gates, a, b, base):
    """Clear floor-level sight line between two cell centers."""
    ax, ay = a[0] + .5, a[1] + .5; bx, by = b[0] + .5, b[1] + .5
    n = int(max(abs(bx - ax), abs(by - ay)) * 4) + 1
    for i in range(1, n):
        c = (math.floor(ax + (bx - ax) * i / n), math.floor(ay + (by - ay) * i / n))
        if c == a or c == b: continue
        cell = cells.get(c)
        if not cell or c in gates or cell['z'] - base >= 40: return False
    return True
