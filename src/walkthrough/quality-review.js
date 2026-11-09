import { AgXToneMapping, Vector2 } from 'three';
import { createManagedPathTracer, disposePathtraceResources } from './pathtrace-dispose.js';
import { createPathtraceSnapshot } from './pathtrace-snapshot.js';
import './quality-review.css';

// Deliberately lazy: no path-tracing shaders, texture arrays or BVH on normal entry.
export function createQualityReview({renderer,camera,getActive,getLights,getLighting,rasterize,invalidate}) {
  const ui=document.createElement('div');ui.id='quality-review';ui.hidden=true;
  ui.innerHTML='<button id="quality-review-toggle" type="button" aria-pressed="false">빛·반사 고품질</button><div class="quality-review-options" hidden><label>선명도 <select id="quality-review-samples"><option value="256">빠른 확인 · 256</option><option value="1024">정밀 · 1024</option><option value="4096">최고 · 4096</option></select></label><output id="quality-review-status" aria-live="polite">화면이 멈추면 빛을 계산합니다</output><small>움직이면 즉시 실시간 화면으로 전환됩니다.</small></div>';
  renderer.domElement.parentElement.append(ui);
  const button=ui.querySelector('button'),options=ui.querySelector('.quality-review-options'),status=ui.querySelector('output'),select=ui.querySelector('select');
  const gl=renderer.getContext();
  let pendingFence=null,pendingSamples=0;
  function clearFence(){if(pendingFence)gl.deleteSync(pendingFence);pendingFence=null;}
  let lastDisposal=null;
  let shaderError='',previousShaderError=renderer.debug.onShaderError;
  let enabled=false,library=null,tracer=null,snapshot=null,environment=null,denoise=null,quad=null,error='',loading=false,generation=0;
  let sceneDirty=true,lastChange=performance.now(),cameraKey='',modelId='',lighting='',mode='',samples=0,target=256,builds=0,lastLabel='',lastSize='',started=0,lastRenderMs=0;
  const size=new Vector2();
  function label(text){if(lastLabel!==text){status.textContent=text;lastLabel=text;}}
  function release(){clearFence();lastDisposal=disposePathtraceResources(tracer);snapshot?.dispose();environment?.dispose();denoise?.dispose();tracer=snapshot=environment=denoise=quad=null;samples=0;sceneDirty=true;lastSize='';}
  function fail(cause){error=cause?.message||String(cause);enabled=false;loading=false;generation++;release();renderer.debug.onShaderError=previousShaderError;button.setAttribute('aria-pressed','false');label('이 기기에서는 실시간 품질로 표시합니다.');options.hidden=false;invalidate();console.warn('High quality renderer fallback:',error);}
  async function enable(){
    if(loading||(enabled&&tracer))return;
    enabled=true;error='';generation++;const token=generation;button.setAttribute('aria-pressed','true');options.hidden=false;label('고품질 화면 준비 중…');loading=true;invalidate();
    try{
      if(!renderer.extensions.has('EXT_color_buffer_float'))throw Error('Float color buffers unavailable');
      library??=await import('three-gpu-pathtracer');
      const {FullScreenQuad}=await import('three/addons/postprocessing/Pass.js');
      if(token!==generation||!enabled)return;
      // The library never touches the live logical/model/material objects.
      tracer=createManagedPathTracer(library.WebGLPathTracer,renderer);tracer.renderDelay=0;tracer.fadeDuration=0;tracer.minSamples=1;
      tracer.bounces=6;tracer.transmissiveBounces=4;tracer.filterGlossyFactor=.5;tracer.tiles.set(2,2);tracer.textureSize.set(1024,1024);
      tracer.dynamicLowRes=false;tracer.rasterizeScene=false;tracer.renderToCanvas=false;
      environment=new library.GradientEquirectTexture(64);environment.topColor.setRGB(.72,.78,.83);environment.bottomColor.copy(environment.topColor);environment.update();
      shaderError='';renderer.debug.onShaderError=(gl,program,vs,fs)=>{shaderError=gl.getProgramInfoLog(program)||gl.getShaderInfoLog(fs)||'Path tracing shader failed';previousShaderError?.(gl,program,vs,fs);};
      denoise=new library.DenoiseMaterial({sigma:2,kSigma:1,threshold:.08});quad=new FullScreenQuad(denoise);
      sceneDirty=true;loading=false;lastChange=performance.now();label('화면을 멈추면 선명해집니다');invalidate();
    }catch(e){if(token===generation)fail(e);}
  }
  function disable(){enabled=false;generation++;loading=false;release();renderer.debug.onShaderError=previousShaderError;button.setAttribute('aria-pressed','false');options.hidden=true;invalidate();}
  button.onclick=()=>enabled?disable():enable();
  select.onchange=()=>{target=Number(select.value);};
  function invalidateScene(){clearFence();sceneDirty=true;lastChange=performance.now();samples=0;if(tracer)tracer.reset();}
  function renderFrame({dirty=false,activeMode='tour',busy=false,editing=false,dt=0}={}){
    mode=activeMode;ui.hidden=mode!=='tour';
    if(mode!=='tour'){
      if(tracer||loading){generation++;loading=false;release();renderer.debug.onShaderError=previousShaderError;label('둘러보기에서 고품질 화면을 확인하세요');}
      return false;
    }
    if(busy||editing){if(tracer){clearFence();sceneDirty=true;lastChange=performance.now();samples=0;tracer.reset();}return false;}
    if(enabled&&!tracer&&!loading){enable();return false;}
    if(!enabled||loading||!tracer||document.hidden)return false;
    if(shaderError){fail(new Error(shaderError));return false;}
    const active=getActive();if(!active)return false;
    const id=active.model.uuid,nextLighting=getLighting();
    camera.updateMatrixWorld();const key=[...camera.matrixWorld.elements,...camera.projectionMatrix.elements].join(',');
    const moved=key!==cameraKey;
    if(id!==modelId||nextLighting!==lighting){sceneDirty=true;modelId=id;lighting=nextLighting;}
    renderer.getDrawingBufferSize(size);const sizeKey=size.toArray().join(',');
    if(sizeKey!==lastSize){lastSize=sizeKey;tracer.renderScale=Math.min(1,1280/size.x,900/size.y);tracer.updateCamera();lastChange=performance.now();samples=0;}
    if(dirty||moved){
      clearFence();
      if(dirty&&!moved)sceneDirty=true;
      cameraKey=key;lastChange=performance.now();samples=0;tracer.updateCamera();label('실시간 이동 · 멈추면 선명해집니다');return false;
    }
    if(pendingFence){
      const state=gl.clientWaitSync(pendingFence,0,0);
      if(state===gl.TIMEOUT_EXPIRED)return true;
      if(state===gl.WAIT_FAILED){fail(new Error('GPU completion fence failed'));return false;}
      clearFence();samples=pendingSamples;
      label(`${Math.min(target,Math.floor(samples))} / ${target} · ${samples>=target?'완료':'선명해지는 중'}`);
    }
    if(performance.now()-lastChange<450)return false;
    if(!sceneDirty&&samples>=target)return true;
    try{
      if(sceneDirty){
        label('빛과 반사 계산 준비 중…');rasterize(dt);
        snapshot?.dispose();
        snapshot=createPathtraceSnapshot({model:active.model,lights:getLights(),environment,background:environment,environmentIntensity:lighting==='night'?.025:lighting==='sunset'?.22:.4});
        tracer.setScene(snapshot.scene,camera);sceneDirty=false;builds++;samples=0;started=performance.now();
      }
      const priorTone=renderer.toneMapping,priorExposure=renderer.toneMappingExposure;
      renderer.toneMapping=AgXToneMapping;renderer.toneMappingExposure=1;
      try{
        const begin=performance.now();
        if(tracer.samples<target)tracer.renderSample();
        pendingSamples=tracer.samples;
        if(pendingSamples>=1){denoise.map=tracer.target.texture;quad.render(renderer);}
        else rasterize(dt);
        // Bound work to one tile. The counter advances only after GPU completion,
        // not merely command submission; slow devices retain responsive controls.
        pendingFence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
        lastRenderMs=performance.now()-begin;
      }finally{renderer.toneMapping=priorTone;renderer.toneMappingExposure=priorExposure;}
      label(tracer.isCompiling?'고품질 셰이더 준비 중…':`${Math.min(target,Math.floor(samples))} / ${target} · ${samples>=target?'완료':'선명해지는 중'}`);
      return true;
    }catch(e){fail(e);return false;}
  }
  return {enable,disable,renderFrame,invalidateScene,
    inspect:()=>({enabled,loading,error,mode,samples,target,builds,lastDisposal,gpuPending:Boolean(pendingFence),sceneDirty,lastRenderMs,elapsedSeconds:started?(performance.now()-started)/1000:0,renderScale:tracer?.renderScale??null,snapshot:snapshot?.stats??null}),
    setTarget(value){if(![1,4,16,64,256,1024,4096].includes(value))throw Error('Invalid quality target');target=value;},
    dispose(){disable();ui.remove();},
  };
}
