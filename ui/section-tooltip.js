const TOOLTIP_MARGIN = 12;
const TOOLTIP_GAP = 7;

export function bindSectionTooltips() {
    const tooltip = document.createElement('div');
    tooltip.className = 'stsm-section-tooltip';
    tooltip.id = 'stsm-section-tooltip';
    tooltip.role = 'tooltip';
    tooltip.hidden = true;
    document.body.append(tooltip);

    let activeButton = null;
    let pinnedButton = null;

    const show = button => {
        if (!button?.isConnected) return;
        const popupHost = button.closest('.popup') || document.body;
        if (tooltip.parentElement !== popupHost) popupHost.append(tooltip);
        activeButton?.removeAttribute('aria-describedby');
        activeButton = button;
        button.setAttribute('aria-describedby', tooltip.id);
        tooltip.textContent = button.dataset.tooltip || '';
        tooltip.hidden = false;
        positionTooltip(button, tooltip);
    };

    const hide = () => {
        activeButton?.removeAttribute('aria-describedby');
        activeButton = null;
        tooltip.hidden = true;
    };

    const handlePointerOver = event => {
        const button = event.target.closest?.('.stsm-section-info');
        if (!button || button.contains(event.relatedTarget) || pinnedButton) return;
        show(button);
    };

    const handlePointerOut = event => {
        const button = event.target.closest?.('.stsm-section-info');
        if (!button || button.contains(event.relatedTarget) || pinnedButton) return;
        hide();
    };

    const handleFocusIn = event => {
        const button = event.target.closest?.('.stsm-section-info');
        if (button && !pinnedButton) show(button);
    };

    const handleFocusOut = event => {
        if (event.target.closest?.('.stsm-section-info') && !pinnedButton) hide();
    };

    const handleClick = event => {
        const button = event.target.closest?.('.stsm-section-info');
        if (!button) {
            if (pinnedButton) {
                pinnedButton = null;
                hide();
            }
            return;
        }

        event.preventDefault();
        if (pinnedButton === button) {
            pinnedButton = null;
            hide();
            return;
        }
        pinnedButton = button;
        show(button);
    };

    const reposition = () => {
        if (activeButton?.isConnected && !tooltip.hidden) positionTooltip(activeButton, tooltip);
    };

    document.addEventListener('pointerover', handlePointerOver);
    document.addEventListener('pointerout', handlePointerOut);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    document.addEventListener('click', handleClick);
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);

    return () => {
        document.removeEventListener('pointerover', handlePointerOver);
        document.removeEventListener('pointerout', handlePointerOut);
        document.removeEventListener('focusin', handleFocusIn);
        document.removeEventListener('focusout', handleFocusOut);
        document.removeEventListener('click', handleClick);
        window.removeEventListener('resize', reposition);
        document.removeEventListener('scroll', reposition, true);
        activeButton?.removeAttribute('aria-describedby');
        tooltip.remove();
    };
}

function positionTooltip(button, tooltip) {
    const anchor = button.getBoundingClientRect();
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    const centeredLeft = anchor.left + anchor.width / 2 - tooltipWidth / 2;
    const maxLeft = Math.max(TOOLTIP_MARGIN, window.innerWidth - tooltipWidth - TOOLTIP_MARGIN);
    const left = Math.min(Math.max(centeredLeft, TOOLTIP_MARGIN), maxLeft);
    const below = anchor.bottom + TOOLTIP_GAP;
    const above = anchor.top - tooltipHeight - TOOLTIP_GAP;
    const top = below + tooltipHeight <= window.innerHeight - TOOLTIP_MARGIN
        ? below
        : Math.max(TOOLTIP_MARGIN, above);

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
}
