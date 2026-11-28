// @ts-nocheck
/* ================================================================
   色補正のプレビュー（M6）。補正を 1 つの 3D LUT にまとめ（core/color.ts）、WebGL2 の 3D テクスチャで引く。
   書き出しは同じ LUT を .cube にして FFmpeg の lut3d で引くので、プレビューと同じ色になる。
   WebGL2 が使えないときは、縮めた絵を CPU で補正する（遅いので最大 640px）。
   読み込んだ LUT（.cube）は、デスクトップ版はファイルの場所から読み直し、ブラウザ版はそのページを開いている間だけ覚える
   ================================================================ */
import { LUT_SIZE, buildLut, colorKey, colorOf, parseCube, sampleCube, toCube } from '../core/color';
import { HOST } from './desktop';

var GL = null, GLC = null, PROG = null, IMG = null, BAD = false, U = null, FB = [];
var LUTS = {}; /* 補正の鍵 → {tex, data, used} */
export var CUBES = {}; /* LUT の場所（ブラウザ版は名前）→ Cube | 'loading' | {error} */
var onLoad = null;
/** 読み込んだ LUT が届いたときに描き直す関数（engine.ts が渡す） */
export function setCubeLoaded(fn) { onLoad = fn; }

export function cubeId(lut) { return lut ? lut.path || lut.name : ''; }
/** 色補正の値の LUT（読み込んだ LUT がまだなら読みにいき、届くまでは LUT なしで補正する） */
export function cubeOf(c) {
  if (!c || !c.ccLut) return null;
  var id = cubeId(c.ccLut), v = CUBES[id];
  if (v && v.size) return v;
  if (v === undefined && HOST && c.ccLut.path) {
    CUBES[id] = 'loading';
    HOST.color.readLut(c.ccLut.path).then(function (t) { CUBES[id] = parseCube(t); dropLuts(); if (onLoad) onLoad(); })
      .catch(function (e) { CUBES[id] = { error: String(e && e.message || e) }; if (onLoad) onLoad(); });
  }
  return null;
}
/** 読み込んだ LUT の状態：ok・loading・missing（ブラウザ版で開き直したとき）・error */
export function cubeState(c) {
  if (!c || !c.ccLut) return '';
  var v = CUBES[cubeId(c.ccLut)];
  if (v && v.size) return 'ok';
  if (v === 'loading') return 'loading';
  if (v && v.error) return 'error';
  return HOST && c.ccLut.path ? 'loading' : 'missing';
}
/** すべての LUT を読み終えるまで待つ（書き出しの前） */
export function cubesReady(clips) {
  var need = {};
  clips.forEach(function (c) { var p = colorOf(c); if (p && p.ccLut && HOST && p.ccLut.path) need[cubeId(p.ccLut)] = p; });
  return Promise.all(Object.keys(need).map(function (id) {
    var v = CUBES[id];
    if (v && v.size) return null;
    return HOST.color.readLut(need[id].ccLut.path).then(function (t) { CUBES[id] = parseCube(t); })
      .catch(function (e) { throw new Error('LUT「' + need[id].ccLut.name + '」を読めませんでした：' + (e && e.message || e)); });
  }));
}
function dropLuts() { Object.keys(LUTS).forEach(function (k) { if (LUTS[k].tex && GL) GL.deleteTexture(LUTS[k].tex); }); LUTS = {}; }

/** 補正の LUT（値の組ごとに使い回す。最大 24 個） */
function lutFor(p) {
  var cube = cubeOf(p), key = colorKey(p) + (p.ccLut && !cube ? '#nolut' : ''), e = LUTS[key];
  if (e) { e.used = Date.now(); return e; }
  var ks = Object.keys(LUTS);
  if (ks.length >= 24) { ks.sort(function (a, b) { return LUTS[a].used - LUTS[b].used; }); var old = LUTS[ks[0]]; if (old.tex && GL) GL.deleteTexture(old.tex); delete LUTS[ks[0]]; }
  e = LUTS[key] = { data: buildLut(p, cube), used: Date.now(), tex: null, key: key };
  return e;
}
/** 書き出し用：色補正のあるクリップの LUT（.cube の文字）。同じ補正のクリップはまとめる */
export function exportLuts(clips) {
  var by = {};
  clips.forEach(function (c) { var p = colorOf(c); if (!p) return; var k = colorKey(p); (by[k] = by[k] || { clips: [], p: p }).clips.push(c.id); });
  return Object.keys(by).map(function (k) { var b = by[k]; return { clips: b.clips, cube: toCube(buildLut(b.p, cubeOf(b.p))) }; });
}

