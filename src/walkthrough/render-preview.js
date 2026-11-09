import './render-preview.css';

// Fixed camera image from the original 168C metric model. No scene changes or
// progressive renderer: fetch the immutable asset only on explicit open.
const IMAGE_URL=new URL('../../assets/render-previews/168c-expanded-4096/living-kitchen.webp',import.meta.url).href;
const VARIANT='168c-expanded-archisketch',REVISION='archisketch-metric-v1';
export function createRenderPreview({renderer,getActive,onOpen=()=>{},onClose=()=>{}}){
  const host=document.createElement('div');host.id='render-preview';host.hidden=true;
  host.innerHTML='<button id="render-preview-toggle" type="button" aria-haspopup="dialog" aria-controls="render-preview-dialog">완성 렌더 보기</button>';
  renderer.domElement.parentElement.append(host);
  const dialog=document.createElement('dialog');dialog.id='render-preview-dialog';
  dialog.setAttribute('aria-labelledby','render-preview-title');dialog.setAttribute('aria-describedby','render-preview-note');
  dialog.innerHTML=`<header><div><span class="render-preview-eyebrow">완성된 이미지 · 4096 SPP</span><h2 id="render-preview-title">168C 확장형 · 거실에서 바라본 주방</h2></div><button class="render-preview-close" type="button" aria-label="렌더 보기 닫기" autofocus>×</button></header>
    <div class="render-preview-image"><img width="1600" height="1000" alt="168C 확장형 거실에서 주방을 바라본 사전 렌더 이미지" decoding="async" hidden><p role="status">이미지를 불러오는 중…</p><button class="render-preview-retry" type="button" hidden>다시 불러오기</button></div>
    <footer><p id="render-preview-note">기본 가구·마감으로 미리 만든 고정 시점 이미지입니다. 현재 바꾼 가구·재질이나 시점은 반영되지 않습니다.</p><button class="render-preview-return" type="button">둘러보기로 돌아가기</button></footer>`;
  document.body.append(dialog);
  const button=host.querySelector('button'),img=dialog.querySelector('img'),status=dialog.querySelector('[role=status]'),retry=dialog.querySelector('.render-preview-retry');
  let eligible=false,loadState='idle',openedVariant=null,disposed=false;
  function load(){
    if(loadState==='loading'||loadState==='ready')return;
    loadState='loading';status.hidden=false;status.textContent='이미지를 불러오는 중…';img.hidden=true;retry.hidden=true;
    // Removing a failed URL allows a normal retry without unbounded cache keys.
    img.removeAttribute('src');img.src=IMAGE_URL;
  }
  img.addEventListener('load',()=>{if(disposed)return;loadState='ready';img.hidden=false;status.hidden=true;retry.hidden=true;});
  img.addEventListener('error',()=>{if(disposed)return;loadState='error';img.hidden=true;status.hidden=false;status.textContent='이미지를 불러오지 못했어요. 둘러보기는 계속 사용할 수 있습니다.';retry.hidden=false;});
  function close(){if(dialog.open)dialog.close();}
  function open(){
    if(!eligible||disposed||dialog.open)return;
    openedVariant=getActive()?.key;onOpen();dialog.showModal();load();
  }
  button.addEventListener('click',open);retry.addEventListener('click',load);
  dialog.querySelector('.render-preview-close').addEventListener('click',close);
  dialog.querySelector('.render-preview-return').addEventListener('click',close);
  dialog.addEventListener('close',()=>{openedVariant=null;onClose();});
  return {
    sync({activeMode,busy,editing}){
      const active=getActive();eligible=!disposed&&!busy&&!editing&&activeMode==='tour'&&active?.key===VARIANT&&active?.definition.info.finishRevision===REVISION;
      if(host.hidden===eligible)host.hidden=!eligible;
      if(dialog.open&&(!eligible||openedVariant!==active?.key))close();
    },
    inspect:()=>({eligible,open:dialog.open,loadState,variant:VARIANT,revision:REVISION,fixedView:true,liveEditsIncluded:false}),
    dispose(){disposed=true;close();host.remove();dialog.remove();},
  };
}
