import { getPendingRegenerations, getRegenerationReferences, savePendingRegenerations } from '../records/regeneration-review.js';

export function bindRegenerationPending(root, onReview) {
    const container = document.createElement('div');
    container.className = 'stsm-regeneration-pending';
    container.setAttribute('aria-live', 'polite');
    root.querySelector('.stsm-extension-status').after(container);
    let busy = false;
    const render = () => {
        container.replaceChildren();
        const drafts = getPendingRegenerations();
        container.hidden = !drafts.length;
        for (const draft of drafts) {
            const row = document.createElement('article');
            row.className = 'stsm-regeneration-pending-item';
            const title = document.createElement('strong');
            title.textContent = '재생성 검토 대기';
            const detail = document.createElement('span');
            const count = getRegenerationReferences(draft).length;
            detail.textContent = `#${draft.previousRecord.startId} ~ #${draft.previousRecord.endId}${count ? ` · 도감 연결 확인 ${count}건` : ''}`;
            const actions = document.createElement('div');
            actions.className = 'stsm-regeneration-pending-actions';
            const review = document.createElement('button');
            review.type = 'button';
            review.className = 'menu_button interactable';
            review.innerHTML = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i> 검토하기';
            const discard = document.createElement('button');
            discard.type = 'button';
            discard.className = 'menu_button interactable';
            discard.innerHTML = '<i class="fa-solid fa-trash-can" aria-hidden="true"></i> 초안 버리기';
            const run = async action => {
                if (busy) return;
                busy = true;
                review.disabled = discard.disabled = true;
                try { await action(); }
                catch (error) { toastr.error(error.message); }
                finally { busy = false; render(); }
            };
            review.onclick = () => run(() => onReview(draft));
            discard.onclick = () => run(async () => {
                const sourceChat = SillyTavern.getContext().chat;
                const { Popup } = await import('../../../../../scripts/popup.js');
                if (!await Popup.show.confirm('초안 버리기', '재생성 초안을 버릴까요? 기존 기록은 변경되지 않습니다.')) return;
                if (SillyTavern.getContext().chat !== sourceChat) throw new Error('채팅방이 변경되었습니다.');
                await savePendingRegenerations(getPendingRegenerations().filter(item => item.id !== draft.id));
            });
            actions.append(review, discard);
            row.append(title, detail, actions);
            container.append(row);
        }
    };
    document.addEventListener('stsm:regeneration-pending', render);
    root.addEventListener('stsm:records-rendered', render);
    const context = SillyTavern.getContext();
    context.eventSource.on(context.eventTypes.CHAT_CHANGED, render);
    render();
    return () => {
        document.removeEventListener('stsm:regeneration-pending', render);
        root.removeEventListener('stsm:records-rendered', render);
        context.eventSource.removeListener(context.eventTypes.CHAT_CHANGED, render);
    };
}
