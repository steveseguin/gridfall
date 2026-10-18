"""Pack GRIDFALL's PNG artwork and synthesized sound into the existing engine slots.

Resource IDs and animation tables stay unchanged. Ground sprites pivot at their feet.
The game renderer loads doom-assets.bin; the opening also uses skies.png.
"""
import math
import random
from PIL import Image, ImageDraw, ImageFont


WALLS = {
    "BIGDOOR2": 5, "BIGDOOR6": 4, "BRNPOIS": 10, "BROWNGRN": 14,
    "BROWN1": 0, "COMPSPAN": 3, "COMPTALL": 6, "CRATE1": 8,
    "CRATELIT": 8, "CRATINY": 8, "DOOR1": 4, "DOOR3": 5,
    "GRAY5": 0, "GSTSATYR": 12, "LITE5": 15, "MARBFAC3": 13,
    "METAL": 3, "METAL1": 3, "NUKE24": 10, "PIPE2": 7,
    "PLAT1": 3, "SHAWN2": 3, "SKINEDGE": 7, "SLADWALL": 14,
    "SP_DUDE4": 6, "SP_HOT1": 12, "STEP6": 3, "SUPPORT2": 3,
    "SUPPORT3": 3, "BRICK01": 1, "BRICK02": 9, "BRICK03": 14,
    "DFACE01": 6, "MARBLE01": 0, "MARBLE02": 7, "MARBLE03": 13,
    "MARBLE04": 12, "WOOD01": 14, "ASH01": 0, "CEMENT01": 0,
    "CBLUE01": 2, "TECH01": 2, "TECH02": 10, "TECH03": 6,
    "TECH04": 15, "SKIN01": 7, "SKIN02": 13, "SKIN03": 12,
    "SKULLS01": 6, "STWAR01": 11, "STWAR02": 9, "COMTAL02": 6,
}
CONTROLS = {"DOORBLU": 0, "DOORRED": 1, "DOORYEL": 2, "EXITDOOR": 3,
            "EXITSIGN": 6, "DOORSTOP": 7, "DOORTRAK": 7,
            "STWAR01": 13, "STWAR02": 12, "COMTAL02": 8, "TECH01": 9}
FLATS = {
    "FLAT14": 3, "FLAT23": 1, "FLAT5_2": 2, "FLAT5_4": 1,
    "FLOOR0_1": 2, "FLOOR0_3": 0, "FLOOR0_6": 2, "FLOOR3_3": 3,
    "FLOOR4_6": 0, "FLOOR4_8": 2, "FLOOR5_4": 1, "STEP1": 3,
    "STEP2": 0, "FLOOR6_1": 7, "FLOOR6_2": 6, "TLITE6_4": 5,
    "TLITE6_6": 4, "FLOOR7_1": 6, "FLOOR7_2": 7, "MFLR8_1": 7,
    "MFLR8_4": 6, "CEIL3_2": 4, "CEIL3_4": 5, "CEIL5_1": 5,
    "CRATOP1": 3, "CRATOP2": 3, "FLAT4": 0, "FLAT8": 1,
    "GATE3": 6, "GATE4": 7, "GRASS": 15, "ROCKS": 0,
}
# Broad surfaces need distinct colors and quiet patterns at the game's resolution.
# Keep posters and dense machinery on accent textures rather than structural walls.
# Wall art that shows one fixture (a control, sign, window, cabinet, light or crate face) is packed
# a full 128-unit bay wide, so the fixture appears once per bay instead of squeezed and repeated.
FULL_BAY = {"SW1GARG", "SW2GARG", "SW1STAR", "SW2STAR", "SW1HOT", "SW2HOT", "EXITSIGN", "BRICK01", "BRICK02",
            "BRICK03", "LITE5", "TECH01", "TECH02", "COMTAL02", "CRATE1",
            "DOOR1", "DOOR3", "DOORBLU", "DOORRED", "DOORYEL"}
SHUTTERS = {"DOOR1": (165, 171, 164), "DOORBLU": (48, 140, 214),
            "DOORRED": (202, 65, 48), "DOORYEL": (223, 177, 42)}
ARCHITECTURE_WALLS = {"STWAR01": 0, "STWAR02": 1, "BROWN1": 2,
                      "COMPSPAN": 3, "SUPPORT2": 3, "STEP6": 3}
ARCHITECTURE_FLATS = {"FLOOR4_8": 6, "FLOOR5_4": 4, "FLAT5_4": 6,
                      "FLOOR7_1": 6, "MFLR8_1": 5, "FLAT14": 4, "FLAT23": 5,
                      "TLITE6_4": 7, "TLITE6_6": 7, "CEIL5_1": 5}
ROBOTS = {"poss": "sentry", "spos": "breacher", "troo": "welder",
          "sarg": "rammer", "head": "drone", "skul": "interceptor",
          "boss": "bastion", "play": "survivor"}
# Sprite states remain in their original order, including persistent wrecks.
STATES = {
    "poss": ("ef", "g", "hijk", "t", "lmnopqrsu"),
    "spos": ("ef", "g", "hijk", "l", "mnopqrstu"),
    "troo": ("efg", "h", "ijkl", "m", "nopqrstu"),
    "sarg": ("efg", "h", "ijklm", "n", ""),
    "head": ("bcd", "ef", "ghijk", "l", ""),
    "skul": ("cd", "e", "fghij", "k", ""),
    "boss": ("efg", "h", "ijklmn", "o", ""),
    "play": ("ef", "g", "hijklm", "v", "nopqrstuw"),
}
PROPS = {"cand": 4, "cbra": 4, "colu": 4, "elec": 6, "pol1": 5,
         "pol2": 5, "pol4": 5, "col2": 6, "col4": 7, "fsku": 2,
         "tre1": 4, "smit": 7, "smt2": 7, "gor5": 5,
         "smrt": 4, "smbt": 4, "smgt": 4, "stim": 8, "medi": 9,
         "arm1": 10, "arm2": 10, "bpak": 14, "suit": 11, "pvis": 15,
         "pmap": 15, "pins": 15, "bon1": 8, "soul": 9, "bon2": 10,
         "pinv": 11, "pstr": 9, "cell": 13, "celp": 13,
         "clip": 14, "shel": 14, "rock": 14, "brok": 14, "ammo": 14, "sbox": 14}
