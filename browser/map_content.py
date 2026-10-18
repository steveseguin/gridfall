"""Resolve one map design into an explicit levels.json entry.

Takes a base floor plan (maps/plans.json) and its room designs, then adds
doors, loop corridors, room shapes, enemies, pickups and scenery.
"""
import collections
import copy
import math

from campaign_maps import Routes, floorplan
from map_layout import (DIRS, FLYERS, HP, INDUSTRIAL, ITEM, MON, STYLES, build_shape, connected,
                        door_cell, los, mouths, occupancy, path_cells, place_vault, progression, room_at, route)

SKILL = [7, 6, 7, 4, 7, 6, 7, 7, 4, 7]          # easy 60%, medium 80%, hard 100%
AMBUSH = set('KHUPG')
DMG = {'b': 10, 's': 70, 'r': 170, 'c': 22}
PICK = {'s': ((2049, 20), (2008, 4)), 'b': ((2048, 50), (2007, 10)), 'r': ((2046, 5),), 'c': ((17, 100), (2047, 20))}
WEAPON_AMMO = {2001: ('s', 8), 2002: ('b', 20), 2003: ('r', 2), 2004: ('c', 40), 2006: ('c', 40),
               2049: ('s', 20), 2008: ('s', 4), 2048: ('b', 50), 2007: ('b', 10), 2046: ('r', 5), 2047: ('c', 20), 17: ('c', 100)}
DECOR = {'yard': [2028, 2028], 'street': [2028, 18, 2028], 'field': [33, 2028], 'compute': [48, 48], 'core': [48, 33],
         'power': [33], 'plant': [33], 'machine': [33, 21], 'office': [62], 'medical': [62], 'tile': [62, 2028],
         'ruin': [18, 20], 'warn': [62], 'service': [], 'concrete': [19], 'water': [], 'vault': []}
SOLID_PROPS = {2028, 33, 48, 27, 31, 47, 2035}


