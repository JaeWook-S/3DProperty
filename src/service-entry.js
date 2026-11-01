import {serviceBaseForPage} from './property/service-endpoints.js';
// Mingyu's home is the default. Explicit map and site links retain the location service.
const params=new URLSearchParams(location.search);
if(params.get('serviceTour')==='1'){
  import('./walkthrough/site-tour.js');
}else if(['map','site'].includes(params.get('serviceView'))&&!params.has('studio')){
  const service=serviceBaseForPage(location.href,import.meta.env.VITE_SERVICE_BASE_URL);
  for(const [key,value] of params)if(!['serviceUrl','viewerUrl'].includes(key))service.searchParams.set(key,value);
  location.replace(service.href);
}else{
  // Selection synchronization may add serviceView=map; keep reloads on the home/viewer route.
  if(!params.has('studio')){const url=new URL(location.href);url.searchParams.set('studio','1');history.replaceState(null,'',url);}
  import('./walkthrough/main.js');
}
