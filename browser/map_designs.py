"""Room-by-room designs for GRIDFALL maps 9-24.

Each map starts from its base floor plan in maps/plans.json. Edit a room's
line below, then run this script to rewrite those maps in maps/levels.json:

    python browser/map_designs.py            rebuild every designed map
    python browser/map_designs.py 14 20      rebuild only maps 14 and 20
    python browser/map_designs.py --check    build and validate, write nothing

Then pack them with: python browser/build.py --assets-only
Maps 1-8 are edited directly in maps/levels.json.
"""
import argparse
import json
from pathlib import Path

from campaign_maps import compile_map
from map_content import build
from map_layout import HP

# Map options: xform turns or mirrors the finished map; mix splits ammunition between shells (s),
# bullets (b), cells (c) and rockets (r); vault moves the secret room beside (host room, sides, size).
#   loops     extra corridors: key = locked with that card, lift = a platform, window = a sill to see across
#   drop      cards to remove; a machine takes over their door
#   unlink    plan links to remove (room pairs); moves = put one of the plan's switches in another room
#   links     changes to the plan's own links: block = barrier a control sinks, heavy = slow shutter,
#             lift = platform instead of a ramp, z/height = a level tunnel
#   controls  a wall switch in a room that works a machine (lower, raise, sink, open)
#   rewire    give one of the plan's switches a machine to work instead of its door
#   bays      sealed robot bays beside a room; all bays and shutters of one gate name open together
#   ambush    a closet that opens when its bait is touched: key:COLOR, switch:GATE or control:TARGET
# room: (style, shape ops, encounter, named rewards)
# Styles and reward codes are the STYLES and ITEM tables in map_layout.py. Shape ops are the cases in its
# build_shape: cut, pillars, aisles, island, bays, pit, dais, mezz, steps, crates, planters, machines, nave,
# sky, lowend, trench, hazstrip, and the machine floors canal, moat (bridged cuts), basin (drained) and press.
# h=, l=, z= and fx= set a room's ceiling height, light, floor height and light effect.
# encounter token = tactic + count + unit.  Tactics: F front of the entrance, R rear, M middle, K beside the
# door, H out of sight, U upper level, P perched on cover, G guarding the objective, W along walls, A airborne.
# Units: s sentry, b breacher, w welder, r rammer, c cloaked rammer, d drone, i interceptor, B bastion.
# A token ending in + appears on medium and hard only, ! on hard only; the rest thin out by themselves.
DESIGNS = {}
DESIGNS[9] = dict(drop=['yellow'], controls=[dict(room='crane', action='raise', target='gantry', name='Gantry control')],
    ambush=[dict(on='key:blue', host='dispatch', sides='ESN', size=(3, 2), enc='F2r F1b')],
    links=[dict(a='containers', b='crane', lift=True)],
    objective='Recover dispatch access, then lower the gantry bridge from the crane gallery to cross the freight tracks.', xform='id', mix=dict(s=.5, b=.3, r=.2), loops=[dict(a='dispatch', b='crane', key='blue'), dict(a='dispatch', b='freight', window=True)], rooms={
    'gatehouse': ('office', 'cut', '', ''),
    'freight': ('yard', 'crates:4', 'F3s K2s R2b', ''),
    'loading': ('service', 'aisles:CRATE1', 'M2w H2s R1b', 'MG'),
    'dispatch': ('office', 'cut:NE+SW:1', 'G2b F1s H1w', ''),
    'containers': ('yard', 'aisles:CRATE1', 'F2s R2w H2r W1w K1b', ''),
    'forklift': ('power', 'machines:TECH02', 'M2r F1b K1s', 'RL'),
    'crane': ('warn', 'mezz:E', 'G2b U2w F1s', ''),
    'shed': ('service', 'crates:3 nave', 'F2s H1r R2b', ''),
    'rail': ('yard', 'canal:x:N:gantry:FLAT5_2:3 crates:2', 'A2d R2w F2s K1b M1r', ''),
    'cache': ('vault', '', '', 'SAW SOUL RBOX')})