# Full atlas cells share a fixed scale through each weapon's animation.
# Use clean poses; the engine's separate flash states supply firing effects.
# sheet, cell, width, height, left, top (on the 320x200 weapon canvas)
WEAPON_POSES = {
    "s1": ("weapons", 4, 180, 112, 70, 96),
    "s2": ("weapons", 4, 180, 112, 70, 100),
    "s3": ("weapons", 6, 180, 112, 70, 100),
    "s4": ("weapons", 7, 180, 112, 70, 100),
    "m1": ("weapons", 10, 120, 75, 100, 121),
    "m2": ("weapons", 10, 120, 75, 100, 125),
    "plas1": ("weapons", 12, 100, 63, 110, 106),
    "plas2": ("weapons", 12, 100, 63, 110, 109),
    "bfg1": ("weapons", 14, 180, 90, 70, 116),
    "bfg2": ("weapons", 14, 180, 90, 70, 119),
    "punch0": ("melee", 0, 180, 112, 80, 72),
    "punch1": ("melee", 1, 180, 112, 70, 76),
    "punch2": ("melee", 2, 180, 112, 70, 62),
    "punch3": ("melee", 3, 180, 112, 70, 76),
    # The saw fills the lower middle of the view like the other weapons; cutting uses the sparks frame.
    "chain1": ("melee", 4, 208, 130, 56, 54),
    "chain2": ("melee", 4, 208, 130, 56, 56),
    "cattack1": ("melee", 5, 208, 130, 56, 48),
    "cattack2": ("melee", 4, 208, 130, 57, 50),
}
# effect cell, width, height, muzzle x/y, poses in front of the effect
WEAPON_FLASHES = {
    "pflash": (12, 28, 26, 160, 102, ("pistol2",)),
    "sflash": (12, 38, 32, 160, 108, ("s1", "s2")),
    "sflash2": (12, 44, 36, 160, 110, ("s1", "s2")),
    "mflash": (12, 32, 26, 160, 125, ("m1", "m2")),
    "mflash2": (12, 40, 32, 160, 125, ("m1", "m2")),
    "mflash3": (12, 34, 28, 160, 125, ("m1", "m2")),
    "mflash5": (12, 24, 20, 160, 125, ("m1", "m2")),
    "plflash": (4, 30, 26, 160, 110, ("plas1", "plas2")),
    "plflash2": (4, 34, 30, 160, 110, ("plas1", "plas2")),
    "bflash": (4, 56, 40, 160, 119, ("bfg1", "bfg2")),
    "bflash2": (5, 44, 32, 160, 119, ("bfg1", "bfg2")),
}
PICKUPS = {"shot": 0, "mgun": 1, "laun": 2, "csaw": 3, "plas": 4, "bfug": 5,
           "rock": 6, "clip": 7, "shel": 8, "sbox": 8, "brok": 9, "cell": 10,
           "celp": 11, "arm2": 12, "pinv": 13, "pins": 14, "pstr": 15}
# World pixels per atlas pixel. Each machine keeps one scale through every
# frame, so it holds its proportions as it turns, fires and falls.
ROBOT_SCALES = {"poss": 0.475, "spos": 0.5, "troo": 0.48, "sarg": 0.55,
                "head": 0.54, "skul": 0.42, "boss": 0.63}
ROBOT_CANVAS = 96


