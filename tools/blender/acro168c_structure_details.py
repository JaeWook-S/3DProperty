"""Plan-traced exclusions and simple fixed fixtures; no screenshot textures."""
import math
import bpy

def add_details(layout, mx, my, height, box, collections, shaft_mat, storage_mat, ceramic_mat, metal_mat, text_mat):
    records={'excluded_zones':[], 'fixtures':[]}
    for zone in layout.get('excluded_zones', []):
        x0,y0,x1,y1=zone['bounds_px'];a,b,c,d=mx(x0),my(y0),mx(x1),my(y1)
        # Inset fill avoids coplanar surfaces at surrounding wall junctions.
        obj=box(zone['id']+'/blocked-volume',(c-a-.08,d-b-.08,height-.01),((a+c)/2,-(b+d)/2,(height-.01)/2),shaft_mat,'06_Excluded',component='excluded_volume',zone_id=zone['id'],occupiable=False,furniture_placeable=False,collision=True,function_status='unresolved_service_or_structure')
        records['excluded_zones'].append({**zone,'reference_bounds_m':[a,b,c,d],'mesh_name':obj.name,'occupiable':False,'furniture_placeable':False})
        dx,dy=(c-a-.16)/2,(d-b-.16)/2
        length=2*math.hypot(dx,dy)
        for sign in [-1,1]:
            mark=box(zone['id']+'/X'+str(sign),(length,.03,.008),((a+c)/2,-(b+d)/2,height+.003),ceramic_mat,'90_Review_labels',component='annotation')
            mark.rotation_euler.z=sign*math.atan2(dy,dx)
    for fixture in layout.get('fixtures', []):
        if 'bounds_m' in fixture:
            a,b,c,d=fixture['bounds_m']
        else:
            x0,y0,x1,y1=fixture['bounds_px'];a,b,c,d=mx(x0),my(y0),mx(x1),my(y1)
        names=[]
        def piece(suffix,dims,loc,material,component='fixed_storage'):
            obj=box(fixture['id']+'/'+suffix,dims,loc,material,'07_Fixtures',component=component,fixture_id=fixture['id'],dimension_status='unmeasured_placeholder',collision=True,furniture_placeable=False)
            names.append(obj.name)
            return obj
        h=fixture['height_m']
        if fixture['kind'].startswith('kitchen_'):
            from acro168c_kitchen import add_kitchen
            add_kitchen(fixture,[a,b,c,d],piece)
        elif fixture['kind']=='shelving':
            piece('left-side',(.025,d-b,h),(a+.0125,-(b+d)/2,h/2),storage_mat)
            piece('right-side',(.025,d-b,h),(c-.0125,-(b+d)/2,h/2),storage_mat)
            piece('back',(c-a,.02,h),((a+c)/2,-b-.01,h/2),storage_mat)
            for i in range(fixture['levels']):
                z=.09+(h-.13)*i/(fixture['levels']-1)
                piece('shelf-'+str(i),(c-a,d-b,.025),((a+c)/2,-(b+d)/2,z),storage_mat)
        elif fixture['kind']=='shower_tray':
            piece('base',(c-a,d-b,h),((a+c)/2,-(b+d)/2,h/2),ceramic_mat,'shower_fixture')
            piece('drain',(.09,.09,.006),((a+c)/2,-(b+d)/2,h+.003),metal_mat,'shower_fixture')
        elif fixture['kind']=='shower_rail':
            z=fixture['bottom_m']
            piece('rail',(.025,.025,h),((a+c)/2,-(b+d)/2,z+h/2),metal_mat,'shower_fixture')
            piece('head',(.16,.12,.03),((a+c)/2+.08,-(b+d)/2,z+h),metal_mat,'shower_fixture')
            piece('control',(.07,.13,.055),((a+c)/2+.035,-(b+d)/2,z+.15),metal_mat,'shower_fixture')
        records['fixtures'].append({**fixture,'reference_bounds_m':[a,b,c,d],'mesh_names':names,'furniture_placeable':False,'collision':True})
    return records