DESIGNS[10] = dict(drop=['red'], links=[dict(a='inspection', b='generator', block='bollards')],
    controls=[dict(room='command', action='lower', target='bollards', name='Cordon bollards')],
    ambush=[dict(on='key:yellow', host='security', sides='ENS', size=(2, 3), enc='F2r')],
    objective='Pass the containment checkpoints, drop the cordon bollards from quarantine command, and cut power to the cordon.', xform='flipx', mix=dict(s=.4, b=.2, c=.3, r=.1), loops=[dict(a='screening', b='security', key='blue')], rooms={
    'entry': ('service', 'cut', '', ''),
    'street': ('street', 'crates:4', 'F3s K2s R1w W2b', ''),
    'shelter': ('tile', 'bays', 'M1w H2s F1b', 'MG'),
    'screening': ('medical', 'cut:NW+SE:1', 'G1b F2s H1w', ''),
    'processing': ('office', 'pillars nave', 'F1w R2b K2s', 'PR'),
    'evidence': ('vault', '', '', 'CPAK MEGA'),
    'holding': ('yard', 'bays:GRAY5 crates:2', 'A3i R1w H2r P2w', ''),
    'security': ('office', 'dais:E', 'G2b F1w K1s', ''),
    'inspection': ('compute', 'machines:COMPTALL', 'F2w R1w A2i H1c M1r', ''),
    'command': ('office', 'dais:W', 'G2b U2w A2i', ''),
    'generator': ('power', 'machines:TECH02 pit', 'G2w M1r H1c A2i R1w', ''),
    'breach': ('street', 'crates:2', 'F1w R1r W1b', '')})
DESIGNS[11] = dict(rewire={'pump': dict(action='sink', target='basin')},
    links=[dict(a='pump', b='settling', gate=None, at=None), dict(a='settling', b='outfall', z=-48, height=64)],
    objective='Restart the pumps to drain the settling basin, then take the outfall tunnel out.', xform='rot90', mix=dict(s=.45, b=.25, r=.3), loops=[dict(a='filters', b='controls')], rooms={
    'workshop': ('service', 'cut', '', ''),
    'intake': ('water', 'pit:haz', 'F3s W2s A1d R2w', 'SUIT'),
    'filters': ('water', 'trench:y:FWATER1 pillars', 'M1r H2s R2w', 'MG'),
    'lab': ('medical', 'cut:NE+SW:1', 'G2b F1w H1s', ''),
    'pump': ('plant', 'machines:PIPE2 dais:N', 'F2w K2s R2r M1w U2w', 'RL'),
    'controls': ('compute', 'dais:W', 'G2b F2s U1w', ''),
    'settling': ('water', 'basin:E:basin:4', 'A2d W2w R2r H1c', ''),
    'outfall': ('yard', 'z=-48 crates:3', 'F2s R1w M2r H1c K1b', ''),
    'sluice': ('office', 'z=-48 cut:1', 'G1b F1w R1r', ''),
    'store': ('vault', '', '', 'SOUL RBOX BSK')})
DESIGNS[12] = dict(ambush=[dict(on='key:yellow', host='monitor', sides='ENS', size=(2, 3), enc='F2r F1w')],
    links=[dict(a='formation', b='monitor', lift=True)], xform='rot270', mix=dict(s=.35, b=.2, c=.3, r=.15), loops=[dict(a='quality', b='monitor', key='blue')], rooms={
    'dock': ('service', 'cut', '', ''),
    'press': ('machine', 'machines:SP_HOT1', 'F3s K2s R1w M1r', ''),
    'mixing': ('power', 'pit:haz', 'W1w A2i H1r F1s', 'MG SUIT'),
    'quality': ('office', 'cut:NW+SE:1', 'G2b F1w', ''),
    'formation': ('power', 'aisles:TECH02', 'F1w H1r R2b A2i W1w', 'PR'),
    'reclaim': ('service', 'crates:3', 'M1w H1c K1s', 'RL'),
    'monitor': ('compute', 'mezz:E', 'G2b U1w F1s', ''),
    'thermal': ('machine', 'pit:lava h=192 fx=8', 'M1B A2d R1w F1b', ''),
    'packing': ('service', 'crates:4 nave', 'F1w R1w H1r W1b', ''),
    'isolation': ('power', 'machines:TECH02', 'G1w A2i F1r', ''),
    'shipping': ('yard', 'crates:3', 'F2s R1w K1b', ''),
    'store': ('vault', '', '', 'MEGA CPAK')})
