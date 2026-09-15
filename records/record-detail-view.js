import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../../scripts/popup.js';
import { collectChatRangeMessages, renderChatMessage } from './chat-message-view.js';
import { getSummaryRecordSourceStatus, SOURCE_STATES } from '../summary/source-tracking.js';
import { getSummaryRecord, updateSummaryRecordContent } from '../summary/summary-store.js';
import { openStructuredSummaryEditor } from './structured-summary-editor.js';
import { openStructuredCompressionEditor } from './structured-compression-editor.js';
import { escapeHtml } from '../core/utils.js';
import { renderRecordTagDetails } from './record-tags-view.js';
import { renderRecordMemoryUpdateDetails } from './record-memory-updates-view.js';

export async function openSummaryRecordDetail(recordId) {
    const record = getSummaryRecord(recordId);
    if (!record) {
        toastr.warning('확인할 요약 기록을 찾지 못했습니다.');
        return;
    }

    if (record.type === 'compressed') {
        await openCompressedRecordDetail(record);
        return;
    }

    const chat = SillyTavern.getContext().chat;
    const sourceStatus = getSummaryRecordSourceStatus(record, chat);
    const displayRange = getDisplayRange(record, sourceStatus);
    const messages = collectChatRangeMessages(chat, displayRange.startId, displayRange.endId);
    const content = document.createElement('div');
    content.className = 'stsm-record-detail-popup';
    content.innerHTML = `
        <header class="stsm-record-detail-header">
            <div>
                <strong>요약 레코드 자세히 보기</strong>
                <span>#${record.startId} ~ #${record.endId}</span>
            </div>
            ${renderSourceNotice(record, sourceStatus, displayRange)}
        </header>
        <section class="stsm-record-detail-section">
            ${renderEditableHeading('요약 내용')}
            <div class="stsm-record-detail-summary">${escapeHtml(record.content)}</div>
        </section>
        ${renderRecordTagDetails(record)}
        ${renderRecordMemoryUpdateDetails(record)}
        <section class="stsm-record-detail-section stsm-record-detail-source-section">
            <div class="stsm-record-detail-section-title">
                <span>원본 메시지</span>
                <span>${messages.length.toLocaleString()}개 · #${displayRange.startId} ~ #${displayRange.endId}</span>
            </div>
            <div class="stsm-record-detail-messages">
                ${messages.length
                    ? messages.map(renderChatMessage).join('')
                    : '<div class="stsm-empty">현재 채팅에서 이 범위의 메시지를 찾지 못했습니다.</div>'}
            </div>
        </section>
    `;

    bindDetailEdit(content, record.id);
    await new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: '닫기',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    }).show();
}

async function openCompressedRecordDetail(record) {
    const sources = record.compression.sourceRecordIds.map(getSummaryRecord).filter(Boolean);
    const content = document.createElement('div');
    content.className = 'stsm-record-detail-popup';
    content.innerHTML = `
        <header class="stsm-record-detail-header">
            <div>
                <strong>압축 요약 레코드 자세히 보기</strong>
                <span>#${record.startId} ~ #${record.endId} · Lv.${record.compression.level}</span>
            </div>
        </header>
        <section class="stsm-record-detail-section">
            ${renderEditableHeading('압축 내용')}
            <div class="stsm-record-detail-summary">${escapeHtml(record.content)}</div>
        </section>
        <section class="stsm-record-detail-section">
            <div class="stsm-record-detail-section-title">
                <span>직계 원본 요약</span>
                <span>${sources.length.toLocaleString()}개</span>
            </div>
            <div class="stsm-compression-source-list">
                ${sources.map(source => `
                    <article class="stsm-compression-source-item">
                        <strong>#${source.startId} ~ #${source.endId}${source.compression ? ` · Lv.${source.compression.level}` : ''}</strong>
                        <div>${escapeHtml(source.content)}</div>
                    </article>
                `).join('') || '<div class="stsm-empty">원본 요약 레코드를 찾지 못했습니다.</div>'}
            </div>
        </section>
    `;
    bindDetailEdit(content, record.id);
    await new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: '닫기',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    }).show();
}

