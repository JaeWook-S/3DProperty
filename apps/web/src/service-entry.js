import {viewerBaseForPage} from '../../../src/property/service-endpoints.js';
// Existing map/selection links stay on this service. A new visit opens the shared home design.
const params=new URLSearchParams(location.search);
const mapKeys=['serviceView','locationId','address','lat','lon','building','floor','unit','mapLat','mapLon','mapZoom','sampleVariant','query','test','furniture'];
if(mapKeys.some(key=>params.has(key))){
  import('./main.js');
}else{
  const home=viewerBaseForPage(location.href,import.meta.env.VITE_VIEWER_BASE_URL);
  home.searchParams.set('studio','1');
  for(const key of ['home','tours','concept','palette'])if(params.has(key))home.searchParams.set(key,params.get(key));
  location.replace(home.href);
}