DESIGNS[13] = dict(links=[dict(a='crossing', b='dispatch', lift=True)],
    ambush=[dict(on='switch:north', host='crossing', sides='WNE', size=(3, 2), enc='F2r F1b')], xform='rot180', mix=dict(s=.3, b=.15, c=.35, r=.2), loops=[dict(a='tunnel', b='east'), dict(a='west', b='south', window=True)],
    vault=('depot', 'WNS', (4, 4)), rooms={
    'tunnel': ('concrete', 'cut', '', ''),
    'south': ('street', 'crates:5', 'F3s K2b R1w W2s M1r', ''),
    'west': ('office', 'cut:NE+SE:1', 'G2b F2s H1w', ''),
    'east': ('compute', 'pillars:COMPTALL', 'M1w H2s F1b', 'MG'),
    'crossing': ('street', 'island:3:BRICK01 crates:3', 'A3i F1b R1w H1r W2s P2w', ''),
    'depot': ('service', 'aisles:CRATE1', 'M2r F1w K1s', 'PR'),
    'dispatch': ('compute', 'dais:E', 'G2b U2w F1s A2i', ''),
    'north': ('street', 'crates:4 trench:x', 'A2d F1b R1w M1r K2s', ''),
    'camera': ('compute', 'machines:COMPTALL', 'G1b M2w A3i H1r', 'MEDI'),
    'exit': ('street', 'crates:2', 'A2d R2w F2b M2r', ''),
    'locker': ('vault', '', '', 'RL RBOX SOUL')})
DESIGNS[14] = dict(drop=['red'], links=[dict(a='guesteast', b='roof', block='stairgate')],
    controls=[dict(room='suite', action='lower', target='stairgate', name='Roof stair release')],
    ambush=[dict(on='key:yellow', host='security', sides='ENS', size=(2, 3), enc='F2r')],
    objective='Find the evacuation credentials, release the roof stair from the liaison suite, and reach the landing zone.', xform='flipx', mix=dict(s=.3, b=.15, c=.35, r=.2), loops=[dict(a='reception', b='security', key='blue'), dict(a='suite', b='plant')], rooms={
    'laundry': ('service', 'cut', '', ''),
    'lobby': ('tile', 'pillars nave', 'F3s K2s R1w M1r', ''),
    'restaurant': ('tile', 'crates:4', 'M1r H2r R1w F1s', 'MG SAW'),
    'reception': ('office', 'cut:NW+SW:1', 'G2b F1s H1w', ''),
    'guestwest': ('tile', 'bays', 'F1w H2r H1c K2s R1w', 'PR'),
    'linen': ('vault', '', '', 'SOUL INVIS CELL'),
    'security': ('office', 'dais:E', 'G2b F1w U1w', ''),
    'guesteast': ('tile', 'bays', 'F1w H1r H1c R1w A2i K1s', ''),
    'suite': ('office', 'cut:NE+SW:1 nave', 'G2b M1r H1c F1w', ''),
    'plant': ('plant', 'machines:PIPE2', 'M1w A3i R1r', 'RL'),
    'roof': ('yard', 'planters:4 dais:N', 'A3d A3i R1w M2r F1s W1b', ''),
    'stair': ('concrete', 'cut:1', 'F1w R1r G1b', '')})
DESIGNS[15] = dict(links=[dict(a='frames', b='crane', lift=True)],
    ambush=[dict(on='key:red', host='shipping', sides='ENS', size=(2, 3), enc='F2r F1w')], xform='transpose', mix=dict(s=.3, b=.15, c=.35, r=.2), loops=[dict(a='crane', b='testing', key='yellow')],
    vault=('tools', 'WNS', (5, 4)), rooms={
    'receiving': ('service', 'cut', '', ''),
    'frames': ('yard', 'crates:5', 'F3s K2s R1w W1w M2r', ''),
    'offices': ('office', 'bays', 'M2w H2s F1b', 'MG'),
    'crane': ('warn', 'mezz:E', 'G2b U2w F1w', ''),
    'assembly': ('machine', 'nave press:x:stamp machines:SP_HOT1', 'F2w R2w H2r W1w A3i M1r', 'PR'),
    'tools': ('service', 'aisles:CRATE1', 'M1r H1c R1w K1b', 'RL'),
    'testing': ('compute', 'pit', 'F2w A3i R2b H1c M1r', ''),
    'shipping': ('office', 'cut:NW+SW:1', 'G2b F1w H1r', ''),
    'outbound': ('yard', 'crates:4', 'M1B A3d R3w F2s K1b', ''),
    'cache': ('vault', '', '', 'MEGA RBOX BSK')})
