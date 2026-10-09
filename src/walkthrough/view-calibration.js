const rad=Math.PI/180;
export function verticalFromHorizontal(horizontal,aspect){return 2*Math.atan(Math.tan(horizontal*rad/2)/aspect)/rad;}
export function horizontalFromVertical(vertical,aspect){return 2*Math.atan(Math.tan(vertical*rad/2)*aspect)/rad;}
// Match a physical display's subtended angle. This calibrates perspective only;
// a monoscopic monitor still cannot reproduce every real-world depth cue.
export function screenHorizontalFov(displayWidthCm,viewDistanceCm,viewportFraction=1){
  if(![displayWidthCm,viewDistanceCm,viewportFraction].every(n=>Number.isFinite(n)&&n>0))throw new Error('화면 너비와 시청 거리를 확인해 주세요.');
  return 2*Math.atan(displayWidthCm*Math.min(1,viewportFraction)/(2*viewDistanceCm))/rad;
}
