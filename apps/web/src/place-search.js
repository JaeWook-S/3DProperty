export const ACRO={id:'acro-river-park',name:'아크로리버파크',address:'서울 서초구 신반포로15길 19',lat:37.50544718,lon:126.99321424,ready:true,source:'https://www.acro.co.kr/Posm_main.action?commonMap.CD_BIZ_LND=010366',sourceLabel:'ACRO 공식 소개 · OSM 위치',basis:'준비된 체험 모델 · 실제 동·층·호·타입 대응 미확인'};
export function photonPlaces(data){
  if(!Array.isArray(data?.features))throw Error('검색 응답을 읽지 못했습니다.');
  const found=new Map();
  for(const f of data.features){const p=f.properties||{},[lon,lat]=f.geometry?.coordinates||[];if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)continue;
    const osmType={N:'node',W:'way',R:'relation'}[p.osm_type],id=String(p.osm_id||'');if(!osmType||!/^\d+$/.test(id))continue;
    const name=String(p.name||p.street||p.city||'선택한 위치').slice(0,180),address=[p.city,p.district,p.locality,p.street,p.housenumber].filter(Boolean).join(' ');
    if(name.replaceAll(' ','')==='아크로리버파크'&&Math.hypot(lat-ACRO.lat,lon-ACRO.lon)<.006){found.set(ACRO.id,ACRO);continue;}
    const place={id:`osm:${osmType}:${id}`,name,address:address||p.country||'주소 정보 없음',lat,lon,ready:false,source:`https://www.openstreetmap.org/${osmType}/${id}`,sourceLabel:'OpenStreetMap · Photon 검색',basis:'장소 정보 · 도면/3D 미등록'};found.set(place.id,place);
  }return [...found.values()];
}
export function createPlaceSearch(config){
 let last=0;
 return async query=>{
  query=query.trim();if(query.length<2||query.length>120)throw Error('검색어를 2~120자로 입력해 주세요.');
  const key=`cortex-place-search-v1:${config.searchUrl}:${query}`;try{const cached=JSON.parse(localStorage.getItem(key));if(cached&&Date.now()-cached.at<86400000)return cached.places;}catch{}
  if(Date.now()-last<1100)throw Error('잠시 후 다시 검색해 주세요.');last=Date.now();
  const url=new URL(config.searchUrl);url.searchParams.set('q',query);url.searchParams.set('limit','8');url.searchParams.set('lat',String(ACRO.lat));url.searchParams.set('lon',String(ACRO.lon));
  const response=await fetch(url,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error(`검색 연결 실패 (${response.status}). 지도에서 위치를 직접 선택할 수 있어요.`);
  const places=photonPlaces(await response.json());if(/아크로\s*리버파크/.test(query)&&!places.some(p=>p.ready))places.unshift(ACRO);
  try{localStorage.setItem(key,JSON.stringify({at:Date.now(),places}));}catch{}return places;
 };
}