DESIGNS[16] = dict(ambush=[dict(on='switch:field', host='intake', sides='NSE', size=(3, 2), enc='F2r F1w')],
    controls=[dict(room='spares', action='raise', target='span', name='Field bridge')],
    objective='Trip the substation interlocks, raise the field bridge from the spares store, and cross the live transformer field.', xform='anti', mix=dict(s=.25, b=.1, c=.4, r=.25), loops=[dict(a='service', b='west')],
    vault=('east', 'ESN', (4, 4)), vault_name='Relay spares locker', rooms={
    'service': ('concrete', 'cut', '', ''),
    'intake': ('power', 'machines:TECH02', 'F2w K2b R1w M2r', 'PR'),
    'west': ('compute', 'dais:W', 'G2b F1w H1r', ''),
    'east': ('compute', 'pillars:COMPTALL', 'M1w H1r F2b', 'RL'),
    'field': ('field', 'moat:x:S:span:NUKAGE1:8 machines:TECH02', 'M2B A3d W3w H1r F2w A2i', 'SUIT'),
    'spares': ('power', 'crates:3', 'M1r H1r R1w', 'SOUL'),
    'isolation': ('compute', 'dais:E', 'G1B F1w A2i', ''),
    'exit': ('yard', 'cut:1', 'F1w R1w', ''),
    'cache': ('vault', '', '', 'MEGA CPAK')})
DESIGNS[17] = dict(drop=['red'], controls=[dict(room='shelter', action='raise', target='span', name='Canal bridge')],
    ambush=[dict(on='key:yellow', host='clinic', sides='ENS', size=(2, 3), enc='F2r')],
    objective='Recover the two civic access cards and raise the canal bridge from the shelter office.', xform='flipy', mix=dict(s=.3, b=.15, c=.35, r=.2), loops=[dict(a='civic', b='clinic', key='blue')],
    vault=('school', 'WNS', (4, 5)), rooms={
    'cellar': ('concrete', 'cut', '', ''),
    'market': ('street', 'crates:5', 'F3s K2s R1w W2b M2r', ''),
    'bakery': ('ruin', 'bays fx=1', 'M1w H2s F1b', 'MG SAW'),
    'civic': ('office', 'cut:NE+SW:1', 'G2b F2s H1w', ''),
    'lane': ('street', 'bays:BRICK01', 'F1b R1w H2r W2s A2i K1w', ''),
    'school': ('ruin', 'pillars', 'M2w H1c R1w F1r', 'PR'),
    'clinic': ('medical', 'dais:E', 'G2b F1w U1w H1c', ''),
    'court': ('yard', 'planters:4', 'A2d F1b R2w M1r W1s A2i', ''),
    'post': ('office', 'aisles:STWAR01', 'F2w H2r R2w K1b', 'SOUL'),
    'shelter': ('office', 'cut:1', 'G1b F1w M1r A2i', ''),
    'bridge': ('street', 'moat:x:S:span:FWATER1:2', 'M1B A1d R2w F1b', ''),
    'store': ('vault', '', '', 'RL RBOX MEGA')})
DESIGNS[18] = dict(ambush=[dict(on='key:blue', host='concierge', sides='ENS', size=(2, 3), enc='F2r F1w')],
    links=[dict(a='westwing', b='roof', lift=True)],
    objective='Reopen the stairwell power circuit and ride the service lift to the occupied residential roof.', xform='rot180', mix=dict(s=.3, b=.15, c=.35, r=.2), loops=[dict(a='concierge', b='eastwing', key='blue')],
    vault=('plant', 'NES', (4, 4)), rooms={
    'basement': ('concrete', 'cut', '', ''),
    'court': ('yard', 'planters:4', 'F2w K2b R1w W1w M2r', ''),
    'community': ('tile', 'crates:3', 'M2r H1w F1b', 'MG'),
    'concierge': ('office', 'cut:NE+SW:1', 'G2b F1w', ''),
    'westwing': ('tile', 'bays', 'F1w H1r H1c R1w K2b A2i', 'PR'),
    'utility': ('power', 'machines:TECH02', 'G2w F1r A2i H1c', ''),
    'eastwing': ('tile', 'bays', 'F2w H1r R1w A2i K1b', ''),
    'roof': ('yard', 'planters:5 dais:N', 'M1B A3d R2w F2b W1w A2i', ''),
    'plant': ('plant', 'machines:PIPE2', 'M2w A1d H1r R2w F1r', 'RL'),
    'exit': ('concrete', 'cut:1', 'F1w R1r', ''),
    'cache': ('vault', '', '', 'SOUL CPAK INVIS')})
