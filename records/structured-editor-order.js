export function refreshEditorOrderControls(form) {
    for (const remove of form.querySelectorAll('[data-editor-remove]')) {
        let controls = remove.closest('.stsm-structured-row-actions');
        if (!controls) {
            controls = document.createElement('div');
            controls.className = 'stsm-structured-row-actions';
            remove.before(controls);
            for (const [direction, label] of [['up', '위로 이동'], ['down', '아래로 이동']]) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'menu_button menu_button_icon interactable';
                button.dataset.editorMove = direction;
                button.title = label;
                button.setAttribute('aria-label', label);
                button.innerHTML = `<i class="fa-solid fa-arrow-${direction}" aria-hidden="true"></i>`;
                controls.append(button);
            }
            controls.append(remove);
        }
        const row = getControlledRow(controls);
        controls.querySelector('[data-editor-move="up"]').disabled = !row.previousElementSibling;
        controls.querySelector('[data-editor-move="down"]').disabled = !row.nextElementSibling;
    }
}

export function moveEditorItem(target) {
    const button = target.closest('[data-editor-move]');
    if (!button || button.disabled) return;
    const row = getControlledRow(button.closest('.stsm-structured-row-actions'));
    const sibling = button.dataset.editorMove === 'up' ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    // Move the existing inputs so unsaved values stay attached to their item.
    if (button.dataset.editorMove === 'up') sibling.before(row);
    else sibling.after(row);
    button.focus({ preventScroll: true });
}

function getControlledRow(controls) {
    const kind = controls.querySelector('[data-editor-remove]').dataset.editorRemove;
    return controls.closest(kind === 'emotion-group' ? '[data-emotion-group]' : '[data-editor-row]');
}
