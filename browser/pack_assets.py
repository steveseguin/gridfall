"""Build GRIDFALL resources from its maps, artwork and numeric asset layout."""
from array import array
import re
import json
import struct
import sys


def words(*values):
    return struct.pack("<" + "I" * len(values), *(v & 0xffffffff for v in values))


def pixels16(values):
    result = array("H", values)
    if sys.byteorder != "little":
        result.byteswap()
    return result.tobytes()


def resource_ids(root):
    text = (root / "source/doomrez.h").read_text()
    text = re.sub(r"/\*.*?\*/|//[^\n]*", "", text, flags=re.S)
    ids = {"rTEXTURE1": 1}
    for body in re.findall(r"enum\s*\{(.*?)\}", text, re.S):
        value = 0
        for item in body.split(","):
            item = item.strip()
            if not item:
                continue
            parts = item.split("=")
            name = parts[0].strip()
            if len(parts) == 2:
                terms = parts[1].strip().split("+")
                value = sum(int(t) if t.strip().isdigit() else ids[t.strip()] for t in terms)
            ids[name] = value
            value += 1
    return ids


def sprite_groups():
    groups = {
        "BIGFISTS": "punch0 punch1 punch2 punch3", "BIGPISTOL": "pistol1 pistol2 pistol3 pflash",
        "BIGSHOTGUN": "s1 s2 s3 s4 sflash sflash2", "BIGCHAINGUN": "cg1 cg2 cflash cflash2",
        "BIGROCKET": "m1 m2 mflash mflash2 mflash3 mflash5", "BIGPLASMA": "plas1 plas2 plflash plflash2",
        "BIGBFG": "bfg1 bfg2 bflash bflash2", "BIGCHAINSAW": "cattack1 cattack2 chain1 chain2",
        "ZOMBIE": "poss:abcdefghijklmnopqrs", "ZOMBIEBODY": "poss:tu", "SHOTGUY": "spos:abcdefghijklmnopqrstu",
        "IMP": "troo:abcdefghijklmnopqrstu bal1:abcde", "DEMON": "sarg:abcdefghijklmn",
        "CACODEMON": "head:abcdef", "CACODIE": "head:ghijk", "CACOBDY": "head:l", "CACOBOLT": "bal2:abcde",
        "LOSTSOUL": "skul:abcdefghijk", "BARON": "boss:abcd", "BARONATK": "boss:efgh",
        "BARONDIE": "boss:ijklmn", "BARONBDY": "boss:o", "BARONBLT": "bal7:abcde",
        "OURHERO": "play:abcdefghijklmnopqrstu", "OURHEROBDY": "play:vw",
        "BARREL": "bar1:ab bexp:abcde", "IFOG": "ifog:abcde", "FIRECAN": "fcan:abc",
        "POOLBLOOD": "pol5:a", "CANDLE": "cand:a", "CANDLEABRA": "cbra:a",
        "SHOTGUN": "shot:a", "CHAINGUN": "mgun:a", "ROCKETLAUNCHER": "laun:a", "CHAINSAW": "csaw:a",
        "CLIP": "clip:a", "SHELLS": "shel:a", "ROCKET": "rock:a", "STIMPACK": "stim:a", "MEDIKIT": "medi:a",
        "GREENARMOR": "arm1:ab", "BLUEARMOR": "arm2:ab", "LIGHTCOLUMN": "colu:a", "BACKPACK": "bpak:a",
        "BOXROCKETS": "brok:a", "BOXAMMO": "ammo:a", "BOXSHELLS": "sbox:a", "TECHPILLAR": "elec:a",
        "BLUEKEYCARD": "bkey:ab", "YELLOWKEYCARD": "ykey:ab", "REDKEYCARD": "rkey:ab",
        "RADIATIONSUIT": "suit:a", "IRGOGGLES": "pvis:ab", "COMPUTERMAP": "pmap:abcd",
        "INVISIBILITY": "pins:abcd", "HEALTHBONUS": "bon1:abcd", "SOULSPHERE": "soul:abcd", "ARMORBONUS": "bon2:abcd",
        "BODYPOLE": "pol1:a", "FIVESKULLPOLE": "pol2:a", "TALLSKULLPOLE": "pol4:a",
        "SHORTGREENPILLAR": "col2:a", "SHORTREDPILLAR": "col4:a", "FLAMINGSKULLS": "fsku:abc",
        "MEDDEADTREE": "tre1:a", "LARGESTAL": "smit:a", "SMALLSTAL": "smt2:a",
        "BLUESKULLKEY": "bsku:ab", "REDSKULLKEY": "rsku:ab", "YELLOWSKULLKEY": "ysku:ab",
        "PLASMARIFLE": "plas:a", "BFG9000": "bfug:a", "CELL": "cell:a", "BERZERKER": "pstr:a", "CELLPACK": "celp:a",
        "HANGINGRUMP": "gor5:a", "REDTORCH": "smrt:abcd", "BLUETORCH": "smbt:abcd", "GREENTORCH": "smgt:abcd",
        "INVULNERABILITY": "pinv:abcd", "TELEFOG": "tfog:abcdefghij", "BFS1": "bfs1:ab", "BFE1": "bfe1:abcdef",
        "BFE2": "bfe2:abcd", "PLSS": "plss:ab", "PLSE": "plse:abcde", "MISL": "misl:abcd",
        "BLUD": "blud:abc", "PUFF": "puff:abcd"
    }
    return groups