function renderEditableHeading(label) {
    return `<div class="stsm-record-detail-section-title"><span>${label}</span>
        <button type="button" class="menu_button menu_button_icon stsm-detail-edit" title="레코드 수정" aria-label="레코드 수정"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>
    </div>`;
}

function bindDetailEdit(content, recordId) {
    const owner = SillyTavern.getContext().chatMetadata;
    const button = content.querySelector('.stsm-detail-edit');
    button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
            if (SillyTavern.getContext().chatMetadata !== owner) throw new Error('채팅이 바뀌었습니다. 상세 화면을 다시 열어주세요.');
            const record = getSummaryRecord(recordId);
            if (!record) throw new Error('수정할 레코드를 찾지 못했습니다.');
            let updated;
            if (record.type === 'compressed' && record.compression?.data && !record.contentEdited) {
                updated = await openStructuredCompressionEditor(recordId);
            } else if (record.type === 'summary' && record.structuredSummary?.data) {
                updated = await openStructuredSummaryEditor(recordId);
            } else {
                updated = await editDetailText(record, owner);
            }
            if (updated) {
                content.querySelector('.stsm-record-detail-summary').textContent = updated.content;
                toastr.success('레코드를 수정했습니다.');
            }
        } catch (error) { toastr.error(error.message || '레코드 수정에 실패했습니다.'); }
        finally { button.disabled = false; }
    });
}

async function editDetailText(record, owner) {
    const editor = document.createElement('textarea');
    editor.className = 'text_pole';
    editor.rows = 16;
    editor.value = record.content;
    editor.setAttribute('aria-label', '레코드 내용 수정');
    let updated = null;
    await new Popup(editor, POPUP_TYPE.CONFIRM, '', {
        okButton: '수정하기', cancelButton: '취소', wider: true, allowVerticalScrolling: true,
        onClosing: async popup => {
            if (popup.result !== POPUP_RESULT.AFFIRMATIVE) return true;
            try {
                if (SillyTavern.getContext().chatMetadata !== owner) throw new Error('채팅이 바뀌어 저장할 수 없습니다.');
                updated = await updateSummaryRecordContent(record.id, editor.value, { contentEdited: true });
                if (!updated) throw new Error('수정할 레코드를 찾지 못했습니다.');
                return true;
            } catch (error) { toastr.error(error.message || '저장에 실패했습니다.'); return false; }
        },
    }).show();
    return updated;
}

function getDisplayRange(record, sourceStatus) {
    if (sourceStatus.state === SOURCE_STATES.MOVED) {
        return {
            startId: sourceStatus.startId,
            endId: sourceStatus.endId,
        };
    }
    return {
        startId: Number(record.startId),
        endId: Number(record.endId),
    };
}

function renderSourceNotice(record, status, displayRange) {
    if (status.state === SOURCE_STATES.CURRENT) {
        return `
            <div class="stsm-record-detail-notice stsm-record-detail-notice-current">
                <i class="fa-solid fa-circle-check" aria-hidden="true"></i>
                <span>요약 당시 원본과 현재 메시지가 일치해요.</span>
            </div>
        `;
    }
    if (status.state === SOURCE_STATES.MOVED) {
        return `
            <div class="stsm-record-detail-notice stsm-record-detail-notice-warning">
                <i class="fa-solid fa-arrows-left-right" aria-hidden="true"></i>
                <span>저장 범위 #${record.startId} ~ #${record.endId}의 원본이 현재 #${displayRange.startId} ~ #${displayRange.endId}로 이동했어요. 아래에는 감지된 원본을 표시해요.</span>
            </div>
        `;
    }
    if (status.state === SOURCE_STATES.STALE) {
        return `
            <div class="stsm-record-detail-notice stsm-record-detail-notice-danger">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <span>요약 당시 원본을 현재 채팅에서 찾지 못했어요. 아래에는 저장 범위가 현재 가리키는 메시지를 표시하며, 실제 원본과 다를 수 있어요.</span>
            </div>
        `;
    }
    return `
        <div class="stsm-record-detail-notice">
            <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
            <span>fingerprint 도입 전 기록이라 원본 일치 여부를 확인할 수 없어요. 아래에는 저장 범위가 현재 가리키는 메시지를 표시해요.</span>
        </div>
    `;
}
