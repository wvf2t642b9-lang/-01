"""Render a person's timeline from the original artwork in the source ZIP."""

from io import BytesIO
import json
from pathlib import PurePosixPath

from PIL import Image

SCENE_SIZE = (384, 256)

# The published source bundles predate the timeline-scenes.json convention.
LEGACY_FOCUS = {
    22: (.48, .36, .46, .40, .56, .51, .54, .64, .35, .63),
    23: (.50, .56, .54, .56, .65, .53, .62, .48, .60, .50),
    24: (.50, .58, .53, .58, .51, .56, .46, .50, .54, .62),
    25: (.54, .59, .59, .58, .61, .47, .56, .45, .56, .60),
    31: (.52, .63, .43, .53, .43, .48, .28, .54, .46, .56),
}
DEFAULT_LATE_FOCUS = (.54, .56, .54, .52, .55, .55, .50, .52, .50, .53)


def read_layout(archive, slug):
    if 'timeline-scenes.json' in archive.namelist():
        layout = json.loads(archive.read('timeline-scenes.json'))
        if layout.get('id', '').lower() != slug:
            raise ValueError(f'Timeline manifest does not match {slug}')
        return layout

    number = int(slug.split('-')[1])
    if not 1 <= number <= 31:
        raise ValueError(f'{slug}: source ZIP requires timeline-scenes.json')

    sheets = [name for name in archive.namelist()
              if PurePosixPath(name).name == 'scenes.png']
    if number in (13, 14):
        prefix = {13: 'jian/', 14: 'ce/'}[number]
        sheets = [name for name in sheets if name.startswith(prefix)]
    if len(sheets) != 1:
        raise ValueError(f'{slug}: expected exactly one original scene sheet')

    columns, rows = (4, 4) if number <= 7 else (4, 3) if number <= 9 else (5, 2)
    layout = {'sheet': sheets[0], 'columns': columns, 'rows': rows, 'events': {}}
    if number == 17:
        individual = PurePosixPath(sheets[0]).with_name('scene8.png')
        layout['events']['8'] = {'image': str(individual)}

    focuses = LEGACY_FOCUS.get(number, DEFAULT_LATE_FOCUS if 26 <= number <= 30 else ())
    order = (1, 2, 3, 4, 5, 6, 9, 7, 8, 10) if number == 26 else range(1, len(focuses) + 1)
    for n, cell in enumerate(order, 1):
        layout['events'][str(n)] = {'cell': cell, 'focus': focuses[cell - 1]}
    return layout


def open_art(archive, member):
    with Image.open(BytesIO(archive.read(member))) as image:
        return image.convert('RGB')


def frame(image, focus, *, require_native_size=False):
    if not isinstance(focus, (float, int)) or not 0 <= focus <= 1:
        raise ValueError('Vertical focus must be a number between 0 and 1')
    width, height = image.size
    ratio = SCENE_SIZE[0] / SCENE_SIZE[1]
    if width / height > ratio:
        crop_width = round(height * ratio)
        left = (width - crop_width) // 2
        image = image.crop((left, 0, left + crop_width, height))
    elif width / height < ratio:
        crop_height = round(width / ratio)
        top = max(0, min(height - crop_height, round(height * focus - crop_height / 2)))
        image = image.crop((0, top, width, top + crop_height))
    if require_native_size and (image.width < SCENE_SIZE[0] or image.height < SCENE_SIZE[1]):
        raise ValueError('Original artwork is too small for a 384×256 frame')
    return image.resize(SCENE_SIZE, Image.Resampling.LANCZOS)


def render_scenes(archive, slug, event_numbers):
    layout = read_layout(archive, slug)
    require_native_size = 'id' in layout
    sheet_member = layout.get('sheet')
    sheet = open_art(archive, sheet_member) if sheet_member else None
    columns, rows = layout.get('columns'), layout.get('rows')
    encoded = {}
    for n in event_numbers:
        event = layout.get('events', {}).get(str(n), {})
        if event.get('image'):
            art = open_art(archive, event['image'])
        else:
            if sheet is None or not all(isinstance(v, int) and v > 0 for v in (columns, rows)):
                raise ValueError(f'{slug} event {n}: supply an image or a valid source sheet')
            cell = event.get('cell', n)
            if not isinstance(cell, int) or not 1 <= cell <= columns * rows:
                raise ValueError(f'{slug} event {n}: invalid scene cell {cell}')
            row, column = divmod(cell - 1, columns)
            padding = 0 if require_native_size or slug == 'sg-004' else 2
            art = sheet.crop((
                round(column * sheet.width / columns) + padding,
                round(row * sheet.height / rows) + padding,
                round((column + 1) * sheet.width / columns) - padding,
                round((row + 1) * sheet.height / rows) - padding,
            ))
        with BytesIO() as output:
            scene = frame(art, event.get('focus', .5), require_native_size=require_native_size)
            scene.save(output, 'WEBP', quality=89, method=5)
            encoded[n] = output.getvalue()
    if len(encoded) != len(event_numbers) or len(set(encoded.values())) != len(encoded):
        raise ValueError(f'{slug}: repeated event keys or illustrations')
    return encoded