DESIGNS[19] = dict(drop=['red'], links=[dict(a='transit', b='exit', block='stairgate')],
    controls=[dict(room='transit', action='lower', target='stairgate', name='Street stair release')],
    ambush=[dict(on='key:blue', host='arcade', sides='SNW', size=(3, 2), enc='F2w F1r'), dict(on='key:yellow', host='atrium', sides='NSW', size=(3, 2), enc='F3r')],
    objective='Recover retail and service access, then release the street stair from transit control.', xform='rot90', mix=dict(s=.25, b=.1, c=.5, r=.15), loops=[dict(a='shop', b='parking', key='yellow'), dict(a='security', b='arcade', window=True)],
    vault=('food', 'WNS', (5, 4)), rooms={
    'delivery': ('concrete', 'cut', '', ''),
    'arcade': ('tile', 'bays nave', 'F3s K2s R1w W2b M1r', ''),
    'security': ('office', 'dais:W', 'G2b F2s H1w', ''),
    'shop': ('tile', 'aisles:COMPTALL', 'M1w H2s F1r', 'MG'),
    'atrium': ('tile', 'island:3 sky', 'F1w R1w A2i H1r W2w M1B', ''),
    'food': ('tile', 'crates:4', 'M1r H1w F2b A2i', 'PR'),
    'service': ('office', 'cut:1', 'G2b F1w H1r', ''),
    'north': ('tile', 'bays nave', 'F1w R1w H2r K2s A2i W1b', ''),
    'parking': ('concrete', 'pillars l=144', 'M1B A2d H2r W3w F2s', 'MEGA'),
    'transit': ('compute', 'dais:E', 'G2b F2w A2d', ''),
    'exit': ('concrete', 'steps:N', 'F2w R2r', ''),
    'cache': ('vault', '', '', 'EMP CPAK SOUL')})
DESIGNS[20] = dict(ambush=[dict(on='key:yellow', host='control', sides='ENS', size=(2, 3), enc='F2r F1c')],
    links=[dict(a='relay', b='output', block='firewall')], rewire={'routing': dict(action='lower', target='firewall')},
    objective='Recover backbone access and drop the routing firewall from the relay room.', xform='rot270', mix=dict(s=.2, b=.1, c=.5, r=.2), loops=[dict(a='access', b='control', key='blue')],
    vault=('ups', 'WSN', (4, 4)), rooms={
    'intake': ('service', 'cut', '', ''),
    'distribution': ('compute', 'aisles:COMPTALL', 'F2w K1w R1w M1r A2i', ''),
    'legacy': ('office', 'bays', 'M1w H1r F1w', 'MG'),
    'access': ('office', 'cut:1', 'G1w F1w A2i', ''),
    'corea': ('core', 'aisles:COMPTALL nave', 'F1w R1w H1r H1c A2d W1w A2i', 'PR'),
    'ups': ('power', 'machines:TECH02', 'M1r R1w A1d', ''),
    'control': ('compute', 'dais:E', 'G1w F1w A2i H1c', ''),
    'coreb': ('core', 'island:3:SP_HOT1 fx=8', 'M1B A2d R2w H2r F1w', ''),
    'cooling': ('water', 'pit:water', 'A1d W2w M2r H1c F1w', ''),
    'relay': ('power', 'machines:TECH02', 'G1w A2i F1r', ''),
    'output': ('yard', 'crates:3', 'F2w R2w M1r', ''),
    'cache': ('vault', '', '', 'EMP CPAK SOUL')})
