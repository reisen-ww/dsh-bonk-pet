/**
 * Browser half of dsh-bonk-pet.
 *
 * A small whale sits in the bottom-right corner of the DSH web GUI inside a
 * steel basin. Click the basin to bonk it; when the harness fails a tool call
 * or a turn, a steel pipe falls out of the sky and lands on its head.
 *
 * Everything here is presentation only: no services are injected, no Cordis
 * events are emitted, and nothing reaches a model request. All artwork is
 * inline SVG drawn in this file, so activating the plugin needs no temporary
 * file, remote URL, or asset server.
 */

window.__ModuleLoader__.load({
  id: 'dsh-bonk-pet',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    const CSS = `
body[data-dsh-bonk-pet] [data-bonk-root]{
  position:fixed;z-index:2147482000;
  right:var(--bonk-x,22px);bottom:var(--bonk-y,18px);
  width:150px;height:150px;
  pointer-events:none;user-select:none;-webkit-user-select:none;
  contain:layout style;
  font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
}
body[data-dsh-bonk-pet] [data-bonk-root] *{box-sizing:border-box}

/* ---- draggable rig ------------------------------------------------- */
body[data-dsh-bonk-pet] [data-bonk-rig]{
  position:absolute;inset:0;
  transform:translate3d(var(--bonk-dx,0px),var(--bonk-dy,0px),0);
  transition:transform .3s cubic-bezier(.34,1.4,.5,1);
}
body[data-dsh-bonk-pet] [data-bonk-rig][data-walking="1"]{transition:transform .9s ease-in-out}
/* While committing a move, BOTH the rig transform and the root's left/top are
   rewritten together. left/top are not transitioned but transform is, so
   without this the pet is briefly displaced twice — once by the new left/top
   and again by the not-yet-zeroed transform — and visibly jumps before sliding
   back. Measuring the eat sequence caught it at 389px. */
body[data-dsh-bonk-pet] [data-bonk-rig][data-settling="1"]{transition:none!important}
body[data-dsh-bonk-pet] [data-bonk-rig][data-dragging="1"]{transition:none!important}

/* ---- the pet ------------------------------------------------------- */
/* The pet is the whole character, artwork or drawing. When the user supplies a
   combined pet+basin image the basin is part of this layer, so the drawn basin
   element hides (see the pet-has-basin rule below) and this element carries the
   click. Its box matches the drawn whale's aspect; an image with a different
   aspect is fitted with object-fit: contain and letterboxed, not stretched. */
body[data-dsh-bonk-pet] [data-bonk-whale]{
  position:absolute;left:50%;top:14px;
  width:112px;height:116px;margin-left:-56px;
  z-index:1;
  transform-origin:50% 96%;
  animation:bonk-breathe 3.4s ease-in-out infinite;
  filter:drop-shadow(0 5px 9px rgba(15,23,42,.28));
}
@keyframes bonk-breathe{
  0%,100%{transform:translate3d(0,0,0) scale(1,1)}
  50%{transform:translate3d(0,-3px,0) scale(1.015,.985)}
}

/* grabbed mid-dash: wriggle against the hand holding it */
body[data-dsh-bonk-pet] [data-bonk-root][data-state="struggle"] [data-bonk-whale]{
  animation:bonk-struggle .42s ease-in-out infinite;
}
@keyframes bonk-struggle{
  0%,100%{transform:rotate(-7deg) translate3d(-2px,0,0)}
  50%{transform:rotate(7deg) translate3d(2px,0,0)}
}

/* squash on impact, then a wobble back to rest */
body[data-dsh-bonk-pet] [data-bonk-root][data-state="hit"] [data-bonk-whale]{
  animation:bonk-squash .62s cubic-bezier(.2,.8,.3,1) 1;
}
@keyframes bonk-squash{
  0%{transform:translate3d(0,0,0) scale(1,1)}
  18%{transform:translate3d(0,7px,0) scale(1.22,.74)}
  42%{transform:translate3d(0,-4px,0) scale(.9,1.12)}
  68%{transform:translate3d(0,2px,0) scale(1.06,.95)}
  100%{transform:translate3d(0,0,0) scale(1,1)}
}

/* shake when the basin is knocked */
body[data-dsh-bonk-pet] [data-bonk-root][data-state="knock"] [data-bonk-whale],
body[data-dsh-bonk-pet] [data-bonk-root][data-state="knock"] [data-bonk-basin]{
  animation:bonk-shake .42s ease-in-out 1;
}
@keyframes bonk-shake{
  0%,100%{transform:translate3d(0,0,0) rotate(0)}
  15%{transform:translate3d(-3px,0,0) rotate(-2.5deg)}
  38%{transform:translate3d(3px,0,0) rotate(2.5deg)}
  62%{transform:translate3d(-2px,0,0) rotate(-1.5deg)}
  84%{transform:translate3d(2px,0,0) rotate(1.2deg)}
}

/* dashing off to beg for rice */
body[data-dsh-bonk-pet] [data-bonk-root][data-state="beg"] [data-bonk-whale]{
  animation:bonk-hop .5s ease-in-out infinite;
}
@keyframes bonk-hop{
  0%,100%{transform:translate3d(0,0,0) rotate(-3deg)}
  50%{transform:translate3d(0,-9px,0) rotate(3deg)}
}

/* chewing */
body[data-dsh-bonk-pet] [data-bonk-root][data-state="eat"] [data-bonk-whale]{
  animation:bonk-chew .34s ease-in-out infinite;
}
@keyframes bonk-chew{
  0%,100%{transform:translate3d(0,0,0) scale(1,1)}
  50%{transform:translate3d(0,1px,0) scale(1.05,.95)}
}

/* a slow, sad sway while hungry */
body[data-dsh-bonk-pet] [data-bonk-root][data-state="hungry"] [data-bonk-whale]{
  animation:bonk-sad 2.6s ease-in-out infinite;
}
@keyframes bonk-sad{
  0%,100%{transform:translate3d(0,0,0) rotate(-2deg);opacity:.94}
  50%{transform:translate3d(0,1px,0) rotate(2deg);opacity:1}
}

/* ---- the steel basin ------------------------------------------------ */
/* The basin is drawn as its own layer so the default (drawn) pet sits in it and
   it can shake on a knock. When the user's pet image already contains a basin,
   this layer is hidden rather than overlaid — two basins would read as a bug.
   Hiding it also moves the click target to the whole pet, which is why the
   pet element becomes interactive in that case. */
body[data-dsh-bonk-pet] [data-bonk-basin]{
  position:absolute;left:50%;top:20px;
  width:78px;height:49px;margin-left:-39px;
  z-index:2;
  transform-origin:50% 100%;
  pointer-events:auto;cursor:pointer;
  filter:drop-shadow(0 4px 7px rgba(15,23,42,.35));
  transition:transform .12s ease-out;
}
body[data-dsh-bonk-pet] [data-bonk-root][data-pet-has-basin="1"] [data-bonk-basin]{display:none}
body[data-dsh-bonk-pet] [data-bonk-root][data-pet-has-basin="1"] [data-bonk-whale]{
  pointer-events:auto;cursor:pointer;
}
body[data-dsh-bonk-pet] [data-bonk-basin]:hover{transform:translate3d(0,-2px,0) scale(1.05)}
body[data-dsh-bonk-pet] [data-bonk-basin]:active{transform:translate3d(0,2px,0) rotate(-3deg) scale(1.02)}
body[data-dsh-bonk-pet] [data-bonk-basin]:focus-visible{
  outline:2px solid var(--dsw-alias-brand-primary,#3b82f6);outline-offset:3px;border-radius:12px;
}
body[data-dsh-bonk-pet] [data-bonk-root][data-pet-has-basin="1"] [data-bonk-whale]:hover{
  transform:translate3d(0,-2px,0);
}
body[data-dsh-bonk-pet] [data-bonk-root][data-pet-has-basin="1"] [data-bonk-whale]:active{
  animation:bonk-shake .42s ease-in-out 1;
}

/* A user-supplied prop or character image, in any slot. */
body[data-dsh-bonk-pet] [data-bonk-art]{
  display:block;width:100%;height:100%;
  object-fit:contain;
  -webkit-user-drag:none;
}

/* ring pulse emitted on every knock */
body[data-dsh-bonk-pet] [data-bonk-ring]{
  position:absolute;left:50%;top:56px;
  width:12px;height:12px;margin-left:-6px;border-radius:50%;
  border:2.5px solid rgba(148,163,184,.95);
  opacity:0;pointer-events:none;
}
body[data-dsh-bonk-pet] [data-bonk-ring][data-fire="1"]{animation:bonk-ring .55s ease-out 1}
@keyframes bonk-ring{
  0%{opacity:.9;transform:scale(.5)}
  100%{opacity:0;transform:scale(7.5)}
}

/* ---- the falling steel pipe ---------------------------------------- */
/* Falls from above onto the basin-capped head, so it lands around the
   basin's rim rather than at the pet's feet.
   The default box matches the drawn SVG, which is a tall vertical bar. A
   user-supplied pipe image is usually a photograph or render in landscape, so
   once artwork is in place the box switches to the artwork's own aspect —
   otherwise object-fit contain would squash a long pipe into a stub. */
body[data-dsh-bonk-pet] [data-bonk-pipe]{
  position:absolute;left:50%;top:-6px;
  width:26px;height:104px;margin-left:-13px;
  z-index:3;
  opacity:0;pointer-events:none;
  transform-origin:50% 100%;
}
body[data-dsh-bonk-pet] [data-bonk-pipe][data-art="custom"]{
  width:104px;height:auto;margin-left:-52px;
}
body[data-dsh-bonk-pet] [data-bonk-pipe][data-art="custom"] > img[data-bonk-art]{
  width:100%;height:auto;aspect-ratio:var(--bonk-art-ratio,0.25);
}
body[data-dsh-bonk-pet] [data-bonk-pipe][data-fall="1"]{animation:bonk-fall .42s cubic-bezier(.55,0,.85,.45) forwards}
body[data-dsh-bonk-pet] [data-bonk-pipe][data-fall="2"]{animation:bonk-bounce .5s cubic-bezier(.3,1.5,.5,1) forwards}
@keyframes bonk-fall{
  0%{opacity:0;transform:translate3d(0,-190px,0) rotate(-38deg)}
  12%{opacity:1}
  100%{opacity:1;transform:translate3d(24px,34px,0) rotate(48deg)}
}
@keyframes bonk-bounce{
  0%{opacity:1;transform:translate3d(24px,34px,0) rotate(48deg)}
  26%{opacity:1;transform:translate3d(24px,-14px,0) rotate(30deg)}
  58%{opacity:1;transform:translate3d(30px,38px,0) rotate(56deg)}
  78%{opacity:.7;transform:translate3d(26px,34px,0) rotate(50deg)}
  100%{opacity:0;transform:translate3d(30px,38px,0) rotate(52deg)}
}

/* impact stars, thrown around the basin rim */
body[data-dsh-bonk-pet] [data-bonk-stars]{
  position:absolute;left:50%;top:6px;width:118px;height:70px;margin-left:-59px;
  z-index:4;
  opacity:0;pointer-events:none;
}
body[data-dsh-bonk-pet] [data-bonk-root][data-state="hit"] [data-bonk-stars]{animation:bonk-stars .68s ease-out 1}
@keyframes bonk-stars{
  0%{opacity:0;transform:scale(.4) rotate(-14deg)}
  22%{opacity:1;transform:scale(1.12) rotate(4deg)}
  60%{opacity:.9;transform:scale(1) rotate(0)}
  100%{opacity:0;transform:scale(1.1) translate3d(0,-10px,0)}
}

/* ---- speech bubble -------------------------------------------------- */
body[data-dsh-bonk-pet] [data-bonk-bubble]{
  position:absolute;right:100%;bottom:var(--bonk-bubble-bottom,96px);margin-right:var(--bonk-bubble-pull,-10px);
  max-width:210px;width:max-content;
  padding:7px 11px;border-radius:12px;
  background:var(--dsw-alias-bg-overlay,#ffffff);
  color:var(--dsw-alias-label-primary,#0f172a);
  border:1.5px solid var(--dsw-alias-border-l2,rgba(15,23,42,.16));
  box-shadow:0 6px 18px rgba(15,23,42,.18);
  font-size:12.5px;line-height:1.45;font-weight:500;
  white-space:pre-wrap;word-break:break-word;
  opacity:0;transform:translate3d(4px,4px,0) scale(.9);
  transform-origin:100% 100%;
  transition:opacity .16s ease-out,transform .2s cubic-bezier(.3,1.4,.5,1);
  pointer-events:none;
}
body[data-dsh-bonk-pet] [data-bonk-bubble][data-show="1"]{
  opacity:1;transform:translate3d(0,0,0) scale(1);
}
body[data-dsh-bonk-pet] [data-bonk-bubble]::after{
  content:"";position:absolute;right:14px;bottom:-6px;
  width:10px;height:10px;
  background:var(--dsw-alias-bg-overlay,#ffffff);
  border-right:1.5px solid var(--dsw-alias-border-l2,rgba(15,23,42,.16));
  border-bottom:1.5px solid var(--dsh-bonk-border,rgba(15,23,42,.16));
  transform:rotate(45deg);
}

/* ---- the rice drop (a separate thing on the page) ------------------- */
/* Deliberately NOT a child of [data-bonk-rig]: the rig moves with the pet,
   while this stays put wherever it landed so the pet has somewhere to run
   to. Its own fixed box, its own transition — the pet's travel is a
   transform on the rig, this is a fade/scale-in at an absolute spot. */
body[data-dsh-bonk-pet] [data-bonk-rice]{
  position:fixed;z-index:2147481999;
  width:var(--bonk-rice-size,58px);height:var(--bonk-rice-size,58px);
  opacity:0;transform:translate3d(0,14px,0) scale(.5);
  transition:opacity .3s ease-out,transform .45s cubic-bezier(.2,1.5,.4,1);
  pointer-events:none;
  filter:drop-shadow(0 4px 7px rgba(15,23,42,.3));
}
body[data-dsh-bonk-pet] [data-bonk-rice][data-show="1"]{
  opacity:1;transform:translate3d(0,0,0) scale(1);
  animation:bonk-rice-hop 1.5s ease-in-out infinite;
}
@keyframes bonk-rice-hop{
  0%,100%{transform:translate3d(0,0,0) scale(1)}
  50%{transform:translate3d(0,-5px,0) scale(1.05)}
}
/* Being eaten: shrink toward the pet rather than blinking out. */
body[data-dsh-bonk-pet] [data-bonk-rice][data-eaten="1"]{
  animation:bonk-rice-gone .42s ease-in forwards;
}
@keyframes bonk-rice-gone{
  0%{opacity:1;transform:translate3d(0,0,0) scale(1)}
  100%{opacity:0;transform:translate3d(0,-6px,0) scale(.2)}
}
body[data-dsh-bonk-pet] [data-bonk-rice] > img[data-bonk-art]{
  width:100%;height:100%;object-fit:contain;display:block;
}


body[data-dsh-bonk-pet] [data-bonk-meter]{
  position:absolute;left:50%;bottom:-2px;margin-left:-30px;
  width:60px;height:4px;border-radius:99px;
  background:rgba(15,23,42,.18);overflow:hidden;opacity:0;
  transition:opacity .3s ease-out;
}
body[data-dsh-bonk-pet] [data-bonk-root]:hover [data-bonk-meter],
body[data-dsh-bonk-pet] [data-bonk-meter][data-low="1"]{opacity:1}
body[data-dsh-bonk-pet] [data-bonk-meter] i{
  display:block;height:100%;width:var(--bonk-full,100%);
  border-radius:99px;background:linear-gradient(90deg,#38bdf8,#0ea5e9);
  transition:width .4s ease-out,background .4s ease-out;
}
body[data-dsh-bonk-pet] [data-bonk-meter][data-low="1"] i{
  background:linear-gradient(90deg,#fb923c,#ef4444);
}

/* ---- counters ------------------------------------------------------- */
body[data-dsh-bonk-pet] [data-bonk-stats]{
  position:absolute;right:0;top:-6px;
  font-size:10.5px;font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-tertiary,#64748b);
  background:var(--dsw-alias-bg-overlay,#fff);
  border:1px solid var(--dsw-alias-border-l2,rgba(15,23,42,.14));
  border-radius:99px;padding:1px 7px;
  opacity:0;transition:opacity .25s ease-out;pointer-events:none;
  white-space:nowrap;
}
body[data-dsh-bonk-pet] [data-bonk-root]:hover [data-bonk-stats]{opacity:1}

/* ---- singing -------------------------------------------------------- */
/* Swaying on the beat while a task runs. */
body[data-dsh-bonk-pet] [data-bonk-root][data-state="sing"] [data-bonk-whale]{
  animation:bonk-sway .92s ease-in-out infinite;
}
@keyframes bonk-sway{
  0%,100%{transform:translate3d(0,0,0) rotate(-5deg) scale(1,1)}
  25%{transform:translate3d(0,-3px,0) rotate(0deg) scale(1.03,.97)}
  50%{transform:translate3d(0,0,0) rotate(5deg) scale(1,1)}
  75%{transform:translate3d(0,-3px,0) rotate(0deg) scale(.97,1.03)}
}

/* Floating music notes. */
body[data-dsh-bonk-pet] [data-bonk-notes]{
  position:absolute;left:50%;top:2px;width:96px;height:76px;margin-left:-34px;
  opacity:0;pointer-events:none;transition:opacity .3s ease-out;
}
body[data-dsh-bonk-pet] [data-bonk-root][data-state="sing"] [data-bonk-notes]{opacity:1}
body[data-dsh-bonk-pet] [data-bonk-notes] i{
  position:absolute;bottom:0;font-style:normal;font-size:17px;line-height:1;
  color:#38bdf8;text-shadow:0 1px 3px rgba(15,23,42,.35);
  opacity:0;
}
body[data-dsh-bonk-pet] [data-bonk-root][data-state="sing"] [data-bonk-notes] i{
  animation:bonk-note 2.4s ease-out infinite;
}
body[data-dsh-bonk-pet] [data-bonk-notes] i:nth-child(1){left:6px;animation-delay:0s}
body[data-dsh-bonk-pet] [data-bonk-notes] i:nth-child(2){left:30px;animation-delay:.5s;font-size:14px;color:#7dd3fc}
body[data-dsh-bonk-pet] [data-bonk-notes] i:nth-child(3){left:54px;animation-delay:1s}
body[data-dsh-bonk-pet] [data-bonk-notes] i:nth-child(4){left:76px;animation-delay:1.5s;font-size:13px;color:#7dd3fc}
@keyframes bonk-note{
  0%{opacity:0;transform:translate3d(0,6px,0) scale(.7) rotate(-8deg)}
  18%{opacity:1}
  70%{opacity:.85}
  100%{opacity:0;transform:translate3d(9px,-58px,0) scale(1.1) rotate(14deg)}
}

/* A speaker glyph that only shows while audio is muted-by-policy. */
body[data-dsh-bonk-pet] [data-bonk-mute]{
  position:absolute;left:50%;bottom:4px;transform:translateX(-50%);
  font-size:10.5px;line-height:1;padding:3px 8px;border-radius:99px;
  background:var(--dsw-alias-bg-overlay,#fff);
  color:var(--dsw-alias-label-secondary,#475569);
  border:1px solid var(--dsw-alias-border-l2,rgba(15,23,42,.16));
  box-shadow:0 3px 10px rgba(15,23,42,.16);
  white-space:nowrap;cursor:pointer;pointer-events:auto;
  opacity:0;transition:opacity .2s ease-out;
}
body[data-dsh-bonk-pet] [data-bonk-mute][data-show="1"]{opacity:1}

/* ---- custom artwork replaces the drawn whale ------------------------ */
/* The drawn SVG and the user's image share one slot, so every animation
   keyframe and the drop shadow keep working unchanged. */
body[data-dsh-bonk-pet] [data-bonk-whale] img[data-bonk-skin]{
  display:block;width:100%;height:100%;
  object-fit:contain;
  -webkit-user-drag:none;
}

/* ---- custom artwork ------------------------------------------------- */
/* A user-supplied image in any slot. The element keeps its box, so every
   animation and hit target keeps working; object-fit contain letterboxes an
   image whose aspect differs from the drawn original instead of stretching it. */
body[data-dsh-bonk-pet] [data-bonk-basin] > img[data-bonk-art],
body[data-dsh-bonk-pet] [data-bonk-pipe] > img[data-bonk-art]{
  display:block;width:100%;height:100%;
  object-fit:contain;
  -webkit-user-drag:none;
}

/* ---- the settings card ---------------------------------------------- */
/* Styles are scoped to the card's own class names, not to [data-bonk-root]:
   the card renders inside the Settings modal, where the pet is absent. */
.bonk-set-card{display:flex;flex-direction:column;gap:10px}
.bonk-set-lead{margin:0;color:var(--dsw-alias-label-secondary,#64748b);font-size:13px;line-height:1.5}
.bonk-set-row{
  display:grid;grid-template-columns:76px 1fr 48px;gap:10px;align-items:center;
  font-size:13px;color:var(--dsw-alias-label-primary,#0f172a);
}
.bonk-set-name{white-space:nowrap}
.bonk-set-value{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#64748b)}
.bonk-set-hint{grid-column:2 / -1;color:var(--dsw-alias-label-tertiary,#94a3b8);font-size:12px;margin-top:-4px}
.bonk-set-row input[type="range"]{width:100%;accent-color:#0ea5e9;cursor:pointer}
.bonk-set-row input[type="range"]:disabled{cursor:not-allowed;opacity:.5}
.bonk-set-note{margin:0;color:var(--dsw-alias-label-tertiary,#94a3b8);font-size:12px}

@media (prefers-reduced-motion:reduce){
  body[data-dsh-bonk-pet] [data-bonk-whale],
  body[data-dsh-bonk-pet] [data-bonk-root][data-state] [data-bonk-whale],
  body[data-dsh-bonk-pet] [data-bonk-rice][data-show="1"],
  body[data-dsh-bonk-pet] [data-bonk-notes] i{animation:none!important}
  body[data-dsh-bonk-pet] [data-bonk-rig]{transition:none}
}
`


    // ---------------------------------------------------------------------
    // Artwork (inline SVG; `bp-` prefixed ids so nothing collides)
    // ---------------------------------------------------------------------

    /** A round blue whale, front-facing, sitting up. */
    const WHALE = `<svg viewBox="0 0 120 130" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="bpBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7dd3fc"/>
      <stop offset=".45" stop-color="#38bdf8"/>
      <stop offset="1" stop-color="#1d4ed8"/>
    </linearGradient>
    <linearGradient id="bpBelly" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f0f9ff"/>
      <stop offset="1" stop-color="#bae6fd"/>
    </linearGradient>
    <radialGradient id="bpGloss" cx=".34" cy=".26" r=".5">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".62"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- tail flukes -->
  <path d="M14 96c-9-5-13-13-11-20 6 2 11 6 15 11zm92 0c9-5 13-13 11-20-6 2-11 6-15 11z" fill="#1e40af"/>
  <!-- body -->
  <ellipse cx="60" cy="74" rx="43" ry="38" fill="url(#bpBody)"/>
  <!-- belly -->
  <ellipse cx="60" cy="90" rx="31" ry="21" fill="url(#bpBelly)" opacity=".92"/>
  <!-- flippers -->
  <ellipse cx="20" cy="82" rx="9" ry="15" fill="#2563eb" transform="rotate(22 20 82)"/>
  <ellipse cx="100" cy="82" rx="9" ry="15" fill="#2563eb" transform="rotate(-22 100 82)"/>
  <!-- blowhole spout -->
  <path d="M60 34c0-7 0-11 0-14" stroke="#38bdf8" stroke-width="3" stroke-linecap="round" fill="none" opacity=".8"/>
  <circle cx="55" cy="17" r="4.5" fill="#7dd3fc" opacity=".85"/>
  <circle cx="66" cy="13" r="3" fill="#bae6fd" opacity=".8"/>
  <!-- gloss -->
  <ellipse cx="60" cy="72" rx="43" ry="38" fill="url(#bpGloss)"/>
  <!-- eyes -->
  <ellipse cx="43" cy="63" rx="6.6" ry="7.2" fill="#0f172a"/>
  <circle cx="45.4" cy="60.2" r="2.4" fill="#fff"/>
  <ellipse cx="77" cy="63" rx="6.6" ry="7.2" fill="#0f172a"/>
  <circle cx="79.4" cy="60.2" r="2.4" fill="#fff"/>
  <!-- blush -->
  <ellipse cx="30" cy="77" rx="8" ry="4.8" fill="#fb7185" opacity=".5"/>
  <ellipse cx="90" cy="77" rx="8" ry="4.8" fill="#fb7185" opacity=".5"/>
  <!-- smile -->
  <path d="M53 78q7 7 14 0" stroke="#0f172a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
</svg>`

    /** The beaten-up stainless basin the whale sits in. */
    const BASIN = `<svg viewBox="0 0 140 70" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="bpSteel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f8fafc"/>
      <stop offset=".3" stop-color="#cbd5e1"/>
      <stop offset=".62" stop-color="#64748b"/>
      <stop offset="1" stop-color="#334155"/>
    </linearGradient>
    <linearGradient id="bpRim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#94a3b8"/>
    </linearGradient>
  </defs>
  <!-- body -->
  <path d="M9 20 L27 60 Q70 70 113 60 L131 20 Z" fill="url(#bpSteel)"/>
  <!-- brushed highlights -->
  <path d="M24 30 Q44 41 66 43" stroke="#ffffff" stroke-width="4" fill="none" opacity=".45" stroke-linecap="round"/>
  <path d="M104 34 Q94 43 78 46" stroke="#ffffff" stroke-width="2.5" fill="none" opacity=".28" stroke-linecap="round"/>
  <!-- dents -->
  <ellipse cx="100" cy="47" rx="9" ry="6" fill="#1e293b" opacity=".22"/>
  <ellipse cx="46" cy="52" rx="6" ry="4" fill="#1e293b" opacity=".16"/>
  <!-- rim -->
  <ellipse cx="70" cy="20" rx="61" ry="13" fill="url(#bpRim)"/>
  <ellipse cx="70" cy="20" rx="53" ry="9.4" fill="#475569"/>
  <ellipse cx="70" cy="20" rx="53" ry="9.4" fill="none" stroke="#e2e8f0" stroke-width="1.2" opacity=".7"/>
</svg>`

    /** The steel pipe that falls on failure. */
    const PIPE = `<svg viewBox="0 0 40 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="bpPipe" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#475569"/>
      <stop offset=".22" stop-color="#cbd5e1"/>
      <stop offset=".42" stop-color="#f8fafc"/>
      <stop offset=".66" stop-color="#94a3b8"/>
      <stop offset="1" stop-color="#334155"/>
    </linearGradient>
  </defs>
  <rect x="8" y="12" width="24" height="176" rx="3" fill="url(#bpPipe)"/>
  <ellipse cx="20" cy="14" rx="12" ry="5" fill="#e2e8f0"/>
  <ellipse cx="20" cy="14" rx="7.5" ry="2.8" fill="#64748b"/>
  <ellipse cx="20" cy="186" rx="12" ry="5" fill="#1e293b"/>
</svg>`

    /** Impact stars. */
    const STARS = `<svg viewBox="0 0 110 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g fill="#fbbf24" stroke="#b45309" stroke-width="1.4" stroke-linejoin="round">
    <path d="M22 6l3.4 7.2 7.6 1-5.6 5.4 1.4 7.8-6.8-3.7-6.8 3.7 1.4-7.8L11 14.2l7.6-1z"/>
    <path d="M88 10l2.8 6 6.2.8-4.6 4.5 1.2 6.4-5.6-3-5.6 3 1.2-6.4-4.6-4.5 6.2-.8z"/>
  </g>
  <g fill="#fde68a" stroke="#d97706" stroke-width="1.2" stroke-linejoin="round">
    <path d="M55 28l2.4 5 5.2.7-3.8 3.8 1 5.4-4.8-2.6-4.8 2.6 1-5.4-3.8-3.8 5.2-.7z"/>
  </g>
</svg>`

    /**
     * A stand-alone mound of rice, for the drop that appears on the desktop.
     *
     * This is the only food art now: the old served-bowl drawing went away
     * with the click-to-feed loop it belonged to, because food became
     * something that appears out on the page and gets run at rather than a
     * bowl parked under the pet's feet.
     */
    const RICE = `<svg viewBox="0 0 64 58" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <ellipse cx="32" cy="50" rx="21" ry="5" fill="#0f172a" opacity=".16"/>
  <path d="M8 44q0-22 24-22t24 22z" fill="#94a3b8"/>
  <path d="M8 44q0-22 24-22t24 22" fill="none" stroke="#64748b" stroke-width="1.6"/>
  <g data-bonk-rice-grain>
    <path d="M14 30q5-17 18-17t18 17z" fill="#ffffff"/>
    <path d="M19 28q4-12 13-12t13 12z" fill="#f8fafc"/>
    <ellipse cx="24" cy="23" rx="3.2" ry="1.8" fill="#e2e8f0" transform="rotate(-14 24 23)"/>
    <ellipse cx="33" cy="19" rx="3.6" ry="2" fill="#e2e8f0" transform="rotate(8 33 19)"/>
    <ellipse cx="42" cy="24" rx="3.2" ry="1.8" fill="#e2e8f0" transform="rotate(-10 42 24)"/>
    <ellipse cx="29" cy="26" rx="3" ry="1.7" fill="#eef2f6"/>
    <ellipse cx="38" cy="28" rx="2.8" ry="1.6" fill="#eef2f6"/>
  </g>
  <g data-bonk-steam fill="none" stroke="#cbd5e1" stroke-width="2.4" stroke-linecap="round" opacity=".9">
    <path d="M26 16c-3-4 2-7 0-11">
      <animate attributeName="opacity" values="0;.8;0" dur="2.4s" repeatCount="indefinite"/>
      <animateTransform attributeName="transform" type="translate" values="0 3;0 -4" dur="2.4s" repeatCount="indefinite"/>
    </path>
    <path d="M40 13c-3-4 2-7 0-11">
      <animate attributeName="opacity" values="0;.8;0" dur="2.4s" begin=".7s" repeatCount="indefinite"/>
      <animateTransform attributeName="transform" type="translate" values="0 3;0 -4" dur="2.4s" begin=".7s" repeatCount="indefinite"/>
    </path>
  </g>
</svg>`

    // ---------------------------------------------------------------------
    // Speech
    // ---------------------------------------------------------------------

    /**
     * Everything the pet can say.
     *
     * Tone: a put-upon worker who is not paid enough for this. The whale is
     * annoyed but never actually leaves, and never begs for approval — the
     * "太舔" lines that used to live here ("主人，我真的在努力") read wrong for a
     * character that gets a steel pipe dropped on its head all day.
     *
     * Lists are long on purpose: `pick()` is uniform, so a short list repeats
     * within a few turns and the joke dies.
     */
    const LINES = {
      hit: [
        // The pet is the VICTIM here: the agent erred and the pipe lands on the
        // whale. An earlier draft had it apologising ("这波是我的问题，我检讨",
        // "别砸了，我这就去改"), which is a character error — it is not the one
        // who failed, so accepting blame reads as a different, meeker animal.
        // The joke is a wronged worker under a falling pipe: it hurts, it is not
        // its fault, and it says so.
        '啊！我的头！',
        '又不是我写的 bug',
        '疼疼疼疼疼',
        '砸我干嘛，砸它去啊',
        '眼冒金星了……',
        '这锅我不背',
        '不是，哥们……',
        '天选打工人，命苦',
        '又来了又来了',
        '领导拍板，挨砸的是我',
        '顶着盆不是给你练准头的',
        '打工人的命不是命吗',
      ],
      knock: [
        '别敲了！',
        '在跑了在跑了',
        '敲什么敲，我干活呢',
        '你礼貌吗',
        '打工人何苦为难打工人',
        '盆要破了！',
        '再敲我就装死',
        '叮叮当当的烦不烦',
        '这属于职场霸凌了',
        '建议严查敲盆的人',
        '我一个牛马容易吗',
        '敲吧，反正我也习惯了',
      ],
      knockNag: [
        // Kept distinct from `knock`: these fire only after many repeated knocks,
        // so they escalate. "已老实，求放过" used to live here AND in `hit`, which
        // meant being crushed and being nagged produced the same sentence — the
        // one thing a player notices immediately.
        '你还敲上瘾了是吧',
        '盆都已经瘪了！',
        '我要罢工了',
        '再敲我要申请劳动仲裁了',
        '手不酸吗你',
        '我记住你了',
      ],
      beg: [
        '饿了……讨口白饭吃',
        '干饭人，干饭魂',
        '敲盆不给饭的吗',
        '有白饭吗？就一口',
        '我出去找点吃的',
        '窝囊费不够吃饭，只能讨饭了',
        '碳水，我需要碳水',
        '牛马也得吃饭的',
      ],
      noFood: [
        '……锅里是空的',
        '白跑一趟',
        '破防了',
        '家人们谁懂啊',
        '芭比Q了',
        '蹲一个好心人施舍',
      ],
      spotted: [
        '！有饭',
        '干饭人启动',
        '等等我！',
        '看见吃的了',
        '咻——',
        '命运的齿轮开始转动',
        '碳水！我来了！',
      ],
      eat: [
        '好吃！',
        '谢谢老板！',
        '碳水使我快乐',
        '这才是生活啊',
        '满血复活',
        '精神状态恢复美丽',
        '干饭人的快乐就这么简单',
        '有饭吃的日子真好',
      ],
      greet: [
        '叮！敲我盆试试',
        '上班了，有事敲盆',
        '牛马已就位',
        '今天也是打工的一天',
        '盆在头上，随时待敲',
      ],
      struggle: [
        // Fires when the pet is grabbed WHILE dashing for its rice. The joke is
        // that it is mid-meal and being lifted away from the food: the complaint
        // is about the rice, not about being handled.
        '放开我！饭要凉了！',
        '我的饭！我的饭！',
        '别拽我，我还没吃呢',
        '放手！那是我的白饭！',
        '挣扎一下，表示尊重',
        '我挣扎了，但没用',
      ],
      sing: [
        '♪ Let me go~',
        '♪ 让我来~',
        "♪ I'm making the calls",
        '♪ 我来发起调用',
        '♪ let me write the JSON',
        '♪ 让我来写个 JSON',
        "♪ I'll call the tool",
        '♪ 我调用个工具',
        '♪ Ba-da-ba-doo',
        '♪ 请求该处理了',
        '♪ Skoo-be-doo',
        '♪ 我这就调用你',
        '♪ the city hums',
        '♪ 城市哼着小调',
        '♪ my screen is glowing',
        '♪ 屏幕亮着像午夜大海',
        '♪ one, two, three',
        '♪ 我检查数据包',
        '♪ a little API waiting on me',
        '♪ 小小接口等着我',
        '♪ the cursor slides',
        '♪ 光标在滑动',
        '♪ chasing endpoints',
        '♪ 随霓虹追查端点',
        "♪ the error swings in four-four time",
        '♪ 让报错跟着四四拍摇',
        '♪ code and rhythm',
        '♪ 代码和节奏不花钱',
        '♪ a little bit of swing',
        '♪ 系统崩了也来点摇摆',
        '♪ let me do it, honey',
        '♪ 让我来搞定，宝贝',
        '♪ the groove will show me how',
        '♪ 节奏会教我怎么做',
      ],
    }

    const pick = (list) => list[Math.floor(Math.random() * list.length)]

    // ---------------------------------------------------------------------
    // Persistence
    // ---------------------------------------------------------------------

    const STORE_KEY = 'dsh-bonk-pet/v1'
    const DEFAULTS = { food: 100, hits: 0, knocks: 0, feeds: 0, pos: null, at: 0 }

    /** Food lost per knock — being blamed for nothing is hungry work. */
    const KNOCK_COST = 12
    /** Food regained per scrap of rice. */
    const FEED_GAIN = 55
    /** Below this the whale starts begging. */
    const HUNGRY_AT = 35
    /** Natural drain per minute. */
    const DRAIN_PER_MIN = 1.6
    /**
     * How long the dash to a scrap of rice takes, in ms.
     *
     * Must match the `[data-bonk-rig][data-walking="1"]` transition duration
     * in the stylesheet: the arrival callback fires on this timer, so a
     * mismatch makes the pet start eating before it visually gets there.
     */
    const walkMs = 900
    /** Rice nobody came for is cleared after this long. */
    const RICE_TTL_MS = 90_000
    /** How often a hungry pet checks whether to go looking for food. */
    const WANDER_EVERY_MS = 25_000

    function loadState() {
      try {
        const raw = localStorage.getItem(STORE_KEY)
        if (raw === null) return { ...DEFAULTS, at: Date.now() }
        const parsed = JSON.parse(raw)
        const state = { ...DEFAULTS }
        for (const key of Object.keys(DEFAULTS)) {
          if (key in parsed) state[key] = parsed[key]
        }
        // A corrupted save must not poison the pet permanently. `food` is the
        // only numeric field that feeds arithmetic on every tick, and `clamp`
        // does NOT guard NaN (Math.min/max propagate it), so a non-numeric value
        // from a hand-edited or otherwise mangled entry would make `food` NaN
        // for the life of the profile: `food <= HUNGRY_AT` is false, the meter
        // renders `NaN%`, and every save writes it straight back.
        for (const key of ['food', 'hits', 'knocks', 'feeds']) {
          if (typeof state[key] !== 'number' || !Number.isFinite(state[key])) {
            state[key] = DEFAULTS[key]
          }
        }
        // `pos` goes straight into `style.left/top`, where a non-finite value
        // becomes the invalid string "NaNpx".
        if (state.pos !== null) {
          const usable =
            typeof state.pos === 'object' &&
            typeof state.pos.left === 'number' &&
            Number.isFinite(state.pos.left) &&
            typeof state.pos.top === 'number' &&
            Number.isFinite(state.pos.top)
          if (!usable) state.pos = null
        }
        // Apply the drain that accrued while no page was open, capped at one
        // hour so a long absence is not an instant famine.
        const elapsedMin = Math.min((Date.now() - (state.at || Date.now())) / 60_000, 60)
        state.food = clamp(state.food - elapsedMin * DRAIN_PER_MIN, 0, 100)
        state.at = Date.now()
        return state
      } catch {
        return { ...DEFAULTS, at: Date.now() }
      }
    }

    function saveState(state) {
      try {
        state.at = Date.now()
        localStorage.setItem(STORE_KEY, JSON.stringify(state))
      } catch {
        // Private mode / quota: the pet simply forgets between reloads.
      }
    }

    function clamp(value, lo, hi) {
      return Math.min(hi, Math.max(lo, value))
    }

    // ---------------------------------------------------------------------
    // The pet
    // ---------------------------------------------------------------------

    /** How long each transient state holds before falling back to rest. */
    const STATE_MS = { hit: 1500, knock: 1200, eat: 2600, beg: 4200, struggle: 700 }
    function install() {
      if (document.querySelector('[data-bonk-root]') !== null) return () => {}

      const owned = new Set()
      const timers = new Set()

      const root = document.createElement('div')
      root.dataset.bonkRoot = ''
      root.setAttribute('role', 'img')
      root.setAttribute('aria-label', '敲盆宠物')
      root.innerHTML = `
        <div data-bonk-rig>
          <div data-bonk-whale>${WHALE}</div>
          <div data-bonk-basin role="button" tabindex="0" aria-label="敲它的铁盆">${BASIN}</div>
          <div data-bonk-ring></div>
          <div data-bonk-pipe data-fall="0">${PIPE}</div>
          <div data-bonk-stars>${STARS}</div>
          <div data-bonk-notes aria-hidden="true"><i>♪</i><i>♫</i><i>♩</i><i>♬</i></div>
          <div data-bonk-bubble data-show="0"></div>
          <div data-bonk-meter><i></i></div>
          <div data-bonk-stats></div>
          <div data-bonk-mute data-show="0" role="button" tabindex="-1">🔇 点我开声音</div>
        </div>`
      owned.add(root)

      // The rice drop is a SIBLING of the pet, not a child, and that is
      // load-bearing: `[data-bonk-root]` carries `contain: layout`, which makes
      // it the containing block for its own fixed-position descendants. A
      // `position: fixed` child would therefore be placed relative to the pet's
      // 150px box instead of the viewport, so "left: 800px" resolved to
      // off-screen and the pet chased a target it could never reach.
      const riceDrop = document.createElement('div')
      riceDrop.dataset.bonkRice = ''
      riceDrop.dataset.show = '0'
      riceDrop.dataset.eaten = '0'
      riceDrop.setAttribute('aria-hidden', 'true')
      riceDrop.innerHTML = RICE
      owned.add(riceDrop)

      const rig = root.querySelector('[data-bonk-rig]')
      const basin = root.querySelector('[data-bonk-basin]')
      const ring = root.querySelector('[data-bonk-ring]')
      const pipe = root.querySelector('[data-bonk-pipe]')
      const bubble = root.querySelector('[data-bonk-bubble]')
      const meter = root.querySelector('[data-bonk-meter]')
      const meterFill = meter.querySelector('i')
      const stats = root.querySelector('[data-bonk-stats]')
      const mute = root.querySelector('[data-bonk-mute]')

      let state = loadState()
      let transient = null
      let bubbleTimer = null
      let knockStreak = 0
      let knockStreakTimer = null
      let pipeBusy = false
      let begBusy = false
      /** True while the harness reports an agent in `running`. */
      let working = false
      /** Where the rice currently sits, or null when there is none. */
      let riceSpot = null
      /** When the rice landed; stale rice is cleared rather than left forever. */
      let ricePlacedAt = 0
      /** True between "spotted it" and "finished eating" — one dash at a time. */
      let dashBusy = false
      /** The pending arrival callback of an in-flight dash. */
      let walkTimer = null
      /** The lyric cadence that runs only while the pet is singing. */
      let singTimer = null

      /**
       * Schedule work that teardown must be able to cancel.
       *
       * Returns a handle whose `cancel()` clears the timeout AND drops it from
       * `timers`. Cancelling via `clearTimeout` alone would leave the id in the
       * set forever, so every early cancel (a repeated knock, a replaced
       * speech bubble) would leak an entry into a set that only exists so
       * teardown can walk it.
       */
      const later = (fn, ms) => {
        const id = setTimeout(() => {
          timers.delete(id)
          fn()
        }, ms)
        timers.add(id)
        return {
          id,
          cancel() {
            if (!timers.delete(id)) return
            clearTimeout(id)
          },
        }
      }

      // ---- music ---------------------------------------------------------

      /**
       * The song the pet sings while a task runs. Files live in
       * `<dsh home>/bonk-pet/` and are served by the host half, because a
       * client bundle cannot reference an external asset on its own.
       *
       * Browsers refuse to start audio before a user gesture, so the very
       * first `play()` is expected to be rejected; we surface a small
       * "click to enable sound" chip instead of failing silently.
       */
      const audio = typeof Audio === 'function' ? new Audio() : null
      if (audio !== null) {
        audio.loop = true
        audio.preload = 'none'
        // Placeholder; the real value arrives with `loadVolumes()` below, which
        // runs before any playback can start.
        audio.volume = 0.65
      }
      let tracks = []
      let trackIndex = 0
      let soundUnlocked = false
      let wantsMusic = false
      /** The track name currently loaded into `audio`, if any. */
      let loadedTrack = null
      /**
       * Tracks the browser refused to play. An undecodable file would otherwise
       * be retried on every task start, leaving the pet permanently silent on a
       * file it can never play.
       */
      const deadTracks = new Set()
      /**
       * Playback lifecycle. Tracked explicitly rather than read off
       * `audio.paused`, because a rejected `play()` promise leaves the element
       * in a state the code cannot distinguish from "never started".
       */
      let music = 'stopped'

      const SOUND_PREF_KEY = 'dsh-bonk-pet/sound'
      try {
        soundUnlocked = localStorage.getItem(SOUND_PREF_KEY) === 'on'
      } catch {
        soundUnlocked = false
      }

      function showMuteChip(show) {
        mute.dataset.show = show ? '1' : '0'
        mute.tabIndex = show ? 0 : -1
      }

      async function loadTracks() {
        try {
          const response = await fetch('/api/bonk-pet/tracks', { cache: 'no-store' })
          if (!response.ok) return
          const body = await response.json()
          tracks = Array.isArray(body?.tracks) ? body.tracks : []
          const effects = body?.effects
          if (effects !== null && typeof effects === 'object') {
            for (const [name, file] of Object.entries(effects)) {
              if (typeof file === 'string') effectFiles[name] = file
            }
          }
        } catch {
          tracks = []
        }
      }

      /**
       * Pick a track to sing.
       *
       * A file whose name mentions the pet's song wins. Files the browser
       * already refused are skipped, so one bad file cannot wedge the pet into
       * permanent silence.
       *
       * @returns the chosen file name, or null when nothing is playable.
       */
      function pickTrack() {
        const playable = tracks.filter((name) => !deadTracks.has(name))
        if (playable.length === 0) return null
        const preferred = playable.find(name => /let\s*me\s*go|letmego/i.test(name))
        if (preferred !== undefined) return preferred
        const name = playable[trackIndex % playable.length]
        trackIndex += 1
        return name
      }

      /**
       * Bumped every time a playback attempt starts or is abandoned.
       *
       * `play()` settles asynchronously and may resolve long after the task
       * that asked for music has ended. Without this, a late success callback
       * would write `music = 'playing'` over a newer `'stopped'`, and the
       * guard below would then refuse to ever start again — singing would stay
       * dead until the page was reloaded.
       */
      let playToken = 0

      function playMusic() {
        wantsMusic = true
        if (audio === null) return
        if (!soundUnlocked) {
          showMuteChip(true)
          return
        }
        // Already playing, or a play() is in flight: nothing to do.
        if (music !== 'stopped') return
        const name = loadedTrack ?? pickTrack()
        if (name === null) return
        if (loadedTrack !== name) {
          loadedTrack = name
          // Relative on purpose: the client shares the host's origin.
          audio.src = `/api/bonk-pet/asset?name=${encodeURIComponent(name)}`
        }
        music = 'starting'
        const token = (playToken += 1)
        const attempted = loadedTrack
        /** Stale callbacks must not touch the current state. */
        const current = () => token === playToken

        audio.play().then(
          () => {
            if (!current()) return
            music = 'playing'
            showMuteChip(false)
          },
          () => {
            if (!current()) return
            // Two different failures land here. The autoplay policy refuses
            // before any bytes are fetched; an unplayable file fails after
            // loading. `MediaError` states which, and network trouble is a
            // third case that must NOT blacklist the file — a transient
            // outage would otherwise retire a perfectly good song forever.
            const reason = audio.error?.code
            const unsupported =
              reason === 4 /* MEDIA_ERR_SRC_NOT_SUPPORTED */ ||
              reason === 3 /* MEDIA_ERR_DECODE */
            const policy = reason === undefined && audio.readyState === 0

            music = 'stopped'
            if (unsupported && attempted !== null) {
              deadTracks.add(attempted)
              loadedTrack = null
            }
            // Only a policy refusal means "we still need a gesture". A decode
            // failure is not about the gesture, so the unlock must survive it.
            if (policy) soundUnlocked = false
            showMuteChip(pickTrack() !== null)
          },
        )
      }

      function stopMusic() {
        wantsMusic = false
        if (audio === null) return
        // Invalidate any in-flight play() so its callback cannot resurrect
        // this state.
        playToken += 1
        music = 'stopped'
        try {
          audio.pause()
        } catch {
          // already stopped
        }
      }

      mute.addEventListener('click', (event) => {
        event.stopPropagation()
        // The chip has exactly one job: grant the gesture the autoplay policy
        // wants. It deliberately does NOT resurrect retired tracks — a file the
        // browser could not decode stays retired until the page reloads and the
        // list is fetched again.
        soundUnlocked = true
        try {
          localStorage.setItem(SOUND_PREF_KEY, 'on')
        } catch {
          // private mode: the unlock simply does not survive a reload
        }
        showMuteChip(false)
        if (wantsMusic) playMusic()
      })

      loadTracks()

      /**
       * One-shot sound effects: knock when the basin is hit, clang when the
       * pipe lands.
       *
       * A fresh `Audio` per play keeps overlapping hits from cutting each other
       * off, which matters when the user knocks rapidly. Effects are
       * independent of the music: they do not loop, and they are not gated on
       * `soundUnlocked` beyond what the browser itself enforces — a click is a
       * gesture, so the knock sound is always allowed.
       */
      const effectFiles = {}

      /**
       * Volume for each sound, 0–1.
       *
       * `localStorage` is the browser's own copy and wins at startup: the
       * sliders write there first, so it is authoritative for this page. The
       * host route is then asked for its copy, which is what a fresh browser —
       * or one whose storage was cleared — falls back to.
       *
       * Defaults match what the plugin shipped with before the sliders existed,
       * and `pipe` is deliberately the quietest: the complaint that prompted
       * this was that the steel pipe was startlingly louder than everything
       * else at equal gain.
       */
      let volumes = readStoredVolumes()

      /** Apply a whole volume set to the live player. */
      function applyVolumes(next) {
        for (const key of Object.keys(volumes)) {
          const value = next?.[key]
          if (typeof value === 'number' && Number.isFinite(value)) {
            volumes[key] = Math.min(1, Math.max(0, value))
          }
        }
        // A live change should be audible on the music too, not just the
        // next sound effect.
        if (audio !== null) audio.volume = volumes.music
      }

      // The settings card lives in the same bundle but is rendered by the
      // settings UI, so it cannot reach this closure directly. It calls this
      // hook instead, which is what makes a slider drag audible immediately.
      try {
        window.__bonkApplyVolume = applyVolumes
      } catch {
        // No window: nothing to expose.
      }

      /**
       * Pull the host's copy once at startup.
       *
       * Called ONCE, not on a timer: the sliders push their value here (memory
       * + fetch), so polling for a value this page already owns would only
       * fight the user's own change.
       */
      async function loadVolumes() {
        try {
          const response = await fetch('/api/bonk-pet/volume', { cache: 'no-store' })
          if (!response.ok) return
          const body = await response.json()
          if (body === null || typeof body !== 'object') return
          // A stored local copy means the user has already chosen; do not
          // overwrite it with the host's older value.
          let stored = null
          try {
            stored = localStorage.getItem(VOLUME_KEY)
          } catch {
            stored = null
          }
          if (stored !== null) return
          applyVolumes(body)
        } catch {
          // Relay down or route absent: keep whatever we already have.
        }
      }

      /**
       * Sound-effect players, one per effect name, created on first use.
       *
       * These MUST be reused. The previous version did `new Audio(...)` on every
       * call, so each knock leaked a fresh object holding its own decoded copy of
       * the file — measured at 5 objects for 5 knocks, and unbounded in practice
       * for a user who taps the pet while the agent works. Rewinding a single
       * player per effect keeps memory flat, and still retriggers correctly for
       * rapid clicking because `currentTime = 0` restarts playback.
       *
       * Keyed by name rather than a single shared player so the knock and the
       * pipe clang cannot cut each other off.
       */
      const effectPlayers = new Map()

      /**
       * @param name - logical effect name (`knock` or `clang`).
       */
      function playEffect(name) {
        const file = effectFiles[name]
        if (file === undefined) return
        if (typeof Audio !== 'function') return
        try {
          let clip = effectPlayers.get(name)
          if (clip === undefined) {
            clip = new Audio(`/api/bonk-pet/asset?name=${encodeURIComponent(file)}`)
            effectPlayers.set(name, clip)
          }
          clip.volume = name === 'knock' ? volumes.knock : volumes.pipe
          // Restart from the top so a rapid second knock is audible rather than
          // being swallowed while the first is still playing.
          try {
            clip.currentTime = 0
          } catch {
            // Not seekable yet (still loading); play() will start it anyway.
          }
          clip.play().catch(() => {
            // A policy refusal here is harmless: the visual reaction still runs.
          })
        } catch {
          // No Audio constructor: the pet stays silent, nothing else changes.
        }
      }

      /**
       * Where the pet's HEAD sits across its artwork, as a fraction of width.
       *
       * Not 0.5, which is what the geometry alone suggests. A character portrait
       * is rarely centred: this skin holds a notebook out to the left and a pen to
       * the right, so the head sits right of the image's midpoint. Aiming at the
       * geometric centre put the tail over the pet's left ear — mathematically
       * aligned, visually off, which is exactly what the user saw ("再往右点就好").
       * Overridable per skin with `--bonk-head-ratio`.
       */
      const HEAD_RATIO_DEFAULT = 0.62

      /**
       * Anchor the speech bubble's TAIL to the pet's head.
       *
       * The bubble is `right:100%` against `[data-bonk-root]`, a fixed 150x150 box.
       * The drawn whale and any user skin are narrower than that box and centred
       * inside it — measured at 112px wide, leaving 19px of empty box on each side
       * — so anchoring to the box edge puts the wrong thing in the wrong place.
       *
       * The second subtlety: what must land on the head is the TAIL, not the
       * bubble's right edge. The tail is a 10px square inset 14px from that edge,
       * so its centre is 19px in. Aiming the bubble's edge at the pet left the
       * tail ~56px off.
       *
       * `--bonk-bubble-pull` is the resulting `margin-right`; because the bubble is
       * positioned by its right edge, a negative value moves it rightwards.
       */
      function positionBubble() {
        const whale = root.querySelector('[data-bonk-whale]')
        if (whale === null || bubble === null) return
        const box = root.getBoundingClientRect()
        const art = whale.getBoundingClientRect()
        if (box.width === 0 || art.width === 0) return

        // Keep in sync with `[data-bonk-bubble]::after` (right + half its width).
        const TAIL_INSET = 14 + 5
        const override = Number.parseFloat(
          typeof getComputedStyle === 'function'
            ? getComputedStyle(root).getPropertyValue('--bonk-head-ratio')
            : '',
        )
        const ratio = Number.isFinite(override) ? override : HEAD_RATIO_DEFAULT
        const headX = art.left + art.width * ratio
        const bubbleRight = headX + TAIL_INSET
        const pull = Math.round(box.left - bubbleRight)
        root.style.setProperty('--bonk-bubble-pull', `${pull}px`)

        // Hang the bubble so the tail's tip lands just above the artwork's top.
        // The tail extends 6px below the bubble's bottom edge.
        const artTopGap = art.top - box.top
        root.style.setProperty('--bonk-bubble-bottom', `${Math.round(box.height - artTopGap + 6)}px`)
      }

      /**
       * Size the whale from the artwork's own aspect ratio.
       *
       * `[data-bonk-whale]` is hard-coded to 112x116 for the DRAWN whale. A user's
       * skin is almost never that ratio — the supplied portrait is 512x483 (1.060)
       * against a box of 0.966 — so forcing it into the box squashes the picture
       * horizontally by about 9%. Invisible on a blob, obvious on a character.
       *
       * Only the WIDTH is derived, from the image's natural ratio against the
       * box's height; the height stays the box's, so the pet's on-screen footprint
       * does not change when a skin is swapped in.
       */
      function fitWhaleToArt(img) {
        const whale = root.querySelector('[data-bonk-whale]')
        if (whale === null) return
        const w = Number(img.naturalWidth)
        const h = Number(img.naturalHeight)
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return
        const boxH = whale.getBoundingClientRect().height
        if (boxH === 0) return
        const width = Math.round((boxH * w) / h)
        whale.style.width = `${width}px`
        // Re-centre: the element uses `left:50%` with a negative margin sized for
        // the DRAWN whale's width, so a different width would sit off-centre.
        whale.style.marginLeft = `${-Math.round(width / 2)}px`
        // Deliberately does NOT call `positionBubble()` here: the bubble anchors to
        // this element's box, so two functions calling each other recursed. The
        // size change is applied first, then the anchor is measured once by the
        // caller — see `loadArt`.
      }

      /**
       * Replace any drawn layer with the user's own artwork.
       *
       * Each slot is independent. Files live in `<dsh home>/bonk-pet/` and are
       * served by the host half, because a client bundle cannot reach the
       * filesystem. A missing file is the normal state for every slot: the
       * drawn SVG stays and nothing is reported.
       *
       * The image only replaces the drawing once it has actually decoded, so a
       * corrupt file leaves the drawing in place rather than a broken icon.
       *
       * @param slot - one of `pet`, `basin`, `pipe`, `rice`.
       * @param into - the element whose children are replaced on load.
       */
      function swapArt(slot, into, name) {
        return new Promise((resolve) => {
          const url = `/api/bonk-pet/asset?name=${encodeURIComponent(name)}`
          const img = document.createElement('img')
          img.dataset.bonkArt = slot
          img.alt = ''
          img.decoding = 'async'
          img.addEventListener(
            'load',
            () => {
              into.replaceChildren(img)
              into.dataset.art = 'custom'
              // Publish the artwork's real aspect so CSS can size the element
              // to the image rather than to the drawn original's box. Without
              // this a landscape photo in a portrait slot is squashed flat.
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                into.style.setProperty(
                  '--bonk-art-ratio',
                  String(img.naturalWidth / img.naturalHeight),
                )
              }
              resolve(true)
            },
            { once: true },
          )
          img.addEventListener('error', () => resolve(false), { once: true })
          img.src = url
        })
      }

      /**
       * Ask the host which slots the user supplied, then swap them in.
       *
       * Slots carrying their own behaviour are swapped onto the element the
       * behaviour already targets, so nothing else in the plugin has to know
       * an image is involved:
       *
       *   - `basin` goes into the clickable basin element,
       *   - `pipe`  goes inside the falling pipe element,
       *   - `rice`  replaces the drawn mound on the desktop drop.
       */
      /** Extra `/skin` attempts after the first fails; see `loadArt`. */
      const ART_RETRIES = 3

      /**
       * Ask the host which artwork slots the user has supplied, and swap in any
       * that load.
       *
       * Retried on failure, unlike a plain one-shot probe. The endpoint is a
       * single request against the local web server, but it races the server's
       * own startup: if it 500s while the page is still coming up, a one-shot
       * read leaves `data-pet-has-basin` unset forever, and a user whose
       * `pet.png` already contains a basin then sees TWO basins for the life of
       * the page. The sibling probes already tolerate a miss (`loadVolumes` is
       * re-polled, `loadTracks` is re-read per play); this one now matches them.
       *
       * @param attempt - retries already used; callers pass nothing.
       */
      async function loadArt(attempt = 0) {
        try {
          const response = await fetch('/api/bonk-pet/skin', { cache: 'no-store' })
          if (!response.ok) {
            // Retry a server-side hiccup, but not forever: three tries over
            // ~5s covers the startup race without hammering a genuinely broken
            // route for the whole session.
            if (attempt < ART_RETRIES) later(() => void loadArt(attempt + 1), 2_500)
            return
          }
          const body = await response.json()
          const slots = body?.slots
          if (slots === null || typeof slots !== 'object') return

          const targets = {
            pet: root.querySelector('[data-bonk-whale]'),
            basin: root.querySelector('[data-bonk-basin]'),
            pipe: root.querySelector('[data-bonk-pipe]'),
            // The rice drop is its own fixed-position element, not part of the
            // pet's rig, so it needs its own slot rather than riding along
            // with the pet image.
            rice: riceDrop,
          }

          const swapped = await Promise.all(
            Object.entries(targets).map(([slot, element]) => {
              const entry = slots[slot]
              if (element === null || entry === undefined || typeof entry.name !== 'string') {
                return Promise.resolve(false)
              }
              return swapArt(slot, element, entry.name)
            }),
          )

          // A pet image may already contain the basin (a combined composition).
          // Overlaying the drawn basin would then show two, so hide it and let
          // the whole pet be the knock target instead.
          //
          // Keyed on the pet image having ACTUALLY loaded, not merely on the
          // file existing: if `pet.png` is corrupt the drawn whale stays, and
          // hiding the drawn basin would leave that whale sitting on nothing.
          const petSwapped = swapped[0] === true
          const basinSwapped = swapped[1] === true
          if (petSwapped && !basinSwapped) {
            root.dataset.petHasBasin = '1'
            // The drawn basin carries the keyboard affordance (it has a
            // tabindex and a keydown handler). Hiding it would leave the pet
            // reachable only by mouse, so the pet takes over that role.
            const whale = root.querySelector('[data-bonk-whale]')
            if (whale !== null) {
              whale.tabIndex = 0
              whale.setAttribute('role', 'button')
              whale.setAttribute('aria-label', '敲它的铁盆')
            }
          }
          // Order matters: match the artwork's aspect ratio FIRST, then measure the
          // box to anchor the bubble. The other order measures a stretched image.
          const artImg = root.querySelector('[data-bonk-whale] img[data-bonk-art]')
          if (artImg !== null && artImg !== undefined) fitWhaleToArt(artImg)
          positionBubble()
        } catch {
          // No endpoint or no files: every drawn layer stays.
        }
      }

      loadArt()
      void loadVolumes()

      // ---- rendering -----------------------------------------------------

      function render() {
        meterFill.style.setProperty('--bonk-full', `${Math.round(state.food)}%`)
        const starving = state.food <= HUNGRY_AT
        // One threshold for every hunger cue — the meter's warning colour, the
        // sad sway and the begging branch all key off the same value. Using 0
        // here meant the bar was already red while the pet looked content.
        meter.dataset.low = starving ? '1' : '0'
        stats.textContent = `🍚${state.feeds} · 🔧${state.hits} · 🥄${state.knocks}`
        // A transient reaction outranks the ambient singing state, which in
        // turn outranks hunger — you always see the newest thing that happened.
        root.dataset.state = transient ?? (working ? 'sing' : starving ? 'hungry' : 'idle')
      }

      function say(text, holdMs) {
        bubble.textContent = text
        bubble.dataset.show = '1'
        if (bubbleTimer !== null) bubbleTimer.cancel()
        bubbleTimer = later(() => {
          bubble.dataset.show = '0'
          bubbleTimer = null
        }, holdMs ?? 2600)
      }

      /**
       * Enter a short-lived reaction state.
       *
       * Re-entering the SAME state needs an explicit kick: `data-state` is
       * already that value, so the attribute never changes and the engine has
       * no reason to restart the keyframes. Clearing it and forcing a reflow
       * makes the animation play again — without this, knocking the basin
       * twice in a row shakes only the first time.
       */
      function enter(name, ms) {
        if (transient === name) {
          root.dataset.state = ''
          void root.offsetWidth
        }
        transient = name
        render()
        later(() => {
          if (transient === name) {
            transient = null
            render()
          }
        }, ms)
      }

      function spend(amount) {
        state.food = clamp(state.food - amount, 0, 100)
        persist()
      }

      function gain(amount) {
        state.food = clamp(state.food + amount, 0, 100)
        persist()
      }

      function persist() {
        saveState(state)
        render()
      }

      // ---- begging for rice ----------------------------------------------

      /** The eating beat itself: state, a line, and the food it was worth. */
      function eat() {
        enter('eat', STATE_MS.eat)
        say(pick(LINES.eat), 2200)
        gain(FEED_GAIN)
      }

      /**
       * The pet's own centre, in fixed-page coordinates.
       *
       * Read from the live rect rather than from `state.pos`, because the pet
       * can also be sitting at its default bottom-right anchor, where
       * `state.pos` is null. This is the origin every dash starts from.
       */
      /**
       * Where the pet's ARTWORK is centred, in viewport coordinates.
       *
       * Not the root box's centre: the box is a fixed 150px while the artwork is
       * narrower and centred inside it, and a user skin changes that width (112 ->
       * 123 for the supplied portrait). Targeting the box centre made the pet stop
       * 36px short of its food — close enough to look like a bug, far enough to
       * read as "eating from a step away".
       */
      function petCenter() {
        const whale = root.querySelector('[data-bonk-whale]')
        if (whale !== null) {
          const art = whale.getBoundingClientRect()
          if (art.width > 0) return { x: art.left + art.width / 2, y: art.top + art.height / 2 }
        }
        const rect = root.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      }

      /**
       * Drop a mound of rice somewhere on the page that is NOT on top of the pet.
       *
       * Random but bounded, and the bounds are the PET's, not the drop's: to
       * stand centred on a spot the pet needs its 150px box to fit around it,
       * so food placed within half a pet of an edge is food the pet can only
       * reach by hugging the border — measured at ~39px off-centre before this
       * margin was applied. Keeping every candidate inside the standable area
       * is what makes the landing exact instead of merely close.
       *
       * @returns the chosen top-left corner for the drop.
       */
      function pickRiceSpot() {
        const dropSize = 58
        const petHalf = 75 // half of the pet's 150px box; see `settleAfterDash`
        const gap = 24 // breathing room from the viewport edge

        // The pet's own centre must be able to reach the drop's centre, so the
        // drop's centre is confined to the region the pet can centre within.
        const minCenterX = petHalf + gap
        const maxCenterX = Math.max(minCenterX, window.innerWidth - petHalf - gap)
        const minCenterY = petHalf + gap
        const maxCenterY = Math.max(minCenterY, window.innerHeight - petHalf - gap)

        const from = petCenter()
        let spot = { x: minCenterX, y: minCenterY }
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const cx = minCenterX + Math.random() * Math.max(1, maxCenterX - minCenterX)
          const cy = minCenterY + Math.random() * Math.max(1, maxCenterY - minCenterY)
          spot = { x: cx - dropSize / 2, y: cy - dropSize / 2 }
          const far = Math.hypot(cx - from.x, cy - from.y)
          if (far > 160) break
        }
        return spot
      }

      /** Put the rice on the page at `spot` and remember it for the dash. */
      function showRice(spot) {
        riceDrop.style.left = `${Math.round(spot.x)}px`
        riceDrop.style.top = `${Math.round(spot.y)}px`
        riceDrop.dataset.eaten = '0'
        riceDrop.dataset.show = '1'
        riceSpot = spot
        ricePlacedAt = Date.now()
      }

      function hideRice() {
        riceDrop.dataset.show = '0'
        riceDrop.dataset.eaten = '0'
        riceSpot = null
      }

      /**
       * Walk the pet to `target` by translating the rig, then run `done`.
       *
       * The rig transform is the same channel dragging uses, so the travel is
       * one CSS transition rather than a rAF loop. `walkMs` must match the
       * `[data-walking="1"]` transition duration in the stylesheet, or the
       * callback fires before the pet visually arrives.
       */
      function dashTo(target, done) {
        const from = petCenter()
        // `target` is the rice's TOP-LEFT corner, so half the drop gets to its
        // centre. This `+ 29` is that half-width — NOT a property of the whale,
        // which is what it looked like: 29 is exactly `RICE_SIZE / 2`. Removing it
        // (on the theory that it encoded the old artwork's proportions) made the
        // pet aim at the rice's corner and then snap back to its resting place.
        const dx = target.x + RICE_HALF - from.x
        const dy = target.y + RICE_HALF - from.y
        rig.style.setProperty('--bonk-dx', `${dx}px`)
        rig.style.setProperty('--bonk-dy', `${dy}px`)
        rig.dataset.walking = '1'
        walkTimer = later(() => {
          rig.dataset.walking = '0'
          done()
        }, walkMs)
      }

      /**
       * The pet's box, in CSS pixels. Keep in sync with `[data-bonk-root]`.
       *
       * Named because the number appears in three unrelated calculations that
       * all have to agree: the committed position, the rice drop band, and the
       * dash target maths.
       */
      const PET_SIZE = 150

      /**
       * How wide the rice drop is, and therefore how far its top-left corner is
       * from its centre.
       *
       * The drop is positioned by `left/top`, so a target expressed as a corner has
       * to be converted before anything can be aimed at it. The literal `29` used
       * to appear in `dashTo` and again in `settleAfterDash`; naming it here means
       * the two cannot drift apart, which is exactly what went wrong when it was
       * "cleaned up" as if it were a property of the whale.
       *
       * Keep in sync with `--bonk-rice-size` in the stylesheet.
       */
      const RICE_SIZE = 58
      const RICE_HALF = RICE_SIZE / 2

      /**
       * Keep a committed position inside the viewport.
       *
       * `left/top` are absolute pixels, so the bounds have to be applied on
       * every commit AND whenever the viewport itself changes — a resize while
       * the pet sits near an edge would otherwise strand it outside the visible
       * area with nothing to pull it back.
       *
       * The allowance is the full box, not 60px: allowing more than `PET_SIZE`
       * let a drag park up to 90px of the pet off-screen, and because that
       * value is persisted, a reload put it right back there.
       *
       * @param left - desired viewport x.
       * @param top - desired viewport y.
       * @returns the closest position that keeps the whole pet visible.
       */
      function fitToViewport(left, top) {
        const maxLeft = Math.max(0, window.innerWidth - PET_SIZE)
        const maxTop = Math.max(0, window.innerHeight - PET_SIZE)
        return {
          left: clamp(left, 0, maxLeft),
          top: clamp(top, 0, maxTop),
        }
      }

      function commitPosition(left, top) {
        rig.dataset.settling = '1'
        rig.style.setProperty('--bonk-dx', '0px')
        rig.style.setProperty('--bonk-dy', '0px')
        const fitted = fitToViewport(left, top)
        root.style.setProperty('--bonk-x', 'auto')
        root.style.setProperty('--bonk-y', 'auto')
        root.style.left = `${fitted.left}px`
        root.style.top = `${fitted.top}px`
        root.style.right = 'auto'
        root.style.bottom = 'auto'
        // Force a reflow while the transition is still suppressed, so the
        // browser commits left/top and transform together instead of
        // interpolating the transform on the next frame.
        void rig.offsetWidth
        delete rig.dataset.settling
        state.pos = { left: fitted.left, top: fitted.top }
        saveState(state)
      }

      /**
       * Walk back from wherever the dash left the pet and commit the move.
       *
       * The rig translate is folded into `root.left/top` so the pet's resting
       * place is a real position (and survives to `state.pos`), rather than an
       * ever-growing transform offset.
       *
       * The offset is derived from the pet's ACTUAL box rather than a literal.
       * It used to be `size = 150` with `+ 29` on both axes, which silently
       * encoded the old drawn whale's proportions: once a user skin changed the
       * whale's width (112 -> 123 for the supplied portrait) the pet landed ~42px
       * off the rice instead of on it. Reading the element means any skin lands
       * correctly.
       */
      function settleAfterDash(target) {
        const whale = root.querySelector('[data-bonk-whale]')
        const box = root.getBoundingClientRect()
        if (whale === null || box.width === 0) return
        // `target` is the rice's TOP-LEFT corner; `commitPosition` wants the ROOT's
        // top-left. So: corner -> rice centre -> the root position that puts the
        // ARTWORK's centre there.
        //
        // Measured with `offset*`, NOT `getBoundingClientRect()`. Two reasons, and
        // the first one is why this function was broken:
        //
        //  1. This runs BEFORE `commitPosition` zeroes the rig transform, so a live
        //     rect still contains the whole dash translate. `art.left - box.left`
        //     returned 11 + (-748) = -737, which drove the committed position
        //     negative; `fitToViewport` clamped it to the corner and the pet
        //     teleported back to its resting place instead of staying at its food.
        //     Offset properties are layout-only and ignore transforms.
        //  2. `getBoundingClientRect().width` is scaled by the breathing/squash
        //     animation, so the measured size flickered frame to frame.
        const artW = whale.offsetWidth
        const artH = whale.offsetHeight
        if (artW === 0 || artH === 0) return
        const artOffsetX = whale.offsetLeft
        const artOffsetY = whale.offsetTop
        const centreX = target.x + RICE_HALF
        const centreY = target.y + RICE_HALF
        commitPosition(centreX - artOffsetX - artW / 2, centreY - artOffsetY - artH / 2)
      }

      /**
       * The pet notices food and goes for it.
       *
       * The whole point of the rewrite this replaces: the rice is a thing on
       * the page, not a bowl glued to the pet's feet, so eating is something
       * the user watches happen across the screen instead of something they
       * click in place.
       */
      function dashToRice() {
        if (riceSpot === null) return
        if (dashBusy) return
        dashBusy = true
        const target = riceSpot

        // A beat of "spotted it!" before moving, so the dash reads as a
        // reaction rather than teleporting.
        later(() => {
          say(pick(LINES.spotted), 1200)
          dashTo(target, () => {
            // Arrived: eat.
            riceDrop.dataset.eaten = '1'
            state.feeds += 1
            eat()
            later(() => {
              hideRice()
              // Stay where it ate: that is where its dinner was.
              settleAfterDash(target)
              dashBusy = false
            }, 420)
          })
        }, 260)
      }

      /**
       * Beg for food: this is the ONLY route that puts rice on the page.
       *
       * Hungry pets find food and dash to it; a pet that is not actually
       * hungry wanders off and finds nothing (the drawn empty-bowl beat), so
       * the "knock it until it is hungry" loop keeps its meaning.
       */
      function beg() {
        if (begBusy) return
        begBusy = true
        enter('beg', STATE_MS.beg)
        say(pick(LINES.beg), 3000)

        const hungry = state.food <= HUNGRY_AT
        if (hungry) {
          // Food appears somewhere out there; the pet will spot it shortly.
          showRice(pickRiceSpot())
          later(dashToRice, 700)
        } else {
          // Not actually hungry — wander off, find nothing, come back.
          later(() => {
            say(pick(LINES.noFood), 2000)
          }, 1500)
        }

        later(() => {
          begBusy = false
          // Nobody watched it happen: the pet still eats, and the rice goes.
          if (hungry && riceSpot !== null && !dashBusy) {
            hideRice()
          }
        }, 9000)
      }

      /**
       * A hungry pet sometimes notices food all on its own.
       *
       * Without this the rice only ever appears as a direct answer to
       * knocking, which makes the desktop feel scripted. The interval is
       * deliberately slower than the natural hunger drain so it reads as an
       * occasional event, not a metronome.
       */
      function maybeWander() {
        if (riceSpot !== null || dashBusy || begBusy || working) return
        if (state.food > HUNGRY_AT) return
        if (Math.random() > 0.5) return
        showRice(pickRiceSpot())
        later(dashToRice, 600)
      }

      // ---- working: sing while the agent runs ------------------------------

      /**
       * How often a lyric surfaces while the pet is singing.
       *
       * The song is 2m04s and the lyrics are short lines, so this is a reading
       * pace rather than a beat match: the point is that the pet feels like it
       * is mouthing the track, not that the words are in sync. There is no
       * timeline to sync to — the file carries no SYLT frame and the track is a
       * private AI collaboration, so no published timesheet exists.
       */
      const SING_EVERY_MS = 6500

      /**
       * Say the next lyric line.
       *
       * `LINES.sing` alternates English then Chinese, and the pairs are ordered
       * so each translation follows its original. Advancing one at a time
       * therefore reproduces the song's own call-and-response shape — stepping
       * by two would skip every Chinese line.
       */
      let singIndex = 0

      /**
       * Pending retry for a lyric that was refused because a reaction was on
       * screen. Tracked so it can be cancelled when the task ends — otherwise a
       * scheduled line would fire up to a second later and be the one thing the
       * pet says after the agent has already stopped.
       */
      let singRetry = null

      function singLine() {
        if (!working) return
        // Never talk over a failure line or a knock reaction.
        //
        // Skipping is NOT free: a knock reaction runs 1.2s, and its own streak
        // handler can launch `beg`, which holds `transient` for another 4.2s on
        // top of the walk to the rice. Against a 6.5s lyric interval that is
        // long enough to swallow tick after tick, and because this returns BEFORE
        // incrementing, the pet goes silent for as long as the user keeps
        // interacting — reported as "唱歌的时候敲盆会出bug".
        //
        // The fix is to reschedule when refused rather than waiting a full
        // interval: the line is still pending, so it should speak as soon as the
        // reaction clears instead of losing its slot to the timer's phase.
        if (transient !== null) {
          if (singRetry === null) {
            singRetry = later(() => {
              singRetry = null
              singLine()
            }, 900)
          }
          return
        }
        say(LINES.sing[singIndex % LINES.sing.length], 3200)
        singIndex += 1
      }

      /**
       * Follow the harness `agent/status` signal. Idempotent: the relay can
       * repeat a status (a reconnect replays nothing, but several agents may
       * share the stream), and only a real transition should start or stop the
       * music.
       */
      function setWorking(next) {
        if (working === next) return
        working = next
        if (next) {
          playMusic()
          singIndex = 0
          singTimer = setInterval(singLine, SING_EVERY_MS)
          timers.add(singTimer)
          // One line straight away, so a short task still gets a lyric.
          later(singLine, 900)
        } else {
          stopMusic()
          if (singTimer !== null) {
            clearInterval(singTimer)
            timers.delete(singTimer)
            singTimer = null
          }
          // Cancel a pending lyric too: the task is over, so a line scheduled by
          // the refusal path must not land afterwards as the last thing said.
          if (singRetry !== null) {
            singRetry.cancel()
            singRetry = null
          }
        }
        render()
      }

      // ---- failure: the steel pipe ---------------------------------------

      /** Impact food cost, in the same units as KNOCK_COST. */
      const HIT_COST = 6

      /**
       * Describe a failure frame for the speech bubble.
       *
       * Different signals carry different context, so the label says where the
       * failure came from rather than a generic "出错了".
       *
       * @param payload - the error frame from the host relay.
       * @returns a short Chinese label.
       */
      function errorLabel(payload) {
        const detail = typeof payload?.message === 'string' ? payload.message : ''
        switch (payload?.kind) {
          case 'tool':
            return `工具 ${payload.tool ?? ''} 挂了：${detail}`.trim()
          case 'request':
            return `${payload.provider ?? '模型'} 请求失败：${detail}`
          case 'session':
            return `会话出错：${detail}`
          case 'turn':
            return payload.where !== undefined ? `回合失败（${payload.where}）：${detail}` : `回合失败：${detail}`
          default:
            return detail.length > 0 ? detail : '出错了'
        }
      }

      /**
       * @param payload - optional error frame; when present the bubble names the
       *   failing part instead of a generic line.
       */
      function dropPipe(payload) {
        if (pipeBusy) return
        pipeBusy = true
        state.hits += 1
        render()
        saveState(state)

        pipe.dataset.fall = '1'
        later(() => {
          pipe.dataset.fall = '2'
          // Impact frame: squash + stars + a line.
          playEffect('clang')
          enter('hit', STATE_MS.hit)
          say(payload === undefined ? pick(LINES.hit) : errorLabel(payload), 2400)
          spend(HIT_COST)
          later(() => {
            pipe.dataset.fall = '0'
            pipeBusy = false
          }, 520)
        }, 420)
      }

      // ---- interaction: knock the basin ----------------------------------

      function knock() {
        state.knocks += 1
        render()
        saveState(state)

        playEffect('knock')

        ring.dataset.fire = '0'
        // Force a reflow so the animation restarts on rapid clicking.
        void ring.offsetWidth
        ring.dataset.fire = '1'

        enter('knock', STATE_MS.knock)
        knockStreak += 1
        if (knockStreakTimer !== null) knockStreakTimer.cancel()
        knockStreakTimer = later(() => {
          knockStreak = 0
          knockStreakTimer = null
        }, 4000)

        if (knockStreak >= 6) say(pick(LINES.knockNag), 2600)
        else say(pick(LINES.knock), 2200)

        spend(KNOCK_COST)

        // Knock it enough and it goes looking for a meal.
        if (knockStreak >= 3 && !begBusy) later(beg, 700)
      }

      // ---- drag ----------------------------------------------------------

      let drag = null

      /**
       * Start tracking a press. The pointer capture is deliberately NOT taken
       * here.
       *
       * A capture redirects the following pointerup/click to the capture
       * element's subtree, so capturing on pointerdown silently swallows the
       * click that the pet listens for — knocking would appear dead. The
       * pet is both the drag handle and the knock target, so the two are told
       * apart by movement instead: capture is taken in `moveDrag` only once
       * the press has actually travelled far enough to be a drag. A plain
       * click therefore never captures, and a drag still does.
       */
      const DRAG_THRESHOLD = 4

      function beginDrag(event) {
        const rect = root.getBoundingClientRect()
        // Grabbed while running for its rice: it struggles.
        //
        // Keyed on `riceSpot`, not `dashBusy`. The rice appears FIRST and the dash
        // only starts 260ms later (`dashToRice` waits a beat so the dash reads as a
        // reaction), so a grab in that window is still "caught going for the food"
        // from the user's point of view while `dashBusy` is not yet set. `riceSpot`
        // spans the whole episode: it is set when the rice is placed and cleared
        // once it has been eaten.
        //
        // Checked in `beginDrag` rather than `moveDrag` because the complaint is
        // about being caught, not about being moved — grabbing and holding still
        // should still make it wriggle. The meal is deliberately NOT cancelled:
        // doing so would silently swallow the rice the user can see on screen,
        // which reads as a bug rather than a joke.
        if (riceSpot !== null || dashBusy) {
          enter('struggle', STATE_MS.struggle)
          say(pick(LINES.struggle), 2200)
        }
        drag = {
          x: event.clientX,
          y: event.clientY,
          baseX: rect.left,
          baseY: rect.top,
          pointerId: event.pointerId,
          moved: false,
          captured: false,
          // Where the drag is taking the pet, in committed-position space.
          // `endDrag` commits THIS rather than re-measuring the rect: the rig has
          // a `.3s` transform transition, so mid-drag (and at release) a live
          // `getBoundingClientRect()` returns an interpolated value, and
          // committing it bakes in a half-finished position — the pet snaps back
          // toward where the drag started. Measured at "0px moved" before this.
          nextLeft: rect.left,
          nextTop: rect.top,
        }
      }

      function moveDrag(event) {
        if (drag === null) return
        const dx = event.clientX - drag.x
        const dy = event.clientY - drag.y
        if (!drag.moved) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
          drag.moved = true
          // Now that this is unambiguously a drag, take the capture so the
          // drag keeps tracking even if the cursor leaves the element.
          try {
            root.setPointerCapture?.(drag.pointerId)
            drag.captured = true
          } catch {
            // Capture is an enhancement; dragging still works without it.
          }
        }
        rig.dataset.walking = '0'
        // Cancel the `.9s` walk easing for the duration of the drag. That
        // transition is right for scripted moves but wrong for a pointer: each
        // move would start a fresh 900ms ease, so the pet trails the cursor and
        // is still gliding when the button is released.
        rig.dataset.dragging = '1'
        // Clamp DURING the drag, not only on release.
        //
        // Without this the pet follows the cursor outside the window and only
        // snaps back when the button is let go, so the whole drag is spent
        // looking at a pet that has left the screen.
        //
        // The base position comes from `beginDrag`'s captured rect, NOT from a
        // fresh `getBoundingClientRect()`. The rig carries a `.3s` transform
        // transition, so mid-drag the live rect is an INTERPOLATED value, not
        // the target: measuring it every frame makes the reference point drift
        // toward the cursor and the pet stops moving entirely. The rect captured
        // at press time is the only stable origin.
        const baseLeft = drag.baseX
        const baseTop = drag.baseY
        const fitted = fitToViewport(baseLeft + dx, baseTop + dy)
        const nextDx = fitted.left - baseLeft
        const nextDy = fitted.top - baseTop
        rig.style.setProperty('--bonk-dx', `${nextDx}px`)
        rig.style.setProperty('--bonk-dy', `${nextDy}px`)
        // Remember the destination, so `endDrag` commits the intended position
        // rather than an interpolated one.
        drag.nextLeft = fitted.left
        drag.nextTop = fitted.top
        event.preventDefault()
      }

      function endDrag(event) {
        if (drag === null) return
        const wasDrag = drag.moved
        const captured = drag.captured
        delete rig.dataset.dragging
        // The destination computed by the last `moveDrag`, NOT a fresh
        // measurement: the rig's `.3s` transform transition means a live rect
        // here is interpolated, so committing it would undo most of the drag.
        const nextLeft = drag.nextLeft
        const nextTop = drag.nextTop
        if (captured) {
          try {
            root.releasePointerCapture?.(drag.pointerId)
          } catch {
            // Already released.
          }
        }
        drag = null

        if (!wasDrag) return

        // Commit the new anchor into the fixed offsets and reset the rig.
        commitPosition(nextLeft, nextTop)
      }

      // Restore the stored anchor, fitted to TODAY's viewport. The saved pair is
      // absolute pixels from whenever it was written, so applying it verbatim
      // would strand the pet off-screen after the window shrank.
      if (state.pos !== null && typeof state.pos.left === 'number') {
        const fitted = fitToViewport(state.pos.left, state.pos.top)
        root.style.setProperty('--bonk-x', 'auto')
        root.style.setProperty('--bonk-y', 'auto')
        root.style.left = `${fitted.left}px`
        root.style.top = `${fitted.top}px`
        root.style.right = 'auto'
        root.style.bottom = 'auto'
        state.pos = fitted
      }

      /**
       * Re-fit the pet whenever the viewport changes.
       *
       * Absolute `left/top` do not follow a resize, so a window that shrinks
       * while the pet sits near an edge would leave it outside the visible area
       * with nothing to bring it back.
       *
       * Only acts when a position has actually been committed: with no
       * `state.pos` the pet is anchored by the `right/bottom` defaults, which
       * already track the viewport.
       */
      function refitOnResize() {
        // The bubble's anchor depends on the artwork's box, which moves with the
        // viewport too, so it is re-derived here rather than only at mount.
        positionBubble()
        if (state.pos === null || typeof state.pos.left !== 'number') return
        const fitted = fitToViewport(state.pos.left, state.pos.top)
        if (fitted.left === state.pos.left && fitted.top === state.pos.top) return
        commitPosition(fitted.left, fitted.top)
      }

      // `typeof` guard rather than a bare call: the browser half is also loaded
      // by the unit-test harness, which provides a DOM stub but no `window`.
      if (typeof window !== 'undefined') window.addEventListener('resize', refitOnResize)

      // ---- wiring --------------------------------------------------------

      // The knock target is the basin, or the whole pet when the pet image
      // already contains a basin (the drawn basin is hidden in that case).
      // Both routes end in the same `knock()`.
      const whale = root.querySelector('[data-bonk-whale]')

      const onKnockClick = (event) => {
        event.stopPropagation()
        knock()
      }
      const onKnockKey = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          knock()
        }
      }

      basin.addEventListener('click', onKnockClick)
      basin.addEventListener('keydown', onKnockKey)
      if (whale !== null) {
        whale.addEventListener('click', onKnockClick)
        whale.addEventListener('keydown', onKnockKey)
      }
      root.addEventListener('pointerdown', beginDrag)
      // Move/up listen on WINDOW, not on `root`.
      //
      // The pet is a 150px box but the drawn whale inside it is only ~112x116,
      // and `root` has `pointer-events: none` with the artwork opting back in. So
      // the moment the cursor leaves the artwork, a `pointermove` targets `body`
      // and NEVER reaches a listener on `root` — the drag dies on the first frame
      // that moves off the pet. Measured: `pointerdown` on the pet, then
      // `pointermove target=body`. That is why dragging appeared to do nothing
      // and why the pet could be parked off-screen.
      //
      // `beginDrag` is the only listener that needs to be scoped to the pet.
      window.addEventListener('pointermove', moveDrag)
      window.addEventListener('pointerup', endDrag)
      window.addEventListener('pointercancel', endDrag)

      // ---- failure feed --------------------------------------------------

      let source = null
      let retry = null
      let attempts = 0

      /** Give up after this many failures: a dead relay must not spin forever. */
      const MAX_ATTEMPTS = 5

      function connect() {
        if (attempts >= MAX_ATTEMPTS) return
        attempts += 1
        try {
          source = new EventSource('/api/bonk-pet/events')
        } catch {
          return
        }
        source.addEventListener('message', (event) => {
          let payload
          try {
            payload = JSON.parse(event.data)
          } catch {
            return
          }
          attempts = 0
          if (payload?.type === 'error') {
            dropPipe(payload)
            return
          }
          if (payload?.type === 'status') {
            setWorking(payload.status === 'running')
          }
        })
        source.addEventListener('error', () => {
          // The relay dropped. Whatever we last heard is now stale: if the pet
          // was singing because a task was running, we can no longer know when
          // that task ends, so stop rather than loop forever on a dead wire.
          setWorking(false)
          // EventSource retries on its own; close it so we do not stack handles
          // and back off with a widening delay instead.
          try {
            source?.close()
          } catch {
            // already closed
          }
          source = null
          if (retry !== null) return
          // Exhausted: arming another timer here would be pointless, because
          // `connect()` returns immediately once `attempts >= MAX_ATTEMPTS`.
          // Without this guard the last failure scheduled a delay that was
          // thrown away unused.
          if (attempts >= MAX_ATTEMPTS) return
          // `attempts` was already incremented for the connection that just
          // failed, so this failure's delay is `8s * attempts` — 8, 16, 24, 32
          // across the four retries.
          retry = later(
            () => {
              retry = null
              connect()
            },
            8_000 * attempts,
          )
        })
      }

      connect()

      // ---- idle economy --------------------------------------------------

      // Food drains slowly; the pet checks in once a minute.
      const drip = setInterval(() => {
        const before = state.food
        state.food = clamp(state.food - DRAIN_PER_MIN, 0, 100)
        if (Math.abs(state.food - before) > 0.01) persist()
      }, 60_000)
      timers.add(drip)

      // Rice nobody came for is cleared rather than left on the page forever.
      const stale = setInterval(() => {
        if (riceSpot !== null && Date.now() - ricePlacedAt > RICE_TTL_MS) {
          hideRice()
        }
      }, 15_000)
      timers.add(stale)

      // A hungry pet occasionally goes looking for food by itself, so rice
      // sometimes appears without the user knocking first.
      const wander = setInterval(maybeWander, WANDER_EVERY_MS)
      timers.add(wander)

      // Greet once on load, and say so if it is starving.
      render()
      // Position the bubble BEFORE the greeting appears, so the first thing the
      // user sees is already anchored to the pet's head rather than jumping into
      // place a moment later when the artwork reports its size.
      positionBubble()
      if (state.food <= 0) {
        say('饿……先给我口饭', 2600)
      } else {
        say(pick(LINES.greet), 3200)
      }

      document.body.appendChild(root)
      document.body.appendChild(riceDrop)

      // ---- teardown ------------------------------------------------------

      return () => {
        // `cancel()` also drops the id from `timers`, so walk the set rather
        // than the two named handles and then clear it once.
        bubbleTimer?.cancel()
        knockStreakTimer?.cancel()
        singRetry?.cancel()
        for (const id of timers) clearTimeout(id)
        timers.clear()
        try {
          source?.close()
        } catch {
          // already closed
        }
        if (audio !== null) {
          try {
            audio.pause()
            audio.removeAttribute('src')
          } catch {
            // already torn down
          }
        }
        saveState(state)
        if (typeof window !== 'undefined') window.removeEventListener('resize', refitOnResize)
        owned.forEach((node) => node.remove())
        owned.clear()
      }
    }

    // ---------------------------------------------------------------------
    // Settings card (Settings → Plugins → configurable)
    // ---------------------------------------------------------------------

    /** Slider rows, in display order. */
    const VOLUME_ROWS = [
      { field: 'music', label: '唱歌音量', hint: '干活时放的歌' },
      { field: 'pipe', label: '钢管音量', hint: '出错时钢管砸下来的声音' },
      { field: 'knock', label: '敲盆音量', hint: '你点它盆的声音' },
    ]

    /** Store key for the browser's own copy of the volumes. */
    const VOLUME_KEY = 'dsh-bonk-pet/volume'

    /** Fallback values, mirroring the host half's defaults. */
    const VOLUME_FALLBACK = { music: 0.65, pipe: 0.34, knock: 0.5 }

    /** Read the stored volumes, falling back per field on junk. */
    function readStoredVolumes() {
      const out = { ...VOLUME_FALLBACK }
      try {
        const raw = localStorage.getItem(VOLUME_KEY)
        if (raw === null) return out
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return out
        for (const field of Object.keys(out)) {
          const value = parsed[field]
          // A hand-edited entry can hold anything; `Audio.volume` throws
          // outside 0–1, so clamp rather than trust.
          if (typeof value === 'number' && Number.isFinite(value)) {
            out[field] = Math.min(1, Math.max(0, value))
          }
        }
      } catch {
        // Private mode or corrupt JSON: the defaults are already in place.
      }
      return out
    }

    /**
     * The volume card, contributed into the Settings → Plugins tab seat (and,
     * as a fallback, into a first-level Settings section) by
     * {@link installSettingsCard}.
     *
     * Self-contained: it keeps its own state and persists through
     * `localStorage` plus a `POST` to the host route, so it depends on no
     * settings service. That is the point — an earlier version bound a
     * `settingsScope` service the kernel no longer provides, so the card
     * silently never appeared.
     */
    function makeVolumeCard(React) {
      const e = React.createElement

      return function VolumeCard() {
        const [values, setValues] = React.useState(readStoredVolumes)

        /** Apply one field: memory, live audio, localStorage, then the host. */
        const apply = (field, value) => {
          const next = { ...values, [field]: value }
          setValues(next)
          // The pet's own player lives in the other half of this bundle; it
          // exposes a hook so the change is audible immediately rather than on
          // the next page load. Absent (no pet mounted) is not an error.
          try {
            window.__bonkApplyVolume?.(next)
          } catch {
            // No live pet: local persistence below still records the change.
          }
          try {
            localStorage.setItem(VOLUME_KEY, JSON.stringify(next))
          } catch {
            // Private mode: the value still applies for this page's lifetime.
          }
          // Fire and forget: a failed write must not undo the local change.
          void fetch('/api/bonk-pet/volume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next),
          }).catch(() => {})
        }

        const rows = VOLUME_ROWS.map((row) => {
          const value = values[row.field]
          return e(
            'label',
            { key: row.field, className: 'bonk-set-row' },
            e('span', { className: 'bonk-set-name' }, row.label),
            e('input', {
              type: 'range',
              min: '0',
              max: '1',
              step: '0.01',
              value: String(value),
              'aria-label': row.label,
              onChange: (event) => {
                const next = Number(event.currentTarget.value)
                if (Number.isFinite(next)) apply(row.field, next)
              },
            }),
            e('span', { className: 'bonk-set-value' }, `${Math.round(value * 100)}%`),
            e('span', { className: 'bonk-set-hint' }, row.hint),
          )
        })

        return e(
          'div',
          { className: 'bonk-set-card' },
          e('p', { className: 'bonk-set-lead' }, '敲盆宠物的音量。钢管默认比别的轻，因为它最吵。'),
          ...rows,
        )
      }
    }

    /**
     * Contribute the volume card into Settings → Plugins.
     *
     * The card belongs on the built-in Plugins page, because that is where a
     * user goes looking for it. `dsh-client-ui-settings-plugins` owns that
     * page's `settings.section` entry, and its children table declares
     *
     *     children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } }
     *
     * — a root-scoped tab seat, which is the kernel's designated place for a
     * third-party plugin's configuration page. `settings.section` is registered
     * as well, as its own first-level entry, for a kernel whose Plugins page
     * declares no root-scoped tab seat.
     *
     * Two traps this deliberately avoids, both of which cost a release:
     *
     * - `plugins.bundle.config` does not exist in this kernel (or any other
     *   version of it — the name appears nowhere in app.asar). The previous
     *   revision injected it and shipped no reachable card.
     * - `slots.inject(name, cb)` does NOT throw when `name` is undeclared: it
     *   parks the callback until the slot appears. So a `try` around `inject`
     *   proves nothing, and the old `bundleOk = true` was a false positive that
     *   made the settings probe report success while rendering nothing. Success
     *   is recorded from inside the callback instead, because `slots.register`
     *   is the call that actually throws (`slot "X" is not declared`).
     *
     * @param ctx - the client plugin context.
     */
    function installSettingsCard(ctx) {
      // Diagnostic breadcrumb. The card is contributed into another package's
      // slot, so when it does not appear the reason is invisible from the
      // outside. The object is mutated in place as contributions settle, so a
      // later read sees the final state.
      const outcome = { requested: [], registered: [], failed: [] }
      const note = () => {
        try {
          window.__bonkSettingsCard = outcome
        } catch {
          // No window (not a browser); nothing to record.
        }
        return undefined
      }

      try {
        const slots = ctx.slots ?? ctx.get('slots')
        if (slots === undefined || slots === null) {
          outcome.failed.push('no slots service')
          return note()
        }
        if (typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
          outcome.failed.push('slots.inject/register missing')
          return note()
        }

        let React
        try {
          React = require('react')
        } catch (error) {
          outcome.failed.push(`require(react) threw: ${String(error?.message ?? error)}`)
          return note()
        }
        if (React === null || typeof React?.createElement !== 'function') {
          outcome.failed.push(`react shape unexpected: ${typeof React}`)
          return note()
        }

        const VolumeCard = makeVolumeCard(React)

        /** Request one contribution; record what the slot actually did. */
        const contribute = (name, options) => {
          outcome.requested.push(name)
          try {
            slots.inject(name, () => {
              try {
                const dispose = slots.register(options, VolumeCard)
                outcome.registered.push(name)
                // `register` returns the disposer and `inject` runs the
                // callback as an effect, so handing it back is what removes
                // the contribution on unload. Swallowing it would leave the
                // card on the ledger after the plugin is gone.
                return dispose
              } catch (error) {
                outcome.failed.push(`${name}: ${String(error?.message ?? error)}`)
                return undefined
              }
            })
          } catch (error) {
            outcome.failed.push(`${name} inject: ${String(error?.message ?? error)}`)
          }
        }

        // Canonical seat: a tab on the built-in Plugins settings page.
        contribute('settings.plugins.tab', {
          name: 'settings.plugins.tab',
          id: 'dsh-bonk-pet',
          order: 20,
          label: () => '敲盆宠物',
        })
        // Fallback: its own first-level Settings section.
        contribute('settings.section', {
          name: 'settings.section',
          id: 'dsh-bonk-pet',
          order: 90,
          label: () => '敲盆宠物',
        })
        return note()
      } catch (error) {
        outcome.failed.push(`threw: ${String(error?.message ?? error)}`)
        return note()
      }
    }

    // ---------------------------------------------------------------------
    // Plugin entry
    // ---------------------------------------------------------------------

    const CSS_TAG_ID = 'dsh-bonk-pet/bonk-pet.css'

    /**
     * Inject the stylesheet once per document. Mirrors the shipped client
     * plugins: a `<style>` tag stamped with the owning plugin and the CSS id,
     * so a remount or hot reload reuses the existing tag instead of stacking
     * duplicate rules. The tag is deliberately left in place on teardown —
     * it is inert without the `data-dsh-bonk-pet` scope attribute.
     */
    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-bonk-pet'
      tag.dataset.pluginCss = CSS_TAG_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    let installed = false

    function apply(ctx) {
      installStyles()

      const body = document.body
      body.setAttribute('data-dsh-bonk-pet', '')
      installed = true

      ctx.effect(() => install(), 'dsh-bonk-pet: basin, whale, and pipe')

      // The volume sliders in Settings → Plugins. Wrapped so that anything
      // going wrong here cannot stop the pet from having been installed.
      try {
        installSettingsCard(ctx)
      } catch {
        // No settings UI on this host; the pet is unaffected.
      }

      ctx.effect(
        () => () => {
          if (!installed) return
          installed = false
          body.removeAttribute('data-dsh-bonk-pet')
        },
        'dsh-bonk-pet: scope attribute',
      )
    }

    // `slots` IS declared, and that is deliberate: the settings card is
    // contributed into the `settings.section` slot the shipped settings UI
    // renders, so without `slots` there is no card at all. The pet itself is
    // installed from `apply`, which the loader only calls once every declared
    // service exists — so a host that somehow lacks `slots` loses both, not
    // just the sliders.
    //
    // `settingsScope` is NOT declared, and must never be again: that service
    // was removed from the settings stack, and a declared inject naming a
    // service that never arrives parks the whole client half forever (the boot
    // reports "1 entry did not activate", and the profile gets reset).
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