def make_sprite_group(description, files, weapon, theme):
    from machine_assets import PROPS, PICKUPS, ROBOT_SCALES, ROBOT_CANVAS
    frames = []
    for token in description.split():
        if ":" in token:
            prefix, letters = token.split(":")
            frames.extend((prefix, letter, "") for letter in letters)
        else:
            frames.append(token)
    # Browser player variants follow the 21 original frames, seven per set.
    if theme and description == "play:abcdefghijklmnopqrstu":
        for variant in ("pistol", "fist", "saw", "energy"):
            frames.extend(("play", letter, variant) for letter in "abcdefg")
    blob = bytearray(4 * len(frames))
    cache = {}

    def append_shape(name, variant=""):
        key = (name, variant)
        if key in cache:
            return cache[key]
        w, h, bounds = files[name]
        if theme:
            # Static replacement props reuse their first frame's dimensions.
            # The old torch/powerup bounds change as they animate; applying those
            # bounds to a fixed lamp or case makes it grow and slide in place.
            if not weapon and (name[:4] in PROPS or name[:4] in PICKUPS or name[:4] in ("bkey", "rkey", "ykey", "bsku", "rsku", "ysku")):
                base = name[:4] + "a0"
                if base in files:
                    w, h, bounds = files[base]
            if name.startswith("play") and name[4] in "abcdefg":
                w, h = 80, 64
            elif name[:4] in ROBOT_SCALES:
                w = h = ROBOT_CANVAS
            pix = theme.player_sprite(name, w, h, variant) if variant else theme.sprite(name, w, h, bounds, weapon)
        # Crop the full 320x200 weapon sheets, retaining their screen position.
        left, top = theme.sprite_anchor(name, w, h, pix) if theme and not weapon else (w // 2, h - 5)
        if theme and name[:4] in ROBOT_SCALES:
            # Robots are drawn on a roomy canvas. Store the occupied rows and,
            # for single-view frames, the occupied columns.
            visible = [i for i, value in enumerate(pix) if value]
            y0, y1 = min(i // w for i in visible), max(i // w for i in visible) + 1
            x0, x1 = (0, w) if name[5] in "12345678" else (min(i % w for i in visible), max(i % w for i in visible) + 1)
            pix = [pix[y * w + x] for y in range(y0, y1) for x in range(x0, x1)]
            w, h, left, top = x1 - x0, y1 - y0, left - x0, top - y0
        if weapon:
            visible = [(i % w, i // w) for i, p in enumerate(pix) if p]
            x0, y0 = min(x for x, y in visible), min(y for x, y in visible)
            x1, y1 = max(x for x, y in visible) + 1, max(y for x, y in visible) + 1
            pix = [pix[y * w + x] for y in range(y0, y1) for x in range(x0, x1)]
            w, h, left, top = x1 - x0, y1 - y0, x0, y0
        elif theme and name.startswith("play") and name[4] in "abcdefg":
            # Trim transparent work without changing the shared actor anchor.
            # Keep horizontal bounds symmetric for the mirrored directions.
            visible = [i for i, value in enumerate(pix) if value]
            pad = min(min(i % w for i in visible), w - 1 - max(i % w for i in visible))
            y0 = min(i // w for i in visible)
            pix = [pix[y * w + x] for y in range(y0, h) for x in range(pad, w - pad)]
            w, h, left, top = w - 2 * pad, h - y0, left - pad, top - y0
        elif theme and len(name) > 5 and name[5] in "12345678":
            # The renderer mirrors pixels around the patch center. Center the
            # registered pivot in an odd-width patch so either view uses exactly
            # the same world point, without a runtime offset correction.
            visible = [i % w for i, value in enumerate(pix) if value]
            if visible:
                radius = max(left-min(visible), max(visible)-left)
                width = radius*2+1
                pix = [pix[y*w+x] if 0 <= x < w else 0
                       for y in range(h) for x in range(left-radius, left+radius+1)]
                w, left = width, radius
        while len(blob) % 4:
            blob.append(0)
        offset = len(blob)
        blob.extend(struct.pack("<hhHH", left, top, w, h) + pixels16(pix))
        cache[key] = offset
        return offset

    for index, frame in enumerate(frames):
        if isinstance(frame, str):
            offset = append_shape(frame)
        else:
            prefix, letter, variant = frame
            if variant == "energy" and letter != "f":
                # Reuse the original rotation table; only the flash pixels differ.
                offset = struct.unpack_from("<I", blob, (ord(letter) - ord("a")) * 4)[0]
                struct.pack_into("<I", blob, index * 4, offset)
                continue
            flat = prefix + letter + "0"
            if flat in files:
                offset = append_shape(flat, variant)
            else:
                while len(blob) % 4:
                    blob.append(0)
                base = len(blob)
                blob.extend(bytes(32))
                for rotation in range(1, 9):
                    matches = []
                    for name in files:
                        if name[:4] != prefix:
                            continue
                        if name[4:6] == letter + str(rotation):
                            matches.append((name, False))
                        elif name[6:8] == letter + str(rotation) and name != "playb4b8":
                            matches.append((name, True))
                    # One original player sheet is named playb4b8 instead of b4b6.
                    if not matches and prefix == "play" and letter == "b" and rotation == 6:
                        matches = [("playb4b8", True)]
                    if not matches:
                        raise ValueError(f"Missing sprite {prefix}{letter}{rotation}")
                    name, flip = matches[0]
                    target = append_shape(name, variant)
                    struct.pack_into("<I", blob, base + (rotation - 1) * 4, (target - base) | (0x80000000 if flip else 0))
                offset = base | 0x40000000
        struct.pack_into("<I", blob, index * 4, offset)
    return blob


def convert_map(lumps, textures, flats):
    def records(name, fmt):
        return list(struct.iter_unpack("<" + fmt, lumps[name]))

    def counted(rows):
        return words(len(rows)) + b"".join(words(*r) for r in rows)

    def texture(name):
        name = name.rstrip(b"\0").decode("ascii").upper()
        return -1 if name == "-" else textures[name]

    def flat(name):
        name = name.rstrip(b"\0").decode("ascii").upper()
        return -1 if name == "F_SKY1" else flats[name]

    things = counted([(x << 16, y << 16, (angle % 360) * (1 << 32) // 360, kind, flags) for x, y, angle, kind, flags in records("THINGS", "hhhHH")])
    lines = counted([(a, b, flags, special, tag, s0, -1 if s1 == 65535 else s1) for a, b, flags, special, tag, s0, s1 in records("LINEDEFS", "7H")])
    sides = counted([(x << 16, y << 16, texture(t), texture(b), texture(m), sector) for x, y, t, b, m, sector in records("SIDEDEFS", "hh8s8s8sH")])
    vertices = b"".join(words(x << 16, y << 16) for x, y in records("VERTEXES", "hh"))
    segs = counted([(a, b, angle << 16, offset << 16, line, side) for a, b, angle, line, side, offset in records("SEGS", "6H")])
    subsectors = counted(records("SSECTORS", "HH"))
    sectors = counted([(floor << 16, ceiling << 16, flat(f), flat(c), light, special, tag) for floor, ceiling, f, c, light, special, tag in records("SECTORS", "hh8s8shHH")])
    nodes = counted([tuple(v << 16 for v in row[:12]) + row[12:] for row in records("NODES", "12h2H")])
    raw = list(struct.unpack("<" + "H" * (len(lumps["BLOCKMAP"]) // 2), lumps["BLOCKMAP"]))
    x, y = struct.unpack_from("<hh", lumps["BLOCKMAP"])
    width, height = raw[2:4]
    if width * height > len(raw) - 4 or any(o >= len(raw) for o in raw[4:4 + width * height]):
        # MAP14 in the archive has a damaged BLOCKMAP. Rebuild conservative
        # cell lists from its actual lines; collision code checks each line.
        verts = records("VERTEXES", "hh")
        x, y = min(v[0] for v in verts) - 8, min(v[1] for v in verts) - 8
        width = (max(v[0] for v in verts) - x) // 128 + 1
        height = (max(v[1] for v in verts) - y) // 128 + 1
        cells = [[] for _ in range(width * height)]
        for index, line in enumerate(records("LINEDEFS", "7H")):
            a, b = verts[line[0]], verts[line[1]]
            for cy in range((min(a[1], b[1]) - y) // 128, (max(a[1], b[1]) - y) // 128 + 1):
                for cx in range((min(a[0], b[0]) - x) // 128, (max(a[0], b[0]) - x) // 128 + 1):
                    cells[cy * width + cx].append(index)
        raw = [x & 65535, y & 65535, width, height] + [0] * len(cells)
        for index, cell in enumerate(cells):
            raw[4 + index] = len(raw)
            raw.extend([0] + cell + [65535])
    entries = width * height
    blockmap = [x << 16, y << 16, width, height] + [0] * entries
    shared = {}
    for i, offset in enumerate(raw[4:4 + entries]):
        if offset not in shared:
            shared[offset] = len(blockmap) * 4
            pos = offset + 1  # Skip the vanilla block list's initial dummy zero.
            while raw[pos] != 65535:
                blockmap.append(raw[pos])
                pos += 1
            blockmap.append(-1)
        blockmap[4 + i] = shared[offset]
    return [things, lines, sides, vertices, segs, subsectors, sectors, nodes, lumps["REJECT"], words(*blockmap)]


def build_assets(root, output):
    from machine_assets import MachineAssets, FULL_BAY
    from campaign_maps import definitions, compile_map
    theme = MachineAssets(root / "browser/assets/gridfall")
    ids = resource_ids(root)
    layout = json.loads((root / "browser/asset-layout.json").read_text())
    textures = {name[1:]: value - ids["rT_START"] for name, value in ids.items() if ids["rT_START"] <= value < ids["rT_END"] and name not in ("rT_START",)}
    flats = {name[1:]: value - ids["rF_START"] for name, value in ids.items() if ids["rF_START"] <= value < ids["rF_END"] and name not in ("rF_START", "rT_END")}
    resources = {}
    texture_info = words(len(textures), ids["rT_START"], len(flats), ids["rF_START"])
    for name, index in textures.items():
        w, h = layout["textures"][name]
        if name in FULL_BAY: w, h = 128, 128
        pix = theme.wall(name, w, h)
        resources[index + ids["rT_START"]] = struct.pack("<HH", w, h) + pixels16(pix)
        texture_info += words(w, h, 0)
    resources[1] = texture_info
    for name, index in flats.items():
        resources[index + ids["rF_START"]] = pixels16(theme.flat(name))
    campaign = definitions()
    if [spec["id"] for spec in campaign] != list(range(1, 25)):
        raise ValueError("The campaign must contain maps 1 through 24 in order")
    for spec in campaign:
        level = spec["id"]
        map_lumps, _ = compile_map(spec)
        for index, data in enumerate(convert_map(map_lumps, textures, flats)):
            resources[ids["rMAP01"] + (level - 1) * 10 + index] = data
    files = layout["sprites"]
    for group, frames in sprite_groups().items():
        resources[ids["rSPR_" + group]] = make_sprite_group(frames, files, group.startswith("BIG"), theme)
    # Signed PCM samples are small; music is optional and streamed separately.
    sound_names = re.findall(r"\bsfx_(\w+)\s*[,=]", (root / "source/sounds.h").read_text())
    for index, name in enumerate(sound_names):
        if name not in layout["sounds"]:
            continue
        rate, frames = layout["sounds"][name]
        if name == "swtchx": frames = int(rate * 1.3)      # the end control's launch sound outlasts the old click
        pcm = theme.sound(name, rate, frames)
        resources[1000 + index] = words(rate, len(pcm)) + pcm
    directory_size = 12 + len(resources) * 12
    bundle = bytearray(directory_size)
    # Version 3 requires the extended weapon-specific player frame table.
    struct.pack_into("<4sII", bundle, 0, b"D3WB", 3, len(resources))
    for index, (resource, data) in enumerate(sorted(resources.items())):
        while len(bundle) % 4:
            bundle.append(0)
        struct.pack_into("<III", bundle, 12 + index * 12, resource, len(bundle), len(data))
        bundle.extend(data)
    (output / "doom-assets.bin").write_bytes(bundle)
    print(f"Packed {len(resources)} resources, {len(bundle):,} bytes; 24 maps.")
