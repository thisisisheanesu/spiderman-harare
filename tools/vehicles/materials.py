"""PBR materials for the vehicle models. Names are the integration contract (see public/models/vehicles/README.md).

All materials are Principled BSDF so the glTF exporter maps them 1:1 to glTF metallic-roughness.
'paint' has a WHITE base colour times a greyscale detail map (panel gaps, handles, grime): the game tints
it per instance (material.color / instanceColor multiplies the map).
"""
import bpy

from vkit import MATS, get_material

# name: (base rgb, metallic, roughness, alpha, emissive rgb)
BASE = {
    'paint': ((1.0, 1.0, 1.0), 0.2, 0.24, 1.0, None),
    'glass': ((0.045, 0.058, 0.062), 0.0, 0.04, 0.66, None),
    'chrome': ((0.86, 0.87, 0.88), 1.0, 0.14, 1.0, None),
    'trim': ((0.035, 0.035, 0.037), 0.0, 0.62, 1.0, None),
    'tyre': ((0.04, 0.04, 0.042), 0.0, 0.88, 1.0, None),
    'rim': ((0.72, 0.73, 0.75), 0.75, 0.3, 1.0, None),
    'light_front': ((1.0, 1.0, 1.0), 0.0, 0.08, 1.0, (1.0, 0.96, 0.88)),
    'light_rear': ((1.0, 1.0, 1.0), 0.0, 0.12, 1.0, (1.0, 0.08, 0.05)),
    'indicator': ((1.0, 1.0, 1.0), 0.0, 0.12, 1.0, (1.0, 0.55, 0.05)),
    'plate': ((1.0, 1.0, 1.0), 0.0, 0.45, 1.0, None),
    'interior': ((0.06, 0.06, 0.065), 0.0, 0.85, 1.0, None),
    'livery': ((1.0, 1.0, 1.0), 0.1, 0.4, 1.0, None),
    'beacon_blue': ((0.1, 0.25, 1.0), 0.0, 0.1, 1.0, (0.1, 0.3, 1.0)),
    'beacon_red': ((1.0, 0.08, 0.06), 0.0, 0.1, 1.0, (1.0, 0.1, 0.05)),
}


def _img(path, noncolor=False):
    im = bpy.data.images.load(path, check_existing=True)
    if noncolor:
        im.colorspace_settings.name = 'Non-Color'
    return im


def setup_materials(tex, *, preview_paint=None, emission=1.0):
    """tex: dict with optional keys paint, paint_normal, livery, plate, lights, tyre_normal (file paths).
    preview_paint: rgb to multiply into paint for preview renders only (export keeps white).
    emission: scale for lamp emission (export: 1.0)."""
    for name in MATS:
        base, metal, rough, alpha, emis = BASE[name]
        m = get_material(name)
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        bsdf.inputs['Base Color'].default_value = (*base, 1.0)
        bsdf.inputs['Metallic'].default_value = metal
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Alpha'].default_value = alpha
        m.use_backface_culling = name not in ('interior', 'livery')
        if alpha < 1.0:
            m.surface_render_method = 'BLENDED'
        img_key = {'paint': 'paint', 'livery': 'livery', 'plate': 'plate', 'light_front': 'lights',
                   'light_rear': 'lights', 'indicator': 'lights'}.get(name)
        tnode = None
        if img_key and tex.get(img_key):
            tnode = nt.nodes.new('ShaderNodeTexImage')
            tnode.image = _img(tex[img_key])
            if name == 'paint' and preview_paint:
                mix = nt.nodes.new('ShaderNodeMix')
                mix.data_type = 'RGBA'
                mix.blend_type = 'MULTIPLY'
                mix.inputs['Factor'].default_value = 1.0
                nt.links.new(tnode.outputs['Color'], mix.inputs['A'])
                mix.inputs['B'].default_value = (*preview_paint, 1.0)
                nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
            else:
                nt.links.new(tnode.outputs['Color'], bsdf.inputs['Base Color'])
            if name == 'livery':
                nt.links.new(tnode.outputs['Alpha'], bsdf.inputs['Alpha'])
                m.surface_render_method = 'DITHERED'
        elif name == 'paint' and preview_paint:
            bsdf.inputs['Base Color'].default_value = (*preview_paint, 1.0)
        nkey = {'paint': 'paint_normal', 'tyre': 'tyre_normal'}.get(name)
        if nkey and tex.get(nkey):
            nn = nt.nodes.new('ShaderNodeTexImage')
            nn.image = _img(tex[nkey], noncolor=True)
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nm.inputs['Strength'].default_value = 1.0
            nt.links.new(nn.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
        if emis:
            bsdf.inputs['Emission Color'].default_value = (*emis, 1.0)
            bsdf.inputs['Emission Strength'].default_value = emission
            if tnode is not None and name.startswith(('light', 'indicator')):
                # emissive map = lamp atlas (glTF: emissiveTexture * emissiveFactor); the atlas is coloured
                nt.links.new(tnode.outputs['Color'], bsdf.inputs['Emission Color'])
