// S3 navigation adapter; S1 owns the independent prototype and transport logic.
import './floor-access/main.js';
import {resolveViewerBase, serviceBaseForPage} from './property/service-endpoints.js';

const page = new URL(location.href);
const viewer = resolveViewerBase(page.href, new URL('./', page).href);
viewer.searchParams.delete('serviceUrl');
if (page.searchParams.has('serviceUrl')) viewer.searchParams.set('serviceUrl', page.searchParams.get('serviceUrl'));
const service = serviceBaseForPage(viewer.href, import.meta.env.VITE_SERVICE_BASE_URL);
const home = document.querySelector('#floor-access-app header .brand');
home.href = service.href;
home.setAttribute('aria-label', '지도 서비스로 돌아가기');
home.firstChild.textContent = '← CORTEX ';
home.querySelector('span').textContent = '지도 서비스로 돌아가기';
