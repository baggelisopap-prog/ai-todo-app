#!/usr/bin/env node
/**
 * The scroll-lock refcounting in src/hooks/useModalBehavior.js, tested against
 * the mount/unmount orderings React can actually produce.
 *
 * Worth its own file because it is the only real logic in that hook and its
 * failure mode is nasty: get the count wrong and the page is left PERMANENTLY
 * unscrollable, with no error and no obvious cause. The orderings that break
 * naive implementations are here — a stacked modal closed outer-first, and an
 * overflow value some other stylesheet already owned.
 *
 * Pure simulation: it re-implements the effect body and cleanup against a fake
 * body object, so it needs no DOM and no test framework. If the hook changes,
 * change this to match.
 */
const body = { dataset: {}, style: { overflow: '' } };

function mount() {                       // effect body
  const depth = Number(body.dataset.modalDepth || 0) + 1;
  body.dataset.modalDepth = String(depth);
  if (depth === 1) {
    body.dataset.prevOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
  }
  return function unmount() {            // cleanup
    const remaining = Number(body.dataset.modalDepth || 1) - 1;
    if (remaining > 0) { body.dataset.modalDepth = String(remaining); return; }
    delete body.dataset.modalDepth;
    body.style.overflow = body.dataset.prevOverflow || '';
    delete body.dataset.prevOverflow;
  };
}

let failures = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
};

// 1. single modal
let a = mount();
check('one open -> locked', body.style.overflow, 'hidden');
a();
check('one closed -> unlocked', body.style.overflow, '');

// 2. stacked, closed inner-first (normal)
a = mount(); let b = mount();
check('two open -> locked', body.style.overflow, 'hidden');
b();
check('inner closed, outer still open -> STILL locked', body.style.overflow, 'hidden');
a();
check('both closed -> unlocked', body.style.overflow, '');

// 3. stacked, closed outer-first (React can unmount a parent first)
a = mount(); b = mount();
a();
check('outer closed first, inner open -> still locked', body.style.overflow, 'hidden');
b();
check('then inner closed -> unlocked', body.style.overflow, '');

// 4. a pre-existing overflow set by something else is restored, not clobbered
body.style.overflow = 'scroll';
a = mount();
check('pre-existing value hidden while open', body.style.overflow, 'hidden');
a();
check('pre-existing value RESTORED, not blanked', body.style.overflow, 'scroll');

// 5. no leftover bookkeeping on body
check('no leftover dataset keys', JSON.stringify(body.dataset), '{}');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