function setup() {
  if (GL || BAD) return GL;
  try {
    GLC = document.createElement('canvas');
    GL = GLC.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: true });
    if (!GL) throw 0;
    var vs = '#version 300 es\nin vec2 p;out vec2 uv;void main(){uv=vec2((p.x+1.)*.5,(1.-p.y)*.5);gl_Position=vec4(p,0.,1.);}';
    /* 1 つのプログラムで 4 つの処理：0 LUT、1 ぼかし（片方向のガウス）、2 モザイク（ブロックの平均）、3 周辺を暗く（FFmpeg の vignette と同じ式）。
       flip：前の処理の結果（フレームバッファ）を読むときは上下が逆になる */
    var fs = '#version 300 es\nprecision highp float;precision highp sampler3D;uniform sampler2D img;uniform sampler3D lut;uniform float n;uniform int mode;uniform int useLut;uniform int flip;' +
      'uniform vec2 size;uniform vec2 dir;uniform float sigma;uniform float block;uniform float angle;in vec2 uv;out vec4 o;' +
      'vec4 at(vec2 p){return texture(img,flip==1?vec2(p.x,1.-p.y):p);}' +
      'void main(){if(mode==0){vec4 c=at(uv);if(useLut==1){vec3 q=(clamp(c.rgb,0.,1.)*(n-1.)+.5)/n;c.rgb=texture(lut,q).rgb;}o=c;return;}' +
      'if(mode==1){vec4 a=vec4(0.);float ws=0.;float r=ceil(sigma*3.);float st=max(1.,ceil(r/48.));for(int i=-48;i<=48;i++){float x=float(i)*st;if(abs(x)>r)continue;float w=exp(-x*x/(2.*sigma*sigma));a+=at(uv+dir*x/size)*w;ws+=w;}o=a/ws;return;}' +
      'if(mode==2){vec2 px=uv*size;vec2 b0=floor(px/block)*block;vec2 b1=min(b0+block,size);vec4 a=vec4(0.);for(int j=0;j<8;j++)for(int i=0;i<8;i++){vec2 p=b0+(vec2(float(i),float(j))+.5)/8.*(b1-b0);a+=at(p/size);}o=a/64.;return;}' +
      'vec4 c=at(uv);float dn=length((uv-.5)*size)/length(size*.5);float f=dn>1.?0.:pow(cos(angle*dn),4.);o=vec4(c.rgb*f,c.a);}';
    var sh = function (t, src) { var s = GL.createShader(t); GL.shaderSource(s, src); GL.compileShader(s); if (!GL.getShaderParameter(s, GL.COMPILE_STATUS)) throw new Error(GL.getShaderInfoLog(s)); return s; };
    PROG = GL.createProgram(); GL.attachShader(PROG, sh(GL.VERTEX_SHADER, vs)); GL.attachShader(PROG, sh(GL.FRAGMENT_SHADER, fs)); GL.linkProgram(PROG);
    if (!GL.getProgramParameter(PROG, GL.LINK_STATUS)) throw new Error(GL.getProgramInfoLog(PROG));
    GL.useProgram(PROG);
    var buf = GL.createBuffer(); GL.bindBuffer(GL.ARRAY_BUFFER, buf); GL.bufferData(GL.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), GL.STATIC_DRAW);
    var loc = GL.getAttribLocation(PROG, 'p'); GL.enableVertexAttribArray(loc); GL.vertexAttribPointer(loc, 2, GL.FLOAT, false, 0, 0);
    GL.uniform1i(GL.getUniformLocation(PROG, 'img'), 0); GL.uniform1i(GL.getUniformLocation(PROG, 'lut'), 1); GL.uniform1f(GL.getUniformLocation(PROG, 'n'), LUT_SIZE);
    U = {}; ['mode', 'useLut', 'flip', 'size', 'dir', 'sigma', 'block', 'angle'].forEach(function (k) { U[k] = GL.getUniformLocation(PROG, k); });
    IMG = GL.createTexture(); GL.activeTexture(GL.TEXTURE0); GL.bindTexture(GL.TEXTURE_2D, IMG);
    [GL.TEXTURE_WRAP_S, GL.TEXTURE_WRAP_T].forEach(function (k) { GL.texParameteri(GL.TEXTURE_2D, k, GL.CLAMP_TO_EDGE); });
    GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR); GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
    GLC.addEventListener('webglcontextlost', function (e) { e.preventDefault(); GL = null; LUTS = {}; });
  } catch (e) { GL = null; BAD = true; }
  return GL;
}
function lutTex(e) {
  if (e.tex) return e.tex;
  var t = GL.createTexture(); GL.activeTexture(GL.TEXTURE1); GL.bindTexture(GL.TEXTURE_3D, t);
  GL.pixelStorei(GL.UNPACK_ALIGNMENT, 1);
  GL.texImage3D(GL.TEXTURE_3D, 0, GL.RGB16F, LUT_SIZE, LUT_SIZE, LUT_SIZE, 0, GL.RGB, GL.FLOAT, e.data);
  [GL.TEXTURE_WRAP_S, GL.TEXTURE_WRAP_T, GL.TEXTURE_WRAP_R].forEach(function (k) { GL.texParameteri(GL.TEXTURE_3D, k, GL.CLAMP_TO_EDGE); });
  GL.texParameteri(GL.TEXTURE_3D, GL.TEXTURE_MIN_FILTER, GL.LINEAR); GL.texParameteri(GL.TEXTURE_3D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
  e.tex = t; return t;
}

var CPU = null;
/** 絵（video・img・canvas）に色補正をかけた canvas を返す（dw×dh で描く。できなければ null） */
export function colorize(src, w, h, dw, dh, p) {
  var cw = Math.max(1, Math.min(4096, Math.round(dw))), ch = Math.max(1, Math.min(4096, Math.round(dh)));
  var e = lutFor(p);
  if (setup()) {
    try {
      if (GLC.width !== cw || GLC.height !== ch) { GLC.width = cw; GLC.height = ch; }
      GL.viewport(0, 0, cw, ch);
      GL.activeTexture(GL.TEXTURE1); GL.bindTexture(GL.TEXTURE_3D, lutTex(e));
      GL.activeTexture(GL.TEXTURE0); GL.bindTexture(GL.TEXTURE_2D, IMG);
      GL.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); GL.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, false);
      GL.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, src);
      GL.bindFramebuffer(GL.FRAMEBUFFER, null); GL.uniform1i(U.mode, 0); GL.uniform1i(U.useLut, 1); GL.uniform1i(U.flip, 0);
      GL.clearColor(0, 0, 0, 0); GL.clear(GL.COLOR_BUFFER_BIT); GL.drawArrays(GL.TRIANGLE_STRIP, 0, 4);
      return GLC;
    } catch (x) { return null; }
  }
  /* WebGL2 がないとき：縮めて CPU で */
  try {
    var k = Math.min(1, 640 / Math.max(cw, ch)), sw = Math.max(1, Math.round(cw * k)), sh = Math.max(1, Math.round(ch * k));
    CPU = CPU || document.createElement('canvas'); if (CPU.width !== sw || CPU.height !== sh) { CPU.width = sw; CPU.height = sh; }
    var x = CPU.getContext('2d', { willReadFrequently: true }); x.clearRect(0, 0, sw, sh); x.drawImage(src, 0, 0, sw, sh);
    var im = x.getImageData(0, 0, sw, sh), d = im.data, cube = { size: LUT_SIZE, data: e.data };
    for (var i = 0; i < d.length; i += 4) { var v = sampleCube(cube, d[i] / 255, d[i + 1] / 255, d[i + 2] / 255); d[i] = v[0] * 255; d[i + 1] = v[1] * 255; d[i + 2] = v[2] * 255; }
    x.putImageData(im, 0, 0); return CPU;
  } catch (x2) { return null; }
}
/** 試し：WebGL2 で補正できるか（テストで使う） */
export function glReady() { return !!setup(); }

