/** How a focused text field looks depends on how the person got there.
 *
 *  Browsers count a click into a text field (or into an editor, `contenteditable`) as visible focus, so the ink ring
 *  of `:focus-visible` showed on every click, which was too much for a field that already shows a caret. A field the
 *  person clicked into gets a 1px ink border instead; one they reached with the keyboard keeps the ring (Ambrus,
 *  2026-11-26). CSS cannot tell the two apart, so this script says which came last, as `data-yk-pointer` on <html>,
 *  and base.css draws the field from it. A page without the script keeps the ring everywhere.
 *
 *  The package exports this file as it is, like `theme.ts`: an app's bundler compiles it. */

/** The attribute on <html> that is present while the last input was a pointer (a mouse, a pen or a touch). */
export const POINTER_ATTRIBUTE = 'data-yk-pointer';

/** The inline script for `<head>`, next to `THEME_BOOT`. A pointer press sets the attribute and a key removes it,
 *  except a key typed into a field (other than Tab, which leaves it), so typing into a field one clicked into keeps
 *  its border. A shortcut pressed outside a field that moves focus into one counts as the keyboard. Old JavaScript
 *  with no imports, and nothing that could close its script element. */
export const FOCUS_BOOT = `(function () {
    var root = document.documentElement;
    addEventListener('pointerdown', function () {
        root.setAttribute('${POINTER_ATTRIBUTE}', '');
    }, true);
    addEventListener('keydown', function (e) {
        var t = e.target;
        var typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
        if (e.key === 'Tab' || !typing) root.removeAttribute('${POINTER_ATTRIBUTE}');
    }, true);
})();`;