DESIGNS[21] = dict(ambush=[dict(on='key:red', host='dispatch', sides='ENS', size=(2, 3), enc='F2r F1w')],
    controls=[dict(room='switchgear', action='raise', target='span', name='Feeder bridge')],
    objective='Recover field access, raise the feeder bridge from the switchgear hall, then isolate the feeders and cross the energy farm.', xform='id', mix=dict(s=.2, b=.05, c=.5, r=.25), loops=[dict(a='control', b='switchgear', key='blue')],
    vault=('battery', 'ESN', (4, 4)), rooms={
    'bunker': ('concrete', 'cut', '', ''),
    'south': ('field', 'machines:TECH02 crates:3', 'F2w K2b R2w W2b M1r A2d', ''),
    'control': ('warn', 'dais:W', 'G2b F1w H1r A2i', 'RL'),
    'battery': ('power', 'aisles:TECH02', 'M1w H2r H1c R1b F2w', 'PR'),
    'north': ('field', 'moat:y:W:span:NUKAGE1:8 machines:TECH02', 'M1B A2d F2w R2w W1b H1r A2i', 'SUIT'),
    'switchgear': ('power', 'machines:TECH02', 'G2b F2w A2i M1r H1c', ''),
    'dispatch': ('compute', 'mezz:E', 'G2b U2w F2w A2i', 'EMP'),
    'conduit': ('machine', 'pit:lava h=192', 'M1B A2d R2w F2b W1b M2r', ''),
    'exit': ('street', 'crates:3', 'F1w R2w A2i M1r', ''),
    'cache': ('vault', '', '', 'MEGA SOUL CPAK')})
DESIGNS[22] = dict(drop=['red'], unlink=[('relay', 'exit')], moves={'dispatch': 'outbound'},
    bays=[dict(host='outbound', sides='S', gate='dispatch', enc='F2r F1r!'), dict(host='outbound', sides='S', gate='dispatch', enc='F1B+ F2w'),
          dict(host='outbound', sides='W', size=(2, 3), gate='dispatch', enc='F1r F1r! F1c! F1b'), dict(host='outbound', sides='W', size=(2, 3), gate='dispatch', enc='F2w F2b'),
          dict(host='outbound', sides='N', gate='dispatch', enc='A2i A2i!'), dict(host='outbound', sides='E', size=(2, 3), gate='dispatch', enc='F4s'),
          dict(host='outbound', sides='NSWE', gate='dispatch', enc='A2d')],
    objective='Break the two production locks, throw the foundry shutdown, and hold out until the supply tunnel shutter grinds open.', xform='flipx', mix=dict(s=.2, b=.05, c=.5, r=.25), loops=[dict(a='control', b='tooling', key='blue'), dict(a='cooling', b='outbound', key='yellow'), dict(a='outbound', b='exit', gate='dispatch', heavy=True)],
    vault=('tooling', 'NWS', (4, 4)), rooms={
    'intake': ('service', 'cut', '', ''),
    'casting': ('machine', 'pit:lava machines:SP_HOT1 h=192 fx=8', 'F1w K2b R1w M1r A2d M1B', 'SUIT'),
    'control': ('compute', 'dais:W', 'G2b F1w H1r A2i', 'PR'),
    'cooling': ('water', 'pit:lava', 'W2w A2i M1r H1r', 'RL'),
    'milling': ('machine', 'aisles:SP_HOT1 nave', 'F1w R1w H2r W2w A2d M1B', ''),
    'tooling': ('compute', 'cut:1', 'G2b F2w H1r', ''),
    'assembly': ('machine', 'press:x:stamp machines:SP_HOT1', 'F2b R2w M1r H2r A2i', ''),
    'logic': ('core', 'dais:E', 'F2w A2i M1r', ''),
    'outbound': ('yard', 'crates:4', 'F2b R2w', 'MG RL BULL BULL RBOX RBOX MEDI MEDI'),
    'relay': ('power', '', 'G1w', 'MEGA CPAK MEDI MEDI'),
    'exit': ('concrete', 'cut:1', '', ''),
    'cache': ('vault', '', '', 'EMP SOUL CPAK')})
