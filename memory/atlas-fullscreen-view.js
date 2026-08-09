import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import { bindCommitmentMemoryView, renderCommitmentMemory } from './commitment-memory-view.js';
import { bindEventMemoryView, renderEventMemory } from './event-memory-view.js';
import { bindItemMemoryView, renderItemMemory } from './item-memory-view.js';
import { bindPeopleMemoryView, renderPeopleMemory } from './people-memory-view.js';
import { bindWorldMemoryView, renderWorldMemory } from './world-memory-view.js';

const ATLAS_VIEWS = Object.freeze({
    people: {
        title: '인물 도감',
        countId: 'stsm-people-memory-count',
        initialCount: '0명',
        tokenUsageId: 'stsm-people-token-usage',
        warningId: 'stsm-people-memory-skipped',
        warningClass: 'stsm-people-memory-warning',
        listId: 'stsm-people-memory-list',
        listClass: 'stsm-people-memory-list',
        excludedId: 'stsm-people-memory-excluded',
        bind: bindPeopleMemoryView,
        render: renderPeopleMemory,
    },
    items: {
        title: '아이템 도감',
        countId: 'stsm-item-memory-count',
        initialCount: '0개',
        warningId: 'stsm-item-memory-skipped',
        warningClass: 'stsm-item-memory-warning',
        listId: 'stsm-item-memory-list',
        listClass: 'stsm-item-memory-list',
        excludedId: 'stsm-item-memory-excluded',
        bind: bindItemMemoryView,
        render: renderItemMemory,
    },
    commitments: {
        title: '서약 장부',
        countId: 'stsm-commitment-memory-count',
        initialCount: '0개',
        warningId: 'stsm-commitment-memory-skipped',
        warningClass: 'stsm-commitment-memory-warning',
        listId: 'stsm-commitment-memory-list',
        listClass: 'stsm-commitment-memory-list',
        excludedId: 'stsm-commitment-memory-excluded',
        bind: bindCommitmentMemoryView,
        render: renderCommitmentMemory,
    },
    events: {
        title: '주요 사건',
        countId: 'stsm-event-memory-count',
        initialCount: '0개',
        tokenUsageId: 'stsm-event-token-usage',
        warningId: 'stsm-event-memory-skipped',
        warningClass: 'stsm-event-memory-warning',
        listId: 'stsm-event-memory-list',
        listClass: 'stsm-event-memory-list',
        excludedId: 'stsm-event-memory-excluded',
        bind: bindEventMemoryView,
        render: renderEventMemory,
    },
    world: {
        title: '세계 설정',
        countId: 'stsm-world-memory-count',
        initialCount: '0개',
        tokenUsageId: 'stsm-world-token-usage',
        warningId: 'stsm-world-memory-skipped',
        warningClass: 'stsm-world-memory-warning',
        listId: 'stsm-world-memory-list',
        listClass: 'stsm-world-memory-list',
        excludedId: 'stsm-world-memory-excluded',
        bind: bindWorldMemoryView,
        render: renderWorldMemory,
    },
});

export function bindAtlasFullscreenView(root) {
    root.querySelectorAll('[data-atlas-fullscreen]').forEach(button => {
        button.addEventListener('click', () => {
            showAtlasFullscreen(button.dataset.atlasFullscreen).catch(error => {
                console.error('[Chat Summarizer] Failed to open atlas fullscreen view:', error);
                addExtensionErrorLog(error, {
                    operation: 'atlas',
                    title: '도감 크게 보기 실패',
                    message: error.message,
                    context: { category: button.dataset.atlasFullscreen },
                });
                toastr.error('도감 크게 보기를 열지 못했습니다.');
            });
        });
    });
}

async function showAtlasFullscreen(category) {
    const view = ATLAS_VIEWS[category];
    if (!view) throw new Error('지원하지 않는 도감 종류입니다.');

    const content = document.createElement('div');
    content.className = 'stsm-atlas-fullscreen';
    content.innerHTML = `
        <div class="stsm-atlas-fullscreen-toolbar">
            <strong>${view.title}</strong>
            <span class="stsm-atlas-heading-actions">
                <span id="${view.countId}">${view.initialCount}</span>
                ${category === 'world' ? `
                    <button class="menu_button menu_button_icon interactable" data-world-manual-add type="button" title="세계 설정 직접 추가" aria-label="세계 설정 직접 추가">
                        <i class="fa-solid fa-plus" aria-hidden="true"></i>
                    </button>
                ` : ''}
            </span>
        </div>
        ${view.tokenUsageId ? `<div id="${view.tokenUsageId}"></div>` : ''}
        <div class="stsm-atlas-section-scroll">
            <div id="${view.warningId}" class="${view.warningClass}" hidden></div>
            <div id="${view.listId}" class="${view.listClass}"></div>
            <div id="${view.excludedId}" class="stsm-atlas-excluded-host"></div>
        </div>
    `;

    const render = () => view.render(content);
    view.bind(content);
    window.addEventListener('stsm:atlas-changed', render);
    window.addEventListener('stsm:injection-settings-changed', render);

    try {
        await new Popup(content, POPUP_TYPE.TEXT, '', {
            okButton: '닫기',
            wide: true,
            large: true,
            allowVerticalScrolling: false,
        }).show();
    } finally {
        window.removeEventListener('stsm:atlas-changed', render);
        window.removeEventListener('stsm:injection-settings-changed', render);
    }
}