/* ---------- エフェクト（M6）：ぼかし・モザイク・周辺を暗く ----------
   書き出し（crates/matsuko-core/src/export.rs の effects）と同じ順：色補正 → ぼかし → モザイク → 周辺を暗く。
   大きさは 1080p の画面での px なので、描く画面の高さ H に合わせる */
export function fxOf(c) {
  if (!c) return null;
  var b = +c.fxBlur || 0, m = +c.fxMosaic || 0, v = +c.fxVig || 0;
  return b >= 0.05 || m >= 1 || v >= 0.5 ? { blur: b, mosaic: m, vig: v } : null;
}
function fbo(i, w, h) {
  var f = FB[i];
  if (!f) { f = FB[i] = { tex: GL.createTexture(), fb: GL.createFramebuffer(), w: 0, h: 0 }; }
  if (f.w !== w || f.h !== h) {
    GL.activeTexture(GL.TEXTURE0); GL.bindTexture(GL.TEXTURE_2D, f.tex);
    GL.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, w, h, 0, GL.RGBA, GL.UNSIGNED_BYTE, null);
    [GL.TEXTURE_WRAP_S, GL.TEXTURE_WRAP_T].forEach(function (k) { GL.texParameteri(GL.TEXTURE_2D, k, GL.CLAMP_TO_EDGE); });
    GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MIN_FILTER, GL.LINEAR); GL.texParameteri(GL.TEXTURE_2D, GL.TEXTURE_MAG_FILTER, GL.LINEAR);
    GL.bindFramebuffer(GL.FRAMEBUFFER, f.fb); GL.framebufferTexture2D(GL.FRAMEBUFFER, GL.COLOR_ATTACHMENT0, GL.TEXTURE_2D, f.tex, 0);
    f.w = w; f.h = h;
  }
  return f;
}
/** 色補正（p）とエフェクト（fx）を掛けた絵（dw×dh の canvas）。H は描く画面の高さ。WebGL2 がなければ色補正だけ */
export function process(src, w, h, dw, dh, p, fx, H) {
  if (!fx) return p ? colorize(src, w, h, dw, dh, p) : null;
  if (!setup()) return p ? colorize(src, w, h, dw, dh, p) : null;
  var cw = Math.max(1, Math.min(4096, Math.round(dw))), ch = Math.max(1, Math.min(4096, Math.round(dh))), k = (H || ch) / 1080;
  try {
    if (GLC.width !== cw || GLC.height !== ch) { GLC.width = cw; GLC.height = ch; }
    GL.viewport(0, 0, cw, ch);
    GL.uniform2f(U.size, cw, ch);
    var e = p ? lutFor(p) : null;
    GL.activeTexture(GL.TEXTURE1); GL.bindTexture(GL.TEXTURE_3D, lutTex(e || lutFor({})));
    /* 1：元の絵 → 色補正（フレームバッファ 0） */
    GL.activeTexture(GL.TEXTURE0); GL.bindTexture(GL.TEXTURE_2D, IMG);
    GL.pixelStorei(GL.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); GL.pixelStorei(GL.UNPACK_FLIP_Y_WEBGL, false);
    GL.texImage2D(GL.TEXTURE_2D, 0, GL.RGBA, GL.RGBA, GL.UNSIGNED_BYTE, src);
    var steps = [];
    if (fx.blur * k >= 0.1) { steps.push({ mode: 1, dir: [1, 0] }); steps.push({ mode: 1, dir: [0, 1] }); }
    if (Math.round(fx.mosaic * k) >= 2) steps.push({ mode: 2 });
    if (fx.vig >= 0.5) steps.push({ mode: 3 });
    var cur = -1, inTex = IMG, pass = function (mode, last, set) {
      var out = last ? null : fbo(cur === 0 ? 1 : 0, cw, ch);
      GL.bindFramebuffer(GL.FRAMEBUFFER, out ? out.fb : null);
      GL.activeTexture(GL.TEXTURE0); GL.bindTexture(GL.TEXTURE_2D, inTex);
      GL.uniform1i(U.mode, mode); GL.uniform1i(U.useLut, mode === 0 && e ? 1 : 0); GL.uniform1i(U.flip, cur >= 0 ? 1 : 0);
      if (set) set();
      GL.clearColor(0, 0, 0, 0); GL.clear(GL.COLOR_BUFFER_BIT); GL.drawArrays(GL.TRIANGLE_STRIP, 0, 4);
      if (out) { cur = cur === 0 ? 1 : 0; inTex = out.tex; }
    };
    pass(0, !steps.length);
    steps.forEach(function (st, i) {
      pass(st.mode, i === steps.length - 1, function () {
        if (st.mode === 1) { GL.uniform2f(U.dir, st.dir[0], st.dir[1]); GL.uniform1f(U.sigma, fx.blur * k); }
        else if (st.mode === 2) GL.uniform1f(U.block, Math.round(fx.mosaic * k));
        else GL.uniform1f(U.angle, Math.min(100, fx.vig) / 100 * Math.PI / 2);
      });
    });
    return GLC;
  } catch (x) { return null; }
}
