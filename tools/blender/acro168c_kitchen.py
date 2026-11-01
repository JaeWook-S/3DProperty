"""Schematic fixed kitchen fixtures for a dimension-first structural review.

All dimensions here are draft envelopes. No source-photo textures or surveyed
cabinet measurements are implied. Plan coordinates are x right, y down.
"""
import bpy


def kitchen_materials():
    colors = {
        'body': ((.075, .082, .086), .46, 0),
        'front': ((.12, .13, .135), .35, .05),
        'stone': ((.19, .175, .15), .28, 0),
        'steel': ((.48, .52, .54), .27, .8),
        'glass': ((.018, .023, .025), .16, .12),
        'recess': ((.015, .018, .02), .65, 0),
    }
    result = {}
    for key, (color, rough, metal) in colors.items():
        name = 'Draft kitchen / '+key
        material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        material.diffuse_color = (*color, 1)
        material.use_nodes = True
        bsdf = material.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*color, 1)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        result[key] = material
    return result


def add_kitchen(fixture, bounds, piece):
    a, b, c, d = bounds
    h = fixture['height_m']
    z = fixture.get('bottom_m', 0)
    m = kitchen_materials()

    def solid(name, x0, y0, x1, y1, z0, z1, material):
        return piece(name, (x1-x0, y1-y0, z1-z0),
                     ((x0+x1)/2, -(y0+y1)/2, (z0+z1)/2), m[material])

    if fixture['kind'] == 'kitchen_cabinet':
        countertop = fixture.get('countertop', False)
        toe = .10 if z == 0 else 0
        solid('carcass', a+.014, b+.014, c-.014, d-.014, z+toe, z+h-.03, 'body')
        if toe:
            solid('plinth', a+.055, b+.055, c-.055, d-.055, 0, .12, 'recess')
        if countertop:
            solid('countertop', a, b, c, d, z+h-.03, z+h, 'stone')
        else:
            solid('cap', a, b, c, d, z+h-.03, z+h, 'front')
        front = fixture['front']
        n = fixture['modules']
        rows = fixture.get('drawer_rows', 1)
        low, high = z+toe+.01, z+h-.04
        for i in range(n):
            for row in range(rows):
                zl = low+(high-low)*row/rows+.004
                zh = low+(high-low)*(row+1)/rows-.004
                if front in ['east', 'west']:
                    y0, y1 = b+(d-b)*i/n+.008, b+(d-b)*(i+1)/n-.008
                    x0, x1 = (c-.025,c) if front == 'east' else (a,a+.025)
                else:
                    x0, x1 = a+(c-a)*i/n+.008, a+(c-a)*(i+1)/n-.008
                    y0, y1 = b,b+.025
                solid(f'front-{i}-{row}', x0,y0,x1,y1,zl,zh,'front')
        if fixture.get('sink'):
            cx, cy = (a+c)/2, (b+d)/2
            solid('sink-rim',cx-.37,cy-.225,cx+.37,cy+.225,h+.001,h+.009,'steel')
            solid('sink-basin-indication',cx-.32,cy-.18,cx+.32,cy+.18,h+.01,h+.013,'recess')
            solid('tap-upright',cx-.018,cy+.23,cx+.018,cy+.265,h+.012,h+.30,'steel')
            solid('tap-spout',cx-.018,cy+.09,cx+.018,cy+.265,h+.27,h+.30,'steel')
    elif fixture['kind'] == 'kitchen_fridge':
        solid('body',a+.014,b+.02,c-.014,d-.014,.10,h,'body')
        solid('plinth',a+.045,b+.045,c-.045,d-.045,0,.12,'recess')
        mid = (a+c)/2
        fridge_width = min(1.15,(c-a)*.57)
        left,right = mid-fridge_width/2,mid+fridge_width/2
        solid('storage-left',a,b,left-.012,b+.028,.12,h-.012,'front')
        solid('storage-right',right+.012,b,c,b+.028,.12,h-.012,'front')
        solid('fridge-header',left,b,right,b+.027,h-.30,h-.012,'steel')
        solid('fridge-door-left',left,b+.002,mid-.005,b+.04,.13,h-.31,'steel')
        solid('fridge-door-right',mid+.005,b+.002,right,b+.04,.13,h-.31,'steel')
        for sign in [-1,1]:
            cx=mid+sign*.055
            solid('fridge-handle-'+str(sign),cx-.018,b-.035,cx+.018,b+.003,.83,1.59,'steel')
    elif fixture['kind'] == 'kitchen_hob_hood':
        top=fixture['cooktop_z_m']
        solid('hob',a+.035,b+.045,c-.025,d-.045,top,top+.012,'glass')
        # Burner positions are shallow markers in this structural review.
        for ix in [0,1]:
            for iy in [0,1]:
                cx=a+(c-a)*(.29+.43*ix);cy=b+(d-b)*(.27+.46*iy)
                obj=piece(f'burner-{ix}-{iy}',(.16,.16,.003),(cx,-cy,top+.014),m['steel'])
                # A shallow square marker suffices at the structural review stage.
        hb=fixture['hood_bottom_m']
        solid('hood',a,b+.03,c,d-.03,hb,hb+.10,'steel')
        solid('hood-underside',a+.02,b+.05,c-.02,d-.05,hb-.012,hb,'recess')
        solid('hood-stack',a+.01,(b+d)/2-.18,a+.30,(b+d)/2+.18,hb+.10,h,'steel')
    else:
        raise ValueError(fixture['kind'])