def build(src, design, log):
    spec = copy.deepcopy(src)
    design = dict(design, rooms=dict(design['rooms']))
    for k in ('supplies', 'encounters', 'enemies', 'props', 'walls', 'deathmatch'): spec.pop(k, None)
    spec['monsters'] = {}; spec['supply_count'] = 0; spec['architectural_edges'] = True
    if design.get('objective'): spec['objective'] = design['objective']
    start_room = room_at(spec, spec['start']['cell'])['id']
    spec['items'] = [i for i in spec['items'] if (room_at(spec, i['cell']) or {}).get('id') == start_room]
    for r in spec['rooms']:
        for k in ('blocks', 'floors', 'surfaces', 'wall', 'floor', 'ceiling', 'light', 'height'): r.pop(k, None)
    rooms = {r['id']: r for r in spec['rooms']}
    for r in spec['rooms']:
        for op in design['rooms'][r['id']][1].split():
            if op.startswith('z='): r['z'] = int(op[2:])
    for color in design.get('drop', []):        # a machine takes over from this card
        spec['keys'] = [k for k in spec['keys'] if k['color'] != color]
        for link in spec['links']:
            if link.get('key') == color:
                link.pop('key'); link.pop('at', None)

    # ---- relocate or add the secret vault
    if design.get('vault'):
        host, sides, size = design['vault']
        old = [r for r in spec['rooms'] if r.get('secret')]
        for r in old:
            spec['links'] = [l for l in spec['links'] if room_at(spec, l['path'][0]) is not r and room_at(spec, l['path'][-1]) is not r]
            spec['rooms'].remove(r)
        rect, path = place_vault(spec, host, sides, size)
        if not rect: raise ValueError((spec['id'], 'no room for vault beside', host))
        vault = old[0] if old else dict(id='cache', name=design.get('vault_name', 'Sealed store'), theme='service', secret=True)
        vault['rect'] = rect; vault['z'] = rooms[host].get('z', 0)
        if design.get('vault_name'): vault['name'] = design['vault_name']
        spec['rooms'].append(vault)
        spec['links'].append(dict(path=path, at=door_cell(path), secret=True))
        rooms = {r['id']: r for r in spec['rooms']}
    secret_ids = {r['id'] for r in spec['rooms'] if r.get('secret')}
    spec['triggers'] = []

    def between(a, b):
        found = [l for l in spec['links'] if {room_at(spec, l['path'][0])['id'], room_at(spec, l['path'][-1])['id']} == {a, b}]
        if not found: raise ValueError((spec['id'], 'no link between', a, b))
        return found[0]

    for a, b in design.get('unlink', []): spec['links'].remove(between(a, b))

    # ---- changes to the plan's own links: barriers, heavy shutters, level tunnels
    for change in design.get('links', []):
        link = between(change['a'], change['b'])
        for key, value in change.items():
            if key in ('a', 'b'): continue
            if key == 'block':          # the old door gives way to a barrier a control sinks
                link['block'] = link.pop('at', None) or door_cell(link['path'])
                for old in ('key', 'gate', 'door', 'secret'): link.pop(old, None)
                link['tag'] = value
            elif key == 'lift':         # a platform beside the lower room replaces the ramp
                run = path_cells(link['path'])
                low_first = rooms[room_at(spec, run[0])['id']].get('z', 0) < rooms[room_at(spec, run[-1])['id']].get('z', 0)
                link['lift'] = list(run[1] if low_first else run[-2])
            elif value is None: link.pop(key, None)
            else: link[key] = value

    # ---- sealed machine bays and ambush closets; each opens with its named gate
    closets = set()
    def add_bay(bay, gate, index):
        host = bay['host']
        rect, path = place_vault(spec, host, bay.get('sides', 'NSEW'), bay.get('size', (3, 2)), gap=1, pack=True)
        if not rect:
            log.append('%d: no room for a bay beside %s' % (spec['id'], host)); return
        rid = bay.get('id', 'bay%d' % index)
        spec['rooms'].append(dict(id=rid, name=bay.get('name', 'Machine bay'), rect=rect, theme='machine', z=rooms[host].get('z', 0)))
        spec['links'].append(dict(path=path, at=door_cell(path), gate=gate, texture='DOOR1'))
        design['rooms'][rid] = (bay.get('style', 'machine'), 'l=152', bay['enc'], bay.get('loot', ''))
        rooms[rid] = spec['rooms'][-1]; closets.add(rid)
    for index, bay in enumerate(design.get('bays', [])): add_bay(bay, bay['gate'], index + 1)
    ambushes = []
    for index, bay in enumerate(design.get('ambush', [])):
        name = 'ambush%d' % (index + 1)
        add_bay(dict(bay, id=name, name='Robot closet'), name, 0)
        if name in rooms: ambushes.append((name, bay['on']))

    # ---- loop corridors, lifts and windows
    for loop in design.get('loops', []):
        path = route(spec, loop['a'], loop['b'], loop.get('side_a'), loop.get('side_b'))
        if not path:
            log.append('%d: no route %s-%s' % (spec['id'], loop['a'], loop['b'])); continue
        link = dict(path=path)
        at = door_cell(path)
        if loop.get('lift'):
            run = path_cells(path)
            link['lift'] = list(run[1] if rooms[loop['a']].get('z', 0) < rooms[loop['b']].get('z', 0) else run[-2])
        elif loop.get('window'): link['window'] = True
        elif loop.get('gate'): link.update(at=at, gate=loop['gate'], **({'heavy': True} if loop.get('heavy') else {}))
        elif loop.get('key'): link.update(at=at, key=loop['key'])
        elif at and not loop.get('open'): link.update(at=at, door=True)
        spec['links'].append(link)

    # ---- controls: a wall switch in a named room that works a machine
    ends = mouths(spec)
    occ = occupancy(spec)
    taken = {tuple(s['cell']) for s in spec['switches']} | {tuple(spec['exit']['cell'])} | {tuple(k['cell']) for k in spec['keys']}
    for name, change in design.get('rewire', {}).items():
        old = next(s for s in spec['switches'] if s['opens'] == name)
        spec['switches'].remove(old)
        spec['triggers'].append(dict(kind='switch', cell=old['cell'], face=old['face'], required=True, name=old.get('name', name), **change))
    def wall_spot(room):        # a free stretch of wall, as far from the room's doorways as it gets
        x0, y0, W, H = rooms[room]['rect']
        doors = [cell for _, rid, cell, d in ends if rid == room]
        spots = []
        for face, (dx, dy) in DIRS.items():
            edge = [(x0 + (W - 1 if dx > 0 else 0), y) for y in range(y0 + 1, y0 + H - 1)] if dx else \
                   [(x, y0 + (H - 1 if dy > 0 else 0)) for x in range(x0 + 1, x0 + W - 1)]
            for cell in edge:
                if (cell[0] + dx, cell[1] + dy) in occ or cell in taken: continue
                if any(abs(cell[0] - d[0]) + abs(cell[1] - d[1]) < 2 for d in doors): continue
                spots.append((min(abs(cell[0] - d[0]) + abs(cell[1] - d[1]) for d in doors), cell, face))
        if not spots: raise ValueError((spec['id'], 'no wall for a control in', room))
        _, cell, face = max(spots, key=lambda s: (s[0], -s[1][0], -s[1][1]))
        taken.add(cell)
        return cell, face
    for name, room in design.get('moves', {}).items():      # one of the plan's switches, moved to another room
        switch = next(s for s in spec['switches'] if s['opens'] == name)
        taken.discard(tuple(switch['cell']))
        cell, face = wall_spot(room)
        switch.update(cell=list(cell), face=face)
    for control in design.get('controls', []):
        cell, face = wall_spot(control['room'])
        spec['triggers'].append(dict(kind='switch', cell=list(cell), face=face, action=control['action'], target=control['target'],
                                     required=control.get('required', True), name=control.get('name', control['target'])))

    # ---- doors and corridor materials
    keep_open = {frozenset(p) for p in design.get('open', [])}
    for link in spec['links']:
        a, b = room_at(spec, link['path'][0]), room_at(spec, link['path'][-1])
        pair = frozenset((a['id'], b['id']))
        if 'at' not in link and pair not in keep_open and not any(k in link for k in ('block', 'lift', 'window')):
            at = door_cell(link['path'])
            if at: link.update(at=at, door=True)
        if link.get('secret'): link['effect'] = 1          # a flickering alcove marks every secret door
        styles = [design['rooms'][r['id']][0] for r in (a, b)]
        civic = any(s in ('tile', 'ruin', 'street', 'yard', 'concrete', 'medical', 'water') for s in styles)
        link.update(wall='GRAY5' if civic else 'METAL', floor='FLOOR0_3', ceiling='CEIL3_2', height=link.get('height', 96), light=168)

    # ---- room materials and shapes
    ends = mouths(spec)
    fixed = [tuple(spec['start']['cell']), tuple(spec['exit']['cell'])] + [tuple(k['cell']) for k in spec['keys']] + \
            [tuple(s['cell']) for s in spec['switches']] + [tuple(i['cell']) for i in spec['items']] + \
            [tuple(t['cell']) for t in spec['triggers']]
    if 'secret_exit' in spec: fixed.append(tuple(spec['secret_exit']['cell']))
    presses = set()
    for r in spec['rooms']:
        style, ops, enc, extras = design['rooms'][r['id']]
        st = STYLES[style]
        x0, y0, W, H = r['rect']
        r.update(wall=st['wall'], floor=st['floor'], ceiling=st['ceiling'], light=st['light'])
        if 'height' in st: r['height'] = st['height']
        ops = ops.split()
        for op in [o for o in ops if '=' in o]:
            k, v = op.split('='); r[{'h': 'height', 'l': 'light', 'fx': 'effect', 'z': 'z'}[k]] = int(v)
        presses.update(o.split(':')[2] for o in ops if o.startswith('press:'))
        ops = [o for o in ops if '=' not in o]
        hard, lane = set(), set()
        for _, rid, cell, d in ends:
            if rid == r['id']:
                hard.add((cell[0] - x0, cell[1] - y0)); hard.add((cell[0] - d[0] - x0, cell[1] - d[1] - y0))
                # Keep a clear run in from every doorway; pits may cross it, cover may not.
                lane.update((cell[0] - d[0] * k - x0, cell[1] - d[1] * k - y0) for k in (2, 3))
        hard |= {(c[0] - x0, c[1] - y0) for c in fixed if x0 <= c[0] < x0 + W and y0 <= c[1] < y0 + H}
        hard = {c for c in hard if 0 <= c[0] < W and 0 <= c[1] < H}
        while True:
            blocks, surfaces = build_shape(r, style, ops, hard, '%d/%s' % (spec['id'], r['id']), lane)
            if connected(r, blocks, surfaces, hard) or not ops: break
            log.append('%d: %s drops shape op %s' % (spec['id'], r['id'], ops[-1])); ops = ops[:-1]
        if blocks: r['blocks'] = blocks
        if surfaces: r['surfaces'] = surfaces

    # ---- a pool of light inside every ordinary doorway, so the ways out read from across the room
    for index, rid, cell, d in ends:
        link = spec['links'][index]
        a, b = room_at(spec, link['path'][0])['id'], room_at(spec, link['path'][-1])['id']
        if link.get('secret') or link.get('window') or {a, b} & (closets | secret_ids): continue
        r = rooms[rid]; x0, y0 = r['rect'][:2]; local = (cell[0] - x0, cell[1] - y0)
        inside = lambda s: s['rect'][0] <= local[0] < s['rect'][0] + s['rect'][2] and s['rect'][1] <= local[1] < s['rect'][1] + s['rect'][3]
        if any(inside(s) for s in r.get('surfaces', [])): continue
        r.setdefault('surfaces', []).append(dict(rect=[local[0], local[1], 1, 1], light=min(240, r['light'] + 48)))

    # ---- presses start when someone walks in; closets open when their bait is touched
    cells, solid, _, gates = floorplan(spec)
    faces = {d: f for f, d in DIRS.items()}
    for r in spec['rooms']:
        for surface in r.get('surfaces', []):
            if surface.get('tag') in presses:
                for _, rid, cell, d in ends:
                    inward = (cell[0] - d[0], cell[1] - d[1])
                    if rid == r['id'] and inward in cells and cells[inward].get('name') != surface['tag']:
                        spec['triggers'].append(dict(kind='walk', cell=list(cell), face=faces[(-d[0], -d[1])], action='crush', target=surface['tag']))
    for name, on in ambushes:
        kind, _, what = on.partition(':')
        if kind == 'key': bait = next(tuple(k['cell']) for k in spec['keys'] if k['color'] == what)
        else: bait = next(tuple(t['cell']) for t in spec['switches'] + spec['triggers'] if what in (t.get('opens'), t.get('target')) and t.get('kind', 'switch') == 'switch')
        for face, (dx, dy) in DIRS.items():
            near = (bait[0] + dx, bait[1] + dy)
            if near in cells and near not in gates and abs(cells[near]['z'] - cells[bait]['z']) <= 24:
                spec['triggers'].append(dict(kind='walk', cell=list(near), face=faces[(-dx, -dy)], action='open', target=name))

    # ---- thin shutters wherever the jambs are straight
    for link in spec['links']:
        if 'at' in link:
            x, y = link['at']
            near = [p in cells for p in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))]
            if near in ([True, True, False, False], [False, False, True, True]): link['thin'] = True
            else: link.pop('thin', None)

    order, entry, dist, cells, gates = progression(spec)
    missing = [r['id'] for r in spec['rooms'] if r['id'] not in entry]
    if missing: raise ValueError((spec['id'], 'rooms never reached', missing))
    occupied = set(fixed)
    protected = set()
    for _, rid, cell, d in ends:
        protected.add(cell); protected.add((cell[0] - d[0], cell[1] - d[1]))
    keycells = {tuple(k['cell']) for k in spec['keys']} | {tuple(s['cell']) for s in spec['switches']} | {tuple(spec['exit']['cell'])}
    keycells |= {tuple(t['cell']) for t in spec['triggers'] if t['kind'] == 'switch'}
    # Once every machine has run: floors at rest, so the far side of a raised bridge counts as walkable.
    machines = Routes(spec, cells, gates)
    rest = lambda p: machines.moved[p][1] if p in machines.moved else cells[p]['z']
    protected |= keycells
    counters = collections.Counter()
    enemies, items, props, walls = [], list(spec['items']), [], []
    room_hp = collections.Counter(); ground = collections.defaultdict(list)

    def view(rid):
        r = rooms[rid]; base = r.get('z', 0)
        mine = [p for p, c in cells.items() if c['room'] == rid and p not in gates]
        m, o = entry[rid]
        inward = (m[0] - o[0], m[1] - o[1]) if o else (0, 1)
        walk = {m: 0}; todo = collections.deque([m])
        while todo:
            p = todo.popleft()
            for n in ((p[0] + 1, p[1]), (p[0] - 1, p[1]), (p[0], p[1] + 1), (p[0], p[1] - 1)):
                if n in cells and cells[n]['room'] == rid and n not in walk and abs(rest(n) - rest(p)) <= 24:
                    walk[n] = walk[p] + 1; todo.append(n)
        return r, base, mine, m, o or m, inward, walk

    def usable(p, flyer=False):
        c = cells[p]
        if not flyer and (c.get('name') or c['z'] < rooms[c['room']].get('z', 0) - 24): return False     # moving floors, deep cuts
        return p not in occupied and p not in protected and c['top'] - c['z'] >= 64 and (flyer or c['special'] != 5)

    def gap(p):     # a one-cell squeeze between walls: never park scenery there
        shut = [n not in cells for n in ((p[0] + 1, p[1]), (p[0] - 1, p[1]), (p[0], p[1] + 1), (p[0], p[1] - 1))]
        return (shut[0] and shut[1]) or (shut[2] and shut[3])

    def choose(ranked, n, spread=True):
        picked = []
        for strict in (True, False):
            for p in ranked:
                if len(picked) >= n: break
                if p in picked or p in occupied: continue
                if strict and spread and any(max(abs(p[0] - q[0]), abs(p[1] - q[1])) <= 1 for q in picked): continue
                picked.append(p)
        for p in picked: occupied.add(p)
        return picked

    for rid in order:
        style, ops, enc, extras = design['rooms'][rid]
        r, base, mine, m, o, inward, walk = view(rid)
        cx = sum(p[0] for p in walk) / len(walk); cy = sum(p[1] for p in walk) / len(walk)
        lateral = lambda p: abs((p[0] - m[0]) * inward[1] - (p[1] - m[1]) * inward[0])
        depth = lambda p: (p[0] - m[0]) * inward[0] + (p[1] - m[1]) * inward[1]
        seen = {p: los(cells, gates, o, p, base) for p in mine}
        objective = [k for k in keycells if cells[k]['room'] == rid]
        for token in enc.split():
            only = {'+': 6, '!': 4}.get(token[-1])        # medium and hard only, or hard only
            if only: token = token[:-1]
            tactic, count, kind = token[0], int(token[1:-1]), MON[token[-1]]
            flyer = kind in FLYERS
            floor = [p for p in walk if usable(p)]
            if tactic == 'F': ranked = sorted([p for p in floor if 2 <= walk[p] <= 6 and seen[p]], key=lambda p: (lateral(p) > 1, walk[p], lateral(p))) + sorted(floor, key=lambda p: walk[p])
            elif tactic == 'R': ranked = sorted(floor, key=lambda p: (-walk[p], lateral(p)))
            elif tactic == 'M': ranked = sorted(floor, key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)
            elif tactic == 'K': ranked = sorted([p for p in floor if not seen[p]], key=lambda p: walk[p]) + sorted([p for p in floor if depth(p) <= 1 and lateral(p) >= 2], key=lateral) + sorted(floor, key=lambda p: -lateral(p))
            elif tactic == 'H': ranked = sorted([p for p in floor if not seen[p]], key=lambda p: -walk[p]) + sorted(floor, key=lambda p: (-lateral(p), -walk[p]))
            elif tactic == 'U': ranked = sorted([p for p in floor if cells[p]['z'] - base >= 16], key=lambda p: (-(cells[p]['z']), not seen[p], lateral(p))) + sorted(floor, key=lambda p: -walk[p])
            elif tactic == 'P':
                perch = [p for p in mine if p not in walk and usable(p) and 24 < cells[p]['z'] - base <= 64]
                ranked = sorted(perch, key=lambda p: (not seen[p], abs(p[0] - m[0]) + abs(p[1] - m[1]))) + sorted(floor, key=lambda p: (-walk[p], lateral(p)))
            elif tactic == 'G':
                if objective: ranked = sorted(floor, key=lambda p: (min(max(abs(p[0] - k[0]), abs(p[1] - k[1])) for k in objective), lateral(p)))
                else: ranked = sorted(floor, key=lambda p: (-walk[p], lateral(p)))
            elif tactic == 'W':
                edge = [p for p in floor if sum(n in cells for n in ((p[0] + 1, p[1]), (p[0] - 1, p[1]), (p[0], p[1] + 1), (p[0], p[1] - 1))) < 4 and walk[p] >= 3]
                ranked = sorted(edge, key=lambda p: (not seen[p], -walk[p])) + sorted(floor, key=lambda p: -walk[p])
            elif tactic == 'A':
                air = [p for p in mine if usable(p, True) and abs(p[0] - m[0]) + abs(p[1] - m[1]) >= 3]
                ranked = sorted(air, key=lambda p: (p in walk and cells[p]['special'] != 5 and cells[p]['z'] >= base, -(abs(p[0] - m[0]) + abs(p[1] - m[1]))))
                ranked += [p for p in mine if usable(p, True) and p not in air]
            else: raise ValueError('unknown tactic ' + token)
            picked = choose(ranked, count)
            if len(picked) < count: log.append('%d: %s only fits %d of %s' % (spec['id'], rid, len(picked), token))
            for p in picked:
                angle = round(math.degrees(math.atan2(m[1] - p[1], m[0] - p[0])) / 45) * 45 % 360
                flags = (only or SKILL[counters[kind] % len(SKILL)]) | (8 if tactic in AMBUSH else 0)
                if not only: counters[kind] += 1
                enemies.append(dict(cell=list(p), type=kind, flags=flags, angle=angle))
                room_hp[rid] += HP[kind]
                if not flyer and p in walk: ground[rid].append(p)

    # ---- named rewards
    def reward_spot(rid, n):
        r, base, mine, m, o, inward, walk = view(rid)
        floor = [p for p in walk if usable(p)]
        wallish = lambda p: sum(nb in cells for nb in ((p[0] + 1, p[1]), (p[0] - 1, p[1]), (p[0], p[1] + 1), (p[0], p[1] - 1))) < 4
        return choose(sorted(floor, key=lambda p: (-walk[p], not wallish(p))), n, spread=False)
    for rid in order:
        codes = design['rooms'][rid][3].split()
        for code, p in zip(codes, reward_spot(rid, len(codes))):
            items.append(dict(type=ITEM[code], cell=list(p)))

    # ---- ammunition and health, scaled to the fight
    total = sum(room_hp.values())
    # A fresh start must be supplied by weapons and pickups on ordinary routes.
    # Secret weapons/ammunition remain bonuses, not part of the combat budget.
    regular = [it for it in items if cells[tuple(it['cell'])]['room'] not in secret_ids]
    available = {'b'}       # every player starts with a pistol
    for it in regular:
        if it['type'] in (2001, 2002, 2003, 2004, 2006):
            available.add(WEAPON_AMMO[it['type']][0])
    mix = {kind: weight for kind, weight in design['mix'].items() if kind in available and weight > 0}
    assert mix, (spec['id'], 'no usable ammunition in mix')
    scale = sum(design['mix'].values()) / sum(mix.values())
    have = collections.Counter()
    for it in regular:
        if it['type'] in WEAPON_AMMO: kind, n = WEAPON_AMMO[it['type']]; have[kind] += n
    have['b'] += 5 * sum(e['type'] == 3004 for e in enemies); have['s'] += 4 * sum(e['type'] == 9 for e in enemies)
    stock = []
    for kind, weight in mix.items():
        need = weight * scale * design.get('ratio', 2.0) * total - have[kind] * DMG[kind]
        big = PICK[kind][0]; small = PICK[kind][-1]
        while need > 0:
            if need >= big[1] * DMG[kind] * 0.75 or small is big: stock.append(big[0]); need -= big[1] * DMG[kind]
            else: stock.append(small[0]); need -= small[1] * DMG[kind]
    heal = total / design.get('heal', 22)
    medi = int(heal * 0.6 / 25 + 0.5); stim = int(max(0, heal - medi * 25) / 10 + 0.5)
    stock += [2012] * medi + [2011] * stim
    fights = [rid for rid in order if rid != start_room and rid not in secret_ids and rid not in closets]
    weight = {rid: 0.5 * room_hp[rid] + 0.5 * room_hp[fights[i + 1]] if i + 1 < len(fights) else room_hp[rid] for i, rid in enumerate(fights)}
    weight = {rid: w + 1 for rid, w in weight.items()}
    share = {rid: len(stock) * w / sum(weight.values()) for rid, w in weight.items()}
    quota = {rid: int(s) for rid, s in share.items()}
    for rid in sorted(share, key=lambda r: share[r] - quota[r], reverse=True)[:len(stock) - sum(quota.values())]: quota[rid] += 1
    stock.sort(key=lambda t: (t in (2011, 2012), t))
    slots = [rid for i in range(max(quota.values() or [0])) for rid in fights if quota[rid] > i]
    by_room = collections.defaultdict(list)
    ammo = [t for t in stock if t not in (2011, 2012)]; aid = [t for t in stock if t in (2011, 2012)]
    mixed = []
    while ammo or aid:               # interleave so every area gets both
        if ammo: mixed.append(ammo.pop(0))
        if aid and (len(mixed) % 3 == 2 or not ammo): mixed.append(aid.pop(0))
    for rid, t in zip(slots, mixed): by_room[rid].append(t)
    for rid, types in by_room.items():
        r, base, mine, m, o, inward, walk = view(rid)
        floor = [p for p in walk if usable(p) and walk[p] >= 1]
        placed = [tuple(i['cell']) for i in items if cells[tuple(i['cell'])]['room'] == rid]
        for t in types:
            free = [p for p in floor if p not in occupied]
            if not free: log.append('%d: %s has no floor left for supplies' % (spec['id'], rid)); break
            anchor = placed or [m]
            wallish = lambda p: sum(nb in cells for nb in ((p[0] + 1, p[1]), (p[0] - 1, p[1]), (p[0], p[1] + 1), (p[0], p[1] - 1))) < 4
            p = max(free, key=lambda p: (min(abs(p[0] - q[0]) + abs(p[1] - q[1]) for q in anchor) + 2 * wallish(p), -p[0], -p[1]))
            occupied.add(p); placed.append(p); items.append(dict(type=t, cell=list(p)))

    # ---- charging stations, scenery and wall accents
    def corner_offset(p):
        dx = 36 * ((p[0] + 1, p[1]) not in cells) - 36 * ((p[0] - 1, p[1]) not in cells)
        dy = 36 * ((p[0], p[1] + 1) not in cells) - 36 * ((p[0], p[1] - 1) not in cells)
        return [dx, dy]
    station_budget = design.get('stations', 6)
    for rid in order:
        style = design['rooms'][rid][0]
        r, base, mine, m, o, inward, walk = view(rid)
        floor = [p for p in walk if usable(p) and walk[p] >= 2]
        nook = lambda p: sum(nb not in cells for nb in ((p[0] + 1, p[1]), (p[0] - 1, p[1]), (p[0], p[1] + 1), (p[0], p[1] - 1)))
        if style in INDUSTRIAL and len(ground[rid]) >= 3 and station_budget > 0:
            near = [p for p in floor if p not in occupied and nook(p) >= 1 and not gap(p) and any(1 < max(abs(p[0] - g[0]), abs(p[1] - g[1])) <= 2 for g in ground[rid])]
            for p in choose(sorted(near, key=lambda p: (-nook(p), walk[p])), min(2, len(ground[rid]) // 3)):
                props.append(dict(cell=list(p), type=2035, offset=corner_offset(p))); station_budget -= 1
        if rid in secret_ids or rid == start_room or rid in closets: continue
        for kind in DECOR.get(style, []):
            spots = [p for p in floor if p not in occupied and nook(p) >= 2 and not gap(p) and all(q not in protected for q in ((p[0] + 1, p[1]), (p[0] - 1, p[1]), (p[0], p[1] + 1), (p[0], p[1] - 1)))]
            if kind not in SOLID_PROPS: spots = [p for p in floor if p not in occupied and nook(p) >= 1]
            got = choose(sorted(spots, key=lambda p: (-walk[p], p)), 1)
            for p in got: props.append(dict(cell=list(p), type=kind, offset=corner_offset(p)) if kind in SOLID_PROPS else dict(cell=list(p), type=kind))
    faces = {'E': (1, 0), 'N': (0, 1), 'W': (-1, 0), 'S': (0, -1)}
    taken = {(tuple(s['cell']), s['face']) for s in spec['switches']} | {(tuple(spec['exit']['cell']), spec['exit']['face'])}
    if 'secret_exit' in spec: taken.add((tuple(spec['secret_exit']['cell']), spec['secret_exit']['face']))
    for r in spec['rooms']:
        acc = STYLES[design['rooms'][r['id']][0]]['acc']
        rim = sorted((p, f) for p, c in cells.items() if c['room'] == r['id'] for f, d in faces.items()
                     if (p[0] + d[0], p[1] + d[1]) not in cells and (p[0] + d[0], p[1] + d[1]) not in solid and (p, f) not in taken)
        for i, (p, f) in enumerate(rim):
            if (p[0] * 3 + p[1] * 5 + 'ENWS'.index(f)) % 5 == 0:
                walls.append(dict(cell=list(p), face=f, texture=acc[(p[0] + p[1]) % len(acc)]))
    ex, ef = tuple(spec['exit']['cell']), spec['exit']['face']
    for step in (1, -1):
        side = (ex[0] + step * abs(faces[ef][1]), ex[1] + step * abs(faces[ef][0]))
        beyond = (side[0] + faces[ef][0], side[1] + faces[ef][1])
        if side in cells and beyond not in cells and beyond not in solid and (side, ef) not in taken:
            walls = [w for w in walls if (tuple(w['cell']), w['face']) != (side, ef)]
            walls.append(dict(cell=list(side), face=ef, texture='EXITSIGN')); break

    spec['enemies'] = enemies; spec['items'] = items; spec['props'] = props; spec['walls'] = walls
    if not spec['triggers']: del spec['triggers']
    return transform(spec, design.get('xform', 'id'))


# ------------------------------------------------------------ orientation
XFORMS = {'id': (1, 0, 0, 1), 'flipx': (-1, 0, 0, 1), 'flipy': (1, 0, 0, -1), 'rot90': (0, -1, 1, 0),
          'rot180': (-1, 0, 0, -1), 'rot270': (0, 1, -1, 0), 'transpose': (0, 1, 1, 0), 'anti': (0, -1, -1, 0)}


def transform(spec, name):
    a, b, c, d = XFORMS[name]
    if name == 'id': return spec
    def pt(p): return [a * p[0] + b * p[1], c * p[0] + d * p[1]]
    def vec(v): return (a * v[0] + b * v[1], c * v[0] + d * v[1])
    face = {f: next(g for g, w in DIRS.items() if w == vec(v)) for f, v in DIRS.items()}
    def ang(deg):
        r = math.radians(deg); v = vec((math.cos(r), math.sin(r)))
        return round(math.degrees(math.atan2(v[1], v[0]))) % 360
    def rect(r, origin=(0, 0)):
        x, y, w, h = r
        p, q = pt((x + origin[0], y + origin[1])), pt((x + origin[0] + w - 1, y + origin[1] + h - 1))
        return [min(p[0], q[0]), min(p[1], q[1]), abs(p[0] - q[0]) + 1, abs(p[1] - q[1]) + 1]
    for r in spec['rooms']:
        old = r['rect']; new = rect(old)
        for blk in r.get('blocks', []):
            n = rect(blk[:4], old[:2]); blk[:4] = [n[0] - new[0], n[1] - new[1], n[2], n[3]]
        for s in r.get('surfaces', []):
            n = rect(s['rect'], old[:2]); s['rect'] = [n[0] - new[0], n[1] - new[1], n[2], n[3]]
        r['rect'] = new
    for link in spec['links']:
        link['path'] = [pt(p) for p in link['path']]
        for key in ('at', 'lift', 'block'):
            if key in link: link[key] = pt(link[key])
    for t in spec.get('triggers', []):
        t['cell'] = pt(t['cell']); t['face'] = face[t['face']]
        if t['action'] == 'teleport':
            t['dest'] = pt(t['dest']); t['angle'] = ang(t.get('angle', 0))
    spec['start']['cell'] = pt(spec['start']['cell']); spec['start']['angle'] = ang(spec['start'].get('angle', 90))
    for group in ('keys', 'items', 'props', 'enemies'):
        for t in spec.get(group, []):
            t['cell'] = pt(t['cell'])
            if 'angle' in t: t['angle'] = ang(t['angle'])
            if 'offset' in t: t['offset'] = list(vec(t['offset']))
    for t in spec['switches'] + [spec['exit']] + spec.get('walls', []) + ([spec['secret_exit']] if 'secret_exit' in spec else []):
        t['cell'] = pt(t['cell']); t['face'] = face[t['face']]
    return spec