class MachineAssets:
    def __init__(self, folder):
        self.folder = folder
        self.sheets = {}
        self.cells = {}
        self.player_cells = {}
        self.robot_cells = {}
        self.robot_heights = {}

    def player_cell(self, index, sheet="survivor"):
        key = (sheet, index)
        if key not in self.player_cells:
            tile = self.cell(sheet, index, 4, 2 if sheet == "survivor-aim" else 4).copy()
            stride = tile.width
            # A few atlas poses cross cell borders. Keep the connected figure,
            # excluding fragments of the neighboring row from its bounds.
            alpha = list(tile.getchannel("A").getdata())
            remaining = {i for i, a in enumerate(alpha) if a >= 96}
            figure = set()
            while remaining:
                part = {remaining.pop()}
                pending = list(part)
                while pending:
                    i = pending.pop()
                    for j in (i - stride, i + stride, i - 1 if i % stride else -1,
                              i + 1 if i % stride < stride - 1 else -1):
                        if j in remaining:
                            remaining.remove(j)
                            part.add(j)
                            pending.append(j)
                if len(part) > len(figure):
                    figure = part
            tile.putalpha(Image.frombytes("L", tile.size, bytes(255 if i in figure else 0 for i in range(len(alpha)))))
            self.player_cells[key] = tile
        return self.player_cells[key]

    @staticmethod
    def player_pose(tile, w, h, scale=None):
        bounds = tile.getbbox()
        if scale is None:
            scale = 56 / (bounds[3] - bounds[1])
        # Register on the feet, not the full silhouette: an extended gun must
        # not shift or shrink the torso when the arms rise.
        feet = tile.crop((0, bounds[3] - 12, tile.width, bounds[3])).getbbox()
        anchor = (feet[0] + feet[2]) / 2
        left = w // 2 - round((anchor - bounds[0]) * scale)
        top = h - round((bounds[3] - bounds[1]) * scale)
        body = tile.crop(bounds).resize((round((bounds[2] - bounds[0]) * scale), h - top), Image.Resampling.NEAREST)
        image = Image.new("RGBA", (w, h))
        image.alpha_composite(body, (left, top))
        return image, (left, top, bounds, scale)

    def player_sprite(self, name, w, h, variant=""):
        letter, rotation = name[4], int(name[5])
        index = rotation - 1
        standing = self.player_cell(index)
        walking = self.player_cell(8 + (ord(letter) - ord("a")) % 2) if rotation == 1 and letter in "bcd" else standing
        aimed = letter in "ef"
        separate = variant in ("pistol", "fist", "saw")
        if separate:
            attack = letter == "f" if variant == "fist" else aimed
            tile = self.player_cell(index + (8 if attack else 0), "survivor-" + variant)
        elif aimed and rotation != 5:
            tile = self.player_cell(index, "survivor-aim")
        else:
            tile = walking
        scale = None if separate or aimed else 56 / (standing.getbbox()[3] - standing.getbbox()[1])
        image, registration = self.player_pose(tile, w, h, scale)
        if separate and letter in "bcd":
            legs, _ = self.player_pose(walking, w, h, 56 / (standing.getbbox()[3] - standing.getbbox()[1]))
            image.paste(legs.crop((0, h - 24, w, h)), (0, h - 24))
        if letter == "f" and rotation < 5 and variant not in ("fist", "saw"):
            muzzle = ([(63, 45), (96, 43), (108, 44), (106, 44)] if variant == "pistol" else
                      [(60, 40), (107, 37), (110, 38), (116, 37)])[index]
            left, top, bounds, scale = registration
            x = round(left + (muzzle[0] - bounds[0]) * scale)
            y = round(top + (muzzle[1] - bounds[1]) * scale)
            flash = self.cell("effects", 4 if variant == "energy" else 12)
            flash = flash.crop(flash.getchannel("A").point(lambda a: 255 if a >= 96 else 0).getbbox())
            glow = Image.new("RGBA", (w, h))
            glow.paste(flash.resize((10, 8), Image.Resampling.NEAREST), (x - 5, y - 4))
            if rotation == 1:
                image.alpha_composite(glow)
            else:
                glow.alpha_composite(image)
                image = glow
        # The artwork turns clockwise; Doom's primary rotations 2-4 turn left.
        if rotation in (2, 3, 4):
            image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        return self.pixels(image)

    def robot_cell(self, prefix, index):
        key = (prefix, index)
        if key not in self.robot_cells:
            tile = self.cell(ROBOTS[prefix], index).copy()
            stride = tile.width
            # Neighboring atlas rows leave slivers at a cell's border. Remove
            # those; sparks and debris inside the cell belong to the pose.
            alpha = list(tile.getchannel("A").getdata())
            remaining = {i for i, a in enumerate(alpha) if a >= 96}
            parts = []
            while remaining:
                part = {remaining.pop()}
                pending = list(part)
                while pending:
                    i = pending.pop()
                    for j in (i - stride, i + stride, i - 1 if i % stride else -1,
                              i + 1 if i % stride < stride - 1 else -1):
                        if j in remaining:
                            remaining.remove(j)
                            part.add(j)
                            pending.append(j)
                parts.append(part)
            figure = max(parts, key=len)
            last = len(alpha) - stride
            stray = set()
            for part in parts:
                if part is not figure and any(i < stride or i >= last or i % stride in (0, stride - 1) for i in part):
                    stray |= part
            tile.putalpha(Image.frombytes("L", tile.size, bytes(0 if i in stray else a for i, a in enumerate(alpha))))
            self.robot_cells[key] = tile
        return self.robot_cells[key]

    def robot_pose(self, prefix, letter, tile, w, h):
        scale = ROBOT_SCALES[prefix]
        bounds = tile.getchannel("A").point(lambda a: 255 if a >= 96 else 0).getbbox()
        if not bounds:
            raise ValueError("Empty GRIDFALL robot frame: " + prefix + letter)
        body = tile.crop(bounds).resize((max(1, round((bounds[2] - bounds[0]) * scale)),
                                         max(1, round((bounds[3] - bounds[1]) * scale))), Image.Resampling.NEAREST)
        top = h - body.height
        if prefix in ("head", "skul") and letter not in STATES[prefix][3]:
            # Hovering frames share a center, level with the tallest idle view;
            # sprite_anchor places the launch height five rows above the canvas edge.
            if prefix not in self.robot_heights:
                idle = [self.robot_cell(prefix, i).getchannel("A").point(lambda a: 255 if a >= 96 else 0).getbbox()
                        for i in range(8)]
                self.robot_heights[prefix] = max(box[3] - box[1] for box in idle)
            top = h - 5 - round((self.robot_heights[prefix] + bounds[3] - bounds[1]) * scale / 2)
        image = Image.new("RGBA", (w, h))
        image.paste(body, ((w - body.width) // 2, top))
        return self.pixels(image)

    def cell(self, name, index, columns=4, rows=4):
        key = (name, index, columns, rows)
        if key not in self.cells:
            if name not in self.sheets:
                with Image.open(self.folder / (name + ".png")) as source:
                    self.sheets[name] = source.convert("RGBA")
            sheet = self.sheets[name]
            w, h = sheet.width // columns, sheet.height // rows
            x, y = (index % columns) * w, (index // columns) * h
            self.cells[key] = sheet.crop((x, y, x + w, y + h))
            if name.startswith("survivor") and (w, h) != (128, 128):
                # Preserve the actor and muzzle registration when source art is larger.
                self.cells[key] = self.cells[key].resize((128, 128), Image.Resampling.NEAREST)
        return self.cells[key]

    @staticmethod
    def pixels(image, column_major=False):
        data = [0 if a < 96 else 0x8000 | ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)
                for r, g, b, a in image.getdata()]
        if column_major:
            return [data[y * image.width + x] for x in range(image.width) for y in range(image.height)]
        return data

    def depot_tile(self, index):
        # Atlas boundaries follow the carriage side, cab, track and ticket booth.
        bounds = ((0,0,768,627), (770,0,1228,627), (0,627,627,1254), (627,627,1254,1254))
        return self.cell("depot", 0, 1, 1).crop(bounds[index])

    def exit_control(self, pressed):
        """The end-of-level control: one big button in a hazard frame, the same on every map."""
        size = 128
        image = Image.new("RGBA", (size, size), (52, 57, 66, 255))
        draw = ImageDraw.Draw(image)
        for y in range(size):
            for x in range(size):
                if min(x, y, size - 1 - x, size - 1 - y) < 10:
                    image.putpixel((x, y), (236, 190, 40, 255) if ((x + y) // 10) % 2 == 0 else (24, 24, 26, 255))
        draw.rectangle((10, 10, size - 11, size - 11), outline=(12, 12, 14, 255), width=2)
        draw.rectangle((24, 16, 103, 41), fill=(10, 12, 14, 255), outline=(120, 126, 134, 255))
        label = Image.new("L", (48, 16), 0)
        ImageDraw.Draw(label).text((1, 1), "GO" if pressed else "EXIT", fill=255, font=ImageFont.load_default())
        box = label.getbbox()
        label = label.crop(box).point(lambda value: 255 if value >= 96 else 0)
        label = label.resize((label.width * 2, label.height * 2), Image.Resampling.NEAREST)
        color = (90, 255, 140, 255) if pressed else (255, 214, 64, 255)
        image.paste(Image.new("RGBA", label.size, color), ((size - label.width) // 2, 29 - label.height // 2), label)
        cx, cy = 64, 80
        draw.ellipse((cx - 36, cy - 36, cx + 36, cy + 36), fill=(14, 15, 18, 255))
        draw.ellipse((cx - 33, cy - 33, cx + 33, cy + 33), fill=(140, 146, 156, 255))
        draw.ellipse((cx - 30, cy - 30, cx + 30, cy + 30), fill=(70, 74, 82, 255))
        radius = 24 if pressed else 27
        lit, dark = ((120, 255, 150), (8, 110, 40)) if pressed else ((255, 96, 70), (120, 8, 8))
        for y in range(cy - radius, cy + radius + 1):
            for x in range(cx - radius, cx + radius + 1):
                if math.hypot(x - cx, y - cy) <= radius:
                    shade = min(1, math.hypot(x - (cx - 8), y - (cy - 9)) / (radius * 1.25))
                    image.putpixel((x, y), tuple(round(lit[i] + (dark[i] - lit[i]) * shade) for i in range(3)) + (255,))
        draw.ellipse((cx - 13, cy - 16, cx - 5, cy - 10), fill=(225, 255, 235, 255) if pressed else (255, 235, 225, 255))
        for bx, by in ((18, 50), (109, 50), (18, 112), (109, 112)):
            draw.ellipse((bx - 3, by - 3, bx + 3, by + 3), fill=(150, 156, 166, 255), outline=(20, 20, 22, 255))
        return image

    def exit_pad(self):
        """Hazard bands for the floor in front of the end control."""
        rng = random.Random(7)
        image = Image.new("RGBA", (64, 64))
        for y in range(64):
            for x in range(64):
                base = (232, 186, 36) if ((x + y) // 16) % 2 == 0 else (26, 26, 28)
                wear = rng.randint(-10, 10)
                image.putpixel((x, y), tuple(max(0, min(255, c + wear)) for c in base) + (255,))
        return image

    def brick_wall(self):
        """Plain running-bond brick for long runs of wall, colored from the poster wall's own bricks."""
        source = self.cell("world", 1).convert("RGB")
        samples = sorted((source.getpixel((x, y)) for x in range(4, 36, 3) for y in range(70, 124, 3)), key=sum)
        mortar, brick = samples[len(samples) // 12], samples[len(samples) * 2 // 3]
        rng = random.Random(1403)
        image = Image.new("RGBA", (128, 128), mortar + (255,))
        for row in range(8):
            for col in range(-1, 4):
                x0, y0 = col * 32 + (16 if row % 2 else 0), row * 16
                tone = rng.uniform(.82, 1.12) * (.72 if rng.random() < .08 else 1)
                for y in range(y0 + 1, y0 + 15):
                    for x in range(x0 + 1, x0 + 31):
                        edge = 1.1 if y == y0 + 1 else .82 if y == y0 + 14 or x == x0 + 30 else 1
                        grain = rng.uniform(.94, 1.06)
                        image.putpixel((x % 128, y), tuple(max(0, min(255, round(c * tone * edge * grain))) for c in brick) + (255,))
        return image

    def shutter(self, color):
        """One rising slatted panel; no hinged leaves or frame painted on the moving face."""
        image = Image.new("RGBA", (128, 128))
        rng = random.Random(1304)
        for y in range(128):
            slat = y % 12
            light = (36, 126, 108, 92, 88, 85, 82, 80, 76, 68, 51, 28)[slat]
            for x in range(128):
                wear = rng.randint(-5, 5)
                image.putpixel((x, y), (light + wear, light + wear + 5, light + wear + 7, 255))
        draw = ImageDraw.Draw(image)
        # A broad keyed band remains legible from the far end of a corridor.
        draw.rectangle((0, 57, 127, 83), fill=color + (255,))
        for y in (60, 72, 83):
            draw.line((0, y, 127, y), fill=tuple(c // 2 for c in color) + (255,))
        # Upward chevrons make the motion readable before the first press.
        for x in (24, 88):
            draw.polygon(((x, 75), (x, 69), (x + 8, 63), (x + 16, 69),
                          (x + 16, 75), (x + 8, 69)), fill=(228, 230, 217, 255))
        draw.rectangle((0, 119, 127, 127), fill=(28, 32, 34, 255))
        draw.line((0, 119, 127, 119), fill=(160, 167, 164, 255), width=2)
        for x in range(8, 128, 24):
            draw.rectangle((x, 122, x + 2, 124), fill=(102, 109, 110, 255))
        return image

    def wall(self, name, w, h):
        if name in ("SW1GARG", "SW2GARG"):
            tile = self.exit_control(name[2] == "2")
        elif name == "BRICK03":
            tile = self.brick_wall()
        elif name in SHUTTERS:
            tile = self.shutter(SHUTTERS[name])
        elif name in ("DFACE01", "MARBFAC3", "PLAT1"):
            tile = self.depot_tile({"DFACE01": 0, "MARBFAC3": 1, "PLAT1": 3}[name])
        elif name == "BIGDOOR2":
            # One station sign across a full 128-unit wall bay.
            tile = self.cell("controls", 9)
        elif name in ARCHITECTURE_WALLS:
            tile = self.cell("architecture", ARCHITECTURE_WALLS[name], 4, 2)
        elif name.startswith("SKY"):
            tile = self.cell("skies", int(name[-1]) - 1, 1, 3)
        elif name.startswith("SW"):
            tile = self.cell("controls", 4 if name[2] == "1" else 5)
        elif name in CONTROLS:
            tile = self.cell("controls", CONTROLS[name])
        else:
            tile = self.cell("world", WALLS[name])
        return self.surface(tile, w, h, True)

    def surface(self, tile, w, h, column_major=False):
        # Area-filter opaque surfaces before quantization; append smaller levels
        # for distant sampling. Sprite alpha and registration are unaffected.
        result = []
        while True:
            result.extend(self.pixels(tile.resize((w, h), Image.Resampling.BOX), column_major))
            if w == h == 1:
                return result
            w, h = max(1, w // 2), max(1, h // 2)

    def flat(self, name):
        if name == "GATE3":
            return self.surface(self.exit_pad(), 64, 64)
        if name == "FLAT5_2":
            return self.surface(self.depot_tile(2), 64, 64)
        if name in ARCHITECTURE_FLATS:
            tile = self.cell("architecture", ARCHITECTURE_FLATS[name], 4, 2)
            return self.surface(tile, 64, 64)
        if name.startswith("NUKAGE"):
            index = 8 + int(name[-1]) - 1
        elif name.startswith("LAVA"):
            index = 12 + (int(name[-1]) - 1) % 2
        elif name.startswith("FWATER"):
            index = 14
        else:
            index = FLATS[name]
        return self.surface(self.cell("floors", index), 64, 64)

    def weapon_pose(self, name, w, h):
        image = Image.new("RGBA", (w, h))
        if name.startswith("pistol"):
            tile = self.cell("pistol", int(name[-1]) - 1, 3, 1)
            image.paste(tile.resize((120, 114), Image.Resampling.NEAREST), (w // 2 - 60, 76))
        else:
            sheet, index, width, height, x, y = WEAPON_POSES[name]
            tile = self.cell(sheet, index, 4, 2 if sheet == "melee" else 4)
            image.paste(tile.resize((width, height), Image.Resampling.NEAREST), (x, y))
        return image

    def sprite_anchor(self, name, w, h, pixels):
        visible = [i for i, value in enumerate(pixels) if value]
        if not visible:
            return w//2, h-5
        prefix, letter = name[:4], name[4]
        bottom = max(i // w for i in visible)
        if prefix == "play" and letter in "abcdefg":
            # player_pose already registers the feet across weapon variants.
            return w//2, h
        if prefix == "gor5":
            # Both hanging camera objects have a 52-unit collision height.
            top = min(i // w for i in visible)
            mount = [i % w for i in visible if i // w <= top+2]
            return (min(mount)+max(mount))//2, top+52
        grounded = (prefix in PROPS or prefix in PICKUPS or
                    prefix in ("bar1", "fcan", "pol5", "bkey", "rkey", "ykey", "bsku", "rsku", "ysku") or
                    prefix == "bexp" and letter in "ae" or
                    prefix in ROBOTS and (prefix not in ("head", "skul") or letter in STATES[prefix][3]))
        if grounded:
            # Register the actual support, not the full silhouette. Bent poles,
            # trailing cables and muzzle flashes must not move the contact point.
            foot = [i % w for i in visible if i // w >= bottom-2]
            return (min(foot)+max(foot))//2, bottom+1
        # Airborne sprites and effects retain their launch/animation height.
        # Their padding is unrelated to the center of the replacement artwork.
        return (min(i % w for i in visible)+max(i % w for i in visible))//2, h-5

    def sprite(self, name, w, h, layout_bounds, weapon):
        if name.startswith("play") and name[4] in "abcdefg":
            return self.player_sprite(name, w, h)
        if name in WEAPON_POSES or name in ("pistol1", "pistol2", "pistol3"):
            return self.pixels(self.weapon_pose(name, w, h))
        if name in WEAPON_FLASHES:
            index, fw, fh, x, y, poses = WEAPON_FLASHES[name]
            flash = self.cell("effects", index)
            bounds = flash.getchannel("A").point(lambda a: 255 if a >= 96 else 0).getbbox()
            image = Image.new("RGBA", (w, h))
            image.paste(flash.crop(bounds).resize((fw, fh), Image.Resampling.NEAREST), (x - fw // 2, y - fh // 2))
            mask = Image.new("RGBA", (w, h))
            for pose in poses:
                mask.alpha_composite(self.weapon_pose(pose, w, h))
            return [0 if body else glow for body, glow in zip(self.pixels(mask), self.pixels(image))]
        if name in ("cg1", "cg2", "cflash", "cflash2"):
            # Use the clean gun for both poses: the other atlas cell already
            # contains a flash and its bounds rescale the barrel between shots.
            tile = self.cell("weapons", 8)
            bounds = tile.getchannel("A").point(lambda a: 255 if a >= 96 else 0).getbbox()
            tile = tile.crop(bounds).resize((114, 83), Image.Resampling.NEAREST)
            recoil = 2 if name in ("cg2", "cflash") else 0
            gun = Image.new("RGBA", (w, h))
            # Register the muzzle at (160, 117), with straight-back recoil.
            gun.paste(tile, (w // 2 - 52, 117 + recoil))
            if name.startswith("cg"):
                return self.pixels(gun)
            # Flash 2 accompanies cg1; flash 1 accompanies cg2 in A_FireCGun.
            flash = self.cell("effects", 12)
            bounds = flash.getchannel("A").point(lambda a: 255 if a >= 96 else 0).getbbox()
            fw, fh = (38, 34) if recoil else (42, 38)
            image = Image.new("RGBA", (w, h))
            image.paste(flash.crop(bounds).resize((fw, fh), Image.Resampling.NEAREST),
                        (w // 2 - fw // 2, 117 + recoil - fh // 2))
            # The renderer draws flashes last. Pre-mask both poses so the gun
            # stays in front, including the final flash as recoil recovers.
            gun.alpha_composite(tile, (w // 2 - 52, 119 - recoil))
            return [0 if body else glow for body, glow in zip(self.pixels(gun), self.pixels(image))]
        prefix, letter = name[:4], name[4:5]
        frame = max(0, ord(letter) - ord("a")) if letter and letter.isalpha() else 0
        if weapon:
            raise ValueError("No GRIDFALL weapon replacement: " + name)
        if prefix in ROBOTS:
            attack, pain, dying, dead, gib = STATES[prefix]
            rotation = int(name[5]) if len(name) > 5 and name[5].isdigit() else 0
            index = max(0, rotation - 1)
            if letter in attack:
                index = 10
            elif letter in pain:
                index = 11
            elif letter in dying:
                index = 12 + min(1, dying.index(letter) * 2 // len(dying))
            elif letter in dead:
                index = 14
            elif letter in gib:
                index = 12 + min(3, gib.index(letter) * 4 // len(gib))
            elif rotation in (0, 1) and letter in "bcd":
                index = 8 + frame % 2
            elif prefix == "poss" and rotation in (2, 3, 4):
                # The sentry sheet turns the other way; cells 5-7 face left.
                index = 9 - rotation
            if prefix in ROBOT_SCALES:
                return self.robot_pose(prefix, letter, self.robot_cell(prefix, index), w, h)
            tile = self.player_cell(index) if prefix == "play" else self.cell(ROBOTS[prefix], index)
        elif prefix == "bar1":
            tile = self.cell("props", frame % 2)
        elif prefix == "bexp":
            tile = self.cell("props", 2 if frame == 0 else 3) if frame in (0, 4) else self.cell("effects", 8 + frame - 1)
        elif prefix == "fcan":
            tile = self.cell("props", 2 + (frame == 2))
        elif prefix in ("bkey", "rkey", "ykey", "bsku", "rsku", "ysku"):
            combined = self.cell("props", 12)
            part = {"b": 0, "r": 1, "y": 2}[prefix[0]]
            tile = combined.crop((part * combined.width // 3, 0, (part + 1) * combined.width // 3, combined.height))
        elif prefix in PICKUPS:
            tile = self.cell("pickups", PICKUPS[prefix])
        elif prefix in PROPS:
            tile = self.cell("props", PROPS[prefix])
            if prefix == "soul":
                # The full restoration case shares the medical kit's artwork.
                # A blue shell and a slow pulse keep the two apart at a glance.
                pulse = (1.0, 1.15, 1.3, 1.15)[frame % 4]
                hue, saturation, value = tile.convert("RGB").convert("HSV").split()
                hue = hue.point(lambda h: (h + 96) % 256)
                bands = Image.merge("HSV", (hue, saturation, value)).convert("RGB").split()
                tint = [band.point(lambda c, gain=gain: min(255, int(c * gain * pulse)))
                        for band, gain in zip(bands, (0.62, 0.86, 1.2))]
                tile = Image.merge("RGBA", (*tint, tile.getchannel("A")))
        elif prefix in ("bal1", "bal2", "bal7", "plss", "bfs1"):
            tile = self.cell("effects", (2 if prefix == "bal7" else 0) + frame % 2 if frame < 2 else 4 + min(3, frame - 2))
        elif prefix in ("bfe1", "bfe2", "plse", "tfog", "ifog"):
            tile = self.cell("effects", 4 + min(3, frame // 2 if prefix in ("tfog", "ifog") else frame))
        elif prefix == "misl":
            tile = self.cell("pickups", 6) if frame == 0 else self.cell("effects", 8 + min(3, frame - 1))
        elif prefix in ("blud", "pol5"):
            tile = self.cell("effects", 14)
        elif prefix == "puff":
            tile = self.cell("effects", 13 if frame < 2 else 15)
        else:
            raise ValueError("No GRIDFALL sprite replacement: " + name)
        # Keep replacement artwork registered to the engine frame layout.
        if layout_bounds is None:
            return [0] * (w * h)
        x0, y0, x1, y1 = layout_bounds
        bounds = tile.getchannel("A").point(lambda a: 255 if a >= 96 else 0).getbbox()
        if not bounds:
            raise ValueError("Empty GRIDFALL sprite: " + name)
        tile = tile.crop(bounds).resize((x1 - x0, y1 - y0), Image.Resampling.NEAREST)
        image = Image.new("RGBA", (w, h))
        image.paste(tile, (x0, y0))
        return self.pixels(image)

    @staticmethod
    def voice(name, rate, frames, variation):
        """Breathy voiced effort, pain and death grunts; generated at build time."""
        rng = random.Random(1709 + variation * 37 + sum(map(ord, name)))
        duration = min(frames / rate, 0.85 if name == "pldeth" else 0.34)
        pitch = (125 if name == "pldeth" else 145) + variation * 13
        # Harmonics shaped by vowel formants, rather than the machine alert oscillator.
        formants = (530 + variation * 45, 1190 + variation * 90, 2450)
        harmonics = []
        for harmonic in range(1, min(40, int(rate / 2 / (pitch * 1.2)))):
            frequency = harmonic * pitch
            weight = sum(strength * math.exp(-0.5 * ((frequency - center) / width) ** 2)
                         for center, width, strength in zip(formants, (120, 170, 240), (1, 0.6, 0.2)))
            harmonics.append((harmonic, (0.12 + weight) / harmonic ** 0.7))
        samples, phase, breath = [], 0.0, 0.0
        for i in range(frames):
            t = i / rate
            u = min(1, t / duration)
            phase += 2 * math.pi * pitch * (1.10 - 0.32 * u + 0.012 * math.sin(t * 71)) / rate
            noise = rng.uniform(-1, 1)
            breath += (noise - breath) * 0.24
            voiced = sum(weight * math.sin(phase * harmonic) for harmonic, weight in harmonics)
            envelope = min(1, t / 0.018) * (1 - u) ** 1.1
            samples.append((voiced * (1 - 0.55 * u) + breath * (0.3 + u)) * envelope)
        scale = 110 / max(0.01, max(abs(value) for value in samples))
        return bytearray(int(value * scale) & 255 for value in samples)

    @staticmethod
    def sound(name, rate, frames):
        """Layered original effects, baked into the existing mono PCM resources."""
        if name in ("plpain", "oof", "pldeth", "noway"):
            return b"".join(MachineAssets.voice(name, rate, frames, take) for take in range(3))
        seed = sum((i + 1) * ord(c) for i, c in enumerate(name))
        rng = random.Random(seed)
        duration = frames / rate
        samples, low, body, phase = [], 0.0, 0.0, 0.0
        gun = name in ("pistol", "shotgn", "rlaunc")
        explosion = name in ("barexp", "rxplod", "firxpl", "slop")
        death = "dth" in name
        # Resonant metal modes separate small patrol units from heavy machinery.
        heavy = name.startswith(("brs", "cyb", "spi", "dm", "sgt"))
        motor = 64 + seed % 39 if heavy else 210 + seed % 170
        for i in range(frames):
            t = i / rate
            u = i / max(1, frames - 1)
            noise = rng.uniform(-1, 1)
            low += (noise - low) * (1 - math.exp(-2 * math.pi * 220 / rate))
            body += (noise - body) * (1 - math.exp(-2 * math.pi * 1800 / rate))
            high = noise - body
            if gun:
                shotgun = name == "shotgn"
                rocket = name == "rlaunc"
                crack = high * (0.7 if not rocket else 0.22) * math.exp(-t * (170 if not shotgun else 85))
                blast = body * (1.9 if shotgun else 1.1) * math.exp(-t * (16 if shotgun else 35))
                thump = math.sin(2 * math.pi * (72 * t + .6 * (1 - math.exp(-t * 45)))) * math.exp(-t * 38) * .6
                bolt_time = t - (.095 if shotgun else .055)
                bolt = 0 if bolt_time < 0 else (body * .32 + math.sin(2 * math.pi * 1700 * bolt_time) * .07) * math.exp(-bolt_time * 100)
                v = crack + blast + thump + bolt
                if rocket:
                    v += (low * 1.2 + body * .5) * min(1, t * 80) * math.exp(-t * 7)
            elif explosion:
                bloom = min(1, t * 110)
                rumble = low * 2.5 + .35 * math.sin(2 * math.pi * (42 * t + .7 * (1 - math.exp(-t * 9))))
                v = high * .65 * math.exp(-t * 90) + rumble * bloom * math.exp(-t * 3.8)
                v += body * .8 * math.exp(-t * 8)
                # Delayed fragments ringing against the ground, rather than a constant hiss.
                for delay, ring in ((.13, 740), (.26, 1110), (.41, 460)):
                    d = t - delay
                    if d >= 0:
                        v += (.13 * math.sin(2 * math.pi * ring * d) + high * .18) * math.exp(-d * 32)
            elif death:
                phase += 2 * math.pi * max(25, motor * (1 - .85 * u)) / rate
                impact = (body * 1.3 + low * .8) * math.exp(-t * 18)
                collapse = (math.sin(phase) * .18 + math.sin(phase * 2.71) * .1) * (1 - u) ** 2
                v = impact + collapse + high * .2 * math.exp(-t * 5) * max(0, math.sin(t * 57)) ** 8
            elif name in ("plasma", "bfg", "firsht", "firbal", "telept"):
                charge = name == "bfg"
                frequency = 90 + 1100 * u * u if charge else 140 + 1650 * math.exp(-t * 25)
                phase += 2 * math.pi * frequency / rate
                electrical = math.sin(phase + math.sin(phase * 2.03) * (1.6 if charge else .8))
                v = electrical * .42 * (math.sin(math.pi * u) if charge else math.exp(-t * 11))
                v += high * .35 * math.exp(-t * 95) + low * .8 * math.exp(-t * 18)
                if name == "telept":
                    v = (electrical * .3 + body * .6) * math.sin(math.pi * u) ** 2
            elif name in ("itemup", "wpnup", "itmbk", "swtchn", "swtchx"):
                if name == "swtchx":
                    # The end control: a heavy clunk, a rising charge, then a bright two-note confirmation.
                    v = (body * .9 + low * 1.5 + math.sin(2 * math.pi * 92 * t) * .5) * math.exp(-t * 24)
                    rise = min(1, max(0, (t - .04) / .8))
                    phase += 2 * math.pi * (110 + 770 * rise * rise) / rate
                    v += (math.sin(phase) * .3 + math.sin(phase * 2.01) * .12) * math.sin(math.pi * rise) ** .7 * (t < .86)
                    for start, note in ((.84, 1320), (.96, 1760)):
                        d = t - start
                        if d >= 0:
                            v += (math.sin(2 * math.pi * note * d) + .25 * math.sin(2 * math.pi * note * 2 * d)) * .34 * math.exp(-d * 9)
                elif name.startswith("swtch"):
                    v = (body * .6 + math.sin(2 * math.pi * 340 * t) * .3) * math.exp(-t * 75)
                    v += math.sin(2 * math.pi * (980 if name == "swtchn" else 620) * t) * .15 * math.exp(-t * 28)
                else:
                    base = 520 if name == "wpnup" else 880
                    v = math.sin(2 * math.pi * base * t) * .26 * math.exp(-t * 24)
                    d = t - .055
                    if d > 0:
                        v += (math.sin(2 * math.pi * base * 1.5 * d) + .18 * math.sin(2 * math.pi * base * 3 * d)) * .24 * math.exp(-d * 18)
            elif name.startswith("saw") or name in ("doropn", "dorcls", "stnmov", "pstart", "pstop", "rfly"):
                saw = name.startswith("saw")
                rev = 1 + .09 * math.sin(t * 23) if saw else .6 + .4 * math.sin(math.pi * u)
                phase += 2 * math.pi * (105 if saw else 58) * rev / rate
                gears = math.sin(phase) * .22 + math.sin(phase * 3) * .09 + math.sin(phase * 7) * .04
                hiss = (.1 if name == "sawidl" else .2) if saw else .18
                v = (gears + body * hiss + low * (.3 if saw else .65)) * math.sin(math.pi * u) ** .3
                if not saw:
                    v += (body * .55 + math.sin(t * 2 * math.pi * 180) * .3) * math.exp(-t * 65)
                if name in ("dorcls", "pstop"):
                    d = t - min(.18, duration * .65)
                    if d >= 0:
                        v += (body * .7 + low * 1.2) * math.exp(-d * 35)
            elif name in ("punch", "hoof", "metal", "sgcock", "claw", "sgtatk"):
                metal = name in ("metal", "sgcock", "claw")
                v = (low * 1.8 + .45 * math.sin(2 * math.pi * 105 * t)) * math.exp(-t * 42)
                v += high * .35 * math.exp(-t * 100)
                if metal:
                    v += (math.sin(t * 2 * math.pi * 950) * .15 + math.sin(t * 2 * math.pi * 2370) * .07) * math.exp(-t * 38)
            else:
                # Each robot family has its own motor weight and patterned radio/servo call.
                pain = "pain" in name
                phase += 2 * math.pi * motor * (1 + .18 * math.sin(t * 11) + (.7 * (1 - u) if pain else 0)) / rate
                gate = max(0, math.sin(2 * math.pi * (5 + seed % 4) * t)) ** 2
                v = (math.sin(phase + .8 * math.sin(phase * 1.97)) * .3 + body * .28) * (.18 + .82 * gate) * (1 - u) ** 1.5
                if heavy:
                    v += low * .9 * math.sin(math.pi * u)
                if pain:
                    v += high * .25 * math.exp(-t * 50)
            # No live filters or reverb: short room reflections are baked into weapon shots.
            if gun:
                for delay, gain in ((.037, .16), (.071, .08)):
                    back = i - int(delay * rate)
                    if back >= 0:
                        v += samples[back] * gain
            envelope = min(1, t * 900) * min(1, (frames - 1 - i) / max(1, rate * .009))
            samples.append(v * max(0, envelope))
        # Retain headroom without flattening the attack through hard clipping.
        peak = max(.001, max(abs(v) for v in samples))
        # Every sound is brought to the same peak; a motor that never stops has to sit well below that.
        scale = min(112 / peak, 115) * {"sawidl": .3, "sawup": .55, "sawful": .65, "sawhit": .75}.get(name, 1)
        return bytearray(int(v * scale) & 255 for v in samples)
