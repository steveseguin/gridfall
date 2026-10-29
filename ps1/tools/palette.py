"""Build one RGB555 palette for the PS1's indexed world and sprite artwork."""
from collections import Counter


def make_palette(histogram):
    # Keep transparent zero separate from opaque black. Reserve a complete gray
    # ramp so neutral metal and shadow never acquire colored quantization noise.
    colors = [(n, n, n) for n in range(32)]
    weights = Counter()
    for pixel, count in histogram.items():
        if pixel:
            rgb = ((pixel >> 10) & 31, (pixel >> 5) & 31, pixel & 31)
            if not rgb[0] == rgb[1] == rgb[2]:
                weights[rgb] += count

    def box(entries):
        total = sum(weights[c] for c in entries)
        sums = [sum(c[a] * weights[c] for c in entries) for a in range(3)]
        errors = [sum(c[a] ** 2 * weights[c] for c in entries) - sums[a] ** 2 / total for a in range(3)]
        axis = max(range(3), key=lambda a: errors[a] * (2, 3, 1)[a])
        return (sum(e * w for e, w in zip(errors, (2, 3, 1))), axis, total, entries)

    boxes = [box(sorted(weights))] if weights else []
    while len(boxes) < 223:
        candidates = [i for i, b in enumerate(boxes) if len(b[3]) > 1]
        if not candidates:
            break
        index = max(candidates, key=lambda i: boxes[i][0])
        _, axis, total, entries = boxes.pop(index)
        entries.sort(key=lambda c: (c[axis], c))
        subtotal = 0
        for cut, color in enumerate(entries[:-1], 1):
            subtotal += weights[color]
            if subtotal * 2 >= total:
                break
        boxes.extend((box(entries[:cut]), box(entries[cut:])))
    for _, _, total, entries in boxes:
        colors.append(tuple((sum(c[a] * weights[c] for c in entries) + total // 2) // total for a in range(3)))
    colors.extend([(0, 0, 0)] * (255 - len(colors)))
    palette = [0] + [0x8000 | (r << 10) | (g << 5) | b for r, g, b in colors]
    lookup = {0: 0}
    for pixel in histogram:
        if not pixel:
            continue
        r, g, b = (pixel >> 10) & 31, (pixel >> 5) & 31, pixel & 31
        lookup[pixel] = 1 + min(range(255), key=lambda i:
            2 * (r - colors[i][0]) ** 2 + 3 * (g - colors[i][1]) ** 2 + (b - colors[i][2]) ** 2)
    return palette, lookup
