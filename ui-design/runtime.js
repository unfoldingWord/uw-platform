/* --- tiny template runtime: {{holes}}, <sc-for>, <sc-if>, onClick --- */
var HANDLERS = {}, HID = 0;
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function get(scope, path){
  path = path.trim();
  if (path === 'true') return true;
  if (path === 'false') return false;
  var cur = scope, bits = path.split('.');
  for (var i = 0; i < bits.length; i++) {
    if (cur == null) return undefined;
    cur = cur[bits[i]];
  }
  return cur;
}
function findBlock(s, tag){
  var open = new RegExp('<' + tag + '\\b[^>]*>', 'g');
  var m = open.exec(s);
  if (!m) return null;
  var innerStart = m.index + m[0].length, depth = 1;
  var re = new RegExp('<' + tag + '\\b[^>]*>|</' + tag + '>', 'g');
  re.lastIndex = innerStart;
  var mm;
  while ((mm = re.exec(s))) {
    if (mm[0].charAt(1) === '/') { depth--; if (!depth) return { start: m.index, attrs: m[0], inner: s.slice(innerStart, mm.index), end: mm.index + mm[0].length }; }
    else depth++;
  }
  return null;
}
function proc(tpl, scope){
  var bFor = findBlock(tpl, 'sc-for');
  var bIf = findBlock(tpl, 'sc-if');
  // whichever opens first in the source wins — otherwise a loop nested inside a
  // conditional gets expanded before the conditional is evaluated, and both
  // branches leak into the output.
  var useFor = bFor && (!bIf || bFor.start < bIf.start);
  if (useFor) {
    var lm = /list="\{\{\s*([^}\s]+)\s*\}\}"/.exec(bFor.attrs);
    var am = /as="([^"]+)"/.exec(bFor.attrs);
    var arr = (lm ? get(scope, lm[1]) : null) || [];
    var as = am ? am[1] : 'item', out = '';
    for (var i = 0; i < arr.length; i++) {
      var child = Object.create(scope);
      child[as] = arr[i]; child.$index = i;
      out += proc(bFor.inner, child);
    }
    return proc(tpl.slice(0, bFor.start), scope) + out + proc(tpl.slice(bFor.end), scope);
  }
  if (bIf) {
    var vm = /value="\{\{\s*([^}\s]+)\s*\}\}"/.exec(bIf.attrs);
    var on = vm ? !!get(scope, vm[1]) : false;
    return proc(tpl.slice(0, bIf.start), scope) + (on ? proc(bIf.inner, scope) : '') + proc(tpl.slice(bIf.end), scope);
  }
  tpl = tpl.replace(/onClick="\{\{\s*([^}\s]+)\s*\}\}"/g, function(m, p){
    var fn = get(scope, p);
    if (typeof fn !== 'function') return '';
    var id = 'h' + (++HID); HANDLERS[id] = fn;
    return 'data-h="' + id + '"';
  });
  return tpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, function(m, p){
    var v = get(scope, p);
    return (v === undefined || v === null || typeof v === 'function') ? '' : esc(v);
  });
}
/* --- component base --- */
function DCLogic(props){ this.props = props || {}; }
DCLogic.prototype.setState = function(patch){
  this.state = Object.assign({}, this.state, patch);
  draw();
};
DCLogic.prototype.forceUpdate = function(){ draw(); };
/* logic files use `class Component extends DCLogic` — provide it as a class */
window.DCLogic = class DCLogic2 {
  constructor(props){ this.props = props || {}; this.state = {}; }
  setState(patch){ this.state = Object.assign({}, this.state, patch); draw(); }
  forceUpdate(){ draw(); }
};
/* --- app --- */
var current = 'Main', instances = {};
function inst(name){
  if (!instances[name]) instances[name] = new SCREENS[name].make({});
  return instances[name];
}
function draw(){
  var sc = SCREENS[current], c = inst(current);
  HANDLERS = {}; HID = 0;
  var vals = c.renderVals();
  var nav = ASIDE.replace('class="ni ni-' + sc.nav + '"', 'class="ni ni-' + sc.nav + ' on"');
  document.getElementById('root').innerHTML =
    '<div class="app">' + nav + '<main class="main">' + proc(sc.body, vals) + '</main></div>';
}
document.addEventListener('click', function(e){
  var area = e.target.closest ? e.target.closest('[data-area]') : null;
  if (area) { current = 'AreaHome'; draw(); return; }
  var nav = e.target.closest ? e.target.closest('[data-nav]') : null;
  if (nav && nav.getAttribute('data-nav')) { current = nav.getAttribute('data-nav'); instances = instances; draw(); return; }
  var srch = e.target.closest ? e.target.closest('.search') : null;
  if (srch) { current = 'Search'; draw(); return; }
  var h = e.target.closest ? e.target.closest('[data-h]') : null;
  if (h) { var fn = HANDLERS[h.getAttribute('data-h')]; if (fn) { fn(); } }
});
document.addEventListener('keydown', function(e){
  if (e.key === 'Escape' && current === 'Search') { current = 'Main'; draw(); }
});
draw();