DESIGNS[23] = dict(drop=['yellow', 'red'], links=[dict(a='isolate', b='shutdown', block='shield1'), dict(a='shutdown', b='end', block='shield2')],
    controls=[dict(room='yellow', action='lower', target='shield1', name='East authority release'),
              dict(room='red', action='lower', target='shield2', name='Upper authority release')],
    ambush=[dict(on='control:shield1', host='arena', sides='SE', size=(3, 2), enc='F2r F2w'), dict(on='control:shield2', host='arena', sides='NW', size=(3, 2), enc='A3i F1r')],
    objective='Take the west authority card, release both core shields from the east chamber and the upper gallery, and end the broadcast.', xform='transpose', mix=dict(s=.15, b=.05, c=.55, r=.25), loops=[dict(a='blue', b='red')],
    vault=('yellow', 'ENS', (4, 4)), rooms={
    'entry': ('core', 'cut', '', ''),
    'arena': ('core', 'pit:lava pillars:SP_HOT1 h=192 fx=8', 'M2B A2d W3w R2w F2b H2r A4i', 'SUIT'),
    'blue': ('compute', 'dais:W', 'G1B F1w A2i H1r', 'RL'),
    'yellow': ('compute', 'dais:E', 'G1B F1w A2d H1r', 'CPAK'),
    'red': ('core', 'mezz:N', 'G2b U2w A2d F2w M1r A2i', ''),
    'isolate': ('compute', 'cut:1', 'F1w A2i', ''),
    'shutdown': ('core', 'island:2:SP_HOT1', 'M1B A2d R2w F2b H1r', ''),
    'end': ('core', 'dais:E', 'F2w A2i R1r', ''),
    'cache': ('vault', '', '', 'SOUL MEGA CPAK')})
DESIGNS[24] = dict(drop=['red'], links=[dict(a='water', b='exit', gate='seal')],
    controls=[dict(room='security', action='open', target='seal', name='Escape passage release')],
    bays=[dict(host='water', sides='SNW', gate='seal', enc='F2s F1w')],
    objective="The voice on the radio came from here. Recover the two seal cards and release the survivors' escape passage from shelter security.", xform='flipy', mix=dict(s=.55, b=.35, r=.1), loops=[dict(a='admin', b='power', key='blue')],
    vault=('stores', 'WSN', (4, 4)), vault_name='Survivor weapon cache',
    rooms={
    'stairs': ('concrete', 'cut', '', ''),
    'commons': ('concrete', 'pillars', 'F3s K1s R1w W1b', ''),
    'medical': ('medical', 'bays', 'M1s H1w F1b', 'MG'),
    'admin': ('office', 'cut:1', 'G2b F1s', ''),
    'dorms': ('concrete', 'bays fx=1', 'F2s H1w R2b K1s H1r', ''),
    'stores': ('service', 'crates:3', 'M1s R1b', ''),
    'power': ('power', 'machines:TECH02', 'G1b F1w M1r', ''),
    'water': ('water', 'pit:water', 'W1w R1b F2s H1c', 'SOUL'),
    'security': ('office', 'dais:E', 'G1b F2w H1r', ''),
    'exit': ('yard', 'crates:2', 'F2s R1w', ''),
    'cache': ('vault', '', '', 'PR CELL CELL MEGA SAW')})


def report(spec):
    counts = [sum(bool(e["flags"] & skill) for e in spec["enemies"]) for skill in (1, 2, 4)]
    toughness = sum(HP[e["type"]] for e in spec["enemies"] if e["flags"] & 4)
    healing = sum({2011: 10, 2012: 25}.get(i["type"], 0) for i in spec["items"])
    print("%2d %-18s enemies easy/medium/hard %2d/%2d/%2d   hit points on hard %5d   first aid %3d" %
          (spec["id"], spec["title"], *counts, toughness, healing))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("maps", nargs="*", type=int, help="map numbers to rebuild; default is every designed map")
    parser.add_argument("--check", action="store_true", help="build and validate without writing levels.json")
    args = parser.parse_args()
    folder = Path(__file__).parent / "maps"
    plans = {plan["id"]: plan for plan in json.loads((folder / "plans.json").read_text(encoding="utf-8"))}
    levels = json.loads((folder / "levels.json").read_text(encoding="utf-8"))
    notes = []
    for number in args.maps or sorted(DESIGNS):
        spec = build(plans[number], DESIGNS[number], notes)
        compile_map(spec)       # the same card, switch and exit checks the asset build runs
        levels[number - 1] = spec
        report(spec)
    for note in notes:
        print("note:", note)
    if not args.check:
        with open(folder / "levels.json", "w", encoding="utf-8", newline="\n") as output:
            output.write(json.dumps(levels, indent=2) + "\n")
        print("Wrote maps/levels.json. Pack it with: python browser/build.py --assets-only")


if __name__ == "__main__":
    main()
