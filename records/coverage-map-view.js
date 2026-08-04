import { Popup, POPUP_TYPE } from '../../../../../scripts/popup.js';
import { collectChatRangeMessages, renderChatMessage } from './chat-message-view.js';
import { getCoverageSegments } from '../summary/range-utils.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import { getSummaryRecords } from '../summary/summary-store.js';

export function bindCoverageMap(root) {
    root.querySelector('#stsm-open-coverage-map').addEventListener('click', async () => {
        try {
            await openCoverageMap(root);
        } catch (error) {
            console.error('[Chat Summarizer] Coverage map failed:', error);
            addExtensionErrorLog(error, {
                operation: 'coverage-map',
                title: '채팅방 요약 현황 보기 실패',
                message: '채팅방 요약 현황을 열지 못했습니다.',
            });
            toastr.error('채팅방 요약 현황을 열지 못했습니다.');
        }
    });
}

async function openCoverageMap(summaryRoot) {
    const chat = SillyTavern.getContext().chat;
    const messages = Array.isArray(chat) ? chat : [];
    const segments = getCoverageSegments(messages.length, getSummaryRecords());
    const content = document.createElement('div');
    content.className = 'stsm-coverage-popup';

    if (!segments.length) {
        content.innerHTML = `
            <header class="stsm-coverage-header">
                <strong>채팅방 요약 현황</strong>
                <span>저장 범위 기준</span>
            </header>
            <div class="stsm-empty">표시할 채팅 메시지가 없습니다.</div>
        `;
    } else {
        content.innerHTML = renderCoverageContent(segments);
    }

    const coveragePopup = new Popup(content, POPUP_TYPE.TEXT, '', {
        okButton: '닫기',
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });
    if (segments.length) {
        const applyRange = async segment => {
            try {
                await applySegmentToSummaryRange({
                    summaryRoot,
                    coveragePopup,
                    sourceChat: chat,
                    segment,
                });
            } catch (error) {
                console.error('[Chat Summarizer] Failed to apply coverage range:', error);
                addExtensionErrorLog(error, {
                    operation: 'coverage-map',
                    title: '미요약 구간 범위 적용 실패',
                    message: '선택한 미요약 구간을 요약 범위로 지정하지 못했습니다.',
                    context: { range: { startId: segment.startId, endId: segment.endId } },
                });
                toastr.error('선택한 미요약 구간을 요약 범위로 지정하지 못했습니다.');
            }
        };
        bindCoverageSelection(content, segments, messages, applyRange);
        selectSegment(content, segments[0], messages, applyRange);
    }
    await coveragePopup.show();
}

function renderCoverageContent(segments) {
    const summarizedCount = segments
        .filter(segment => segment.summarized)
        .reduce((total, segment) => total + getRangeSize(segment), 0);
    const totalCount = segments.reduce((total, segment) => total + getRangeSize(segment), 0);
    return `
        <header class="stsm-coverage-header">
            <div>
                <strong>채팅방 요약 현황</strong>
                <span>저장 범위 기준</span>
            </div>
            <span>${summarizedCount.toLocaleString()} / ${totalCount.toLocaleString()}개 요약됨</span>
        </header>
        <div class="stsm-coverage-legend" aria-label="현황 범례">
            <span><i class="stsm-coverage-legend-swatch stsm-coverage-legend-summarized"></i>요약됨</span>
            <span><i class="stsm-coverage-legend-swatch stsm-coverage-legend-unsummarized"></i>미요약</span>
        </div>
        <div class="stsm-coverage-map" role="group" aria-label="채팅방 요약 범위 지도">
            ${segments.map((segment, index) => renderMapSegment(segment, index)).join('')}
        </div>
        <div class="stsm-coverage-segment-list" aria-label="요약 범위 구간 목록">
            ${segments.map((segment, index) => renderSegmentListButton(segment, index)).join('')}
        </div>
        <section class="stsm-coverage-detail" aria-live="polite">
            <div class="stsm-coverage-detail-heading"></div>
            <div class="stsm-coverage-detail-messages"></div>
        </section>
    `;
}

function bindCoverageSelection(root, segments, chat, applyRange) {
    root.querySelectorAll('[data-coverage-segment]').forEach(button => {
        button.addEventListener('click', () => {
            const segment = segments[Number(button.dataset.coverageSegment)];
            if (segment) selectSegment(root, segment, chat, applyRange);
        });
    });
}

function selectSegment(root, segment, chat, applyRange) {
    const index = root.querySelector(`[data-coverage-key="${getSegmentKey(segment)}"]`)?.dataset.coverageSegment;
    root.querySelectorAll('[data-coverage-segment]').forEach(button => {
        const selected = button.dataset.coverageSegment === index;
        button.classList.toggle('stsm-coverage-selected', selected);
        button.setAttribute('aria-pressed', String(selected));
    });

    const messages = collectChatRangeMessages(chat, segment.startId, segment.endId);
    const status = segment.summarized ? '요약됨' : '미요약';
    const heading = root.querySelector('.stsm-coverage-detail-heading');
    heading.innerHTML = `
        <div class="stsm-coverage-detail-title">
            <strong>${status} · ${formatRange(segment)}</strong>
            <span>${messages.length.toLocaleString()}개 메시지</span>
        </div>
        ${segment.summarized ? '' : `
            <button class="stsm-coverage-apply-range menu_button interactable" type="button">
                <i class="fa-solid fa-arrow-right-to-bracket" aria-hidden="true"></i>
                <span>요약 범위로 지정</span>
            </button>
        `}
    `;
    heading.querySelector('.stsm-coverage-apply-range')?.addEventListener('click', () => applyRange(segment));
    root.querySelector('.stsm-coverage-detail-messages').innerHTML = messages.length
        ? messages.map(renderChatMessage).join('')
        : '<div class="stsm-empty">현재 채팅에서 이 구간의 메시지를 찾지 못했습니다.</div>';
}

async function applySegmentToSummaryRange({ summaryRoot, coveragePopup, sourceChat, segment }) {
    if (SillyTavern.getContext().chat !== sourceChat) {
        toastr.warning('채팅방이 변경되어 선택한 범위를 적용하지 않았습니다. 현황을 다시 열어주세요.');
        return;
    }

    const startInput = summaryRoot.querySelector('#stsm-range-start');
    const endInput = summaryRoot.querySelector('#stsm-range-end');
    if (!startInput || !endInput) throw new Error('요약 범위 입력 요소를 찾지 못했습니다.');
    startInput.value = String(segment.startId);
    endInput.value = String(segment.endId);
    startInput.dispatchEvent(new Event('input', { bubbles: true }));
    endInput.dispatchEvent(new Event('input', { bubbles: true }));
    await coveragePopup.completeAffirmative();
    toastr.success(`${formatRange(segment)}을 요약 범위로 지정했습니다.`);
}

function renderMapSegment(segment, index) {
    const status = segment.summarized ? '요약됨' : '미요약';
    return `
        <button
            class="stsm-coverage-map-segment stsm-coverage-${segment.summarized ? 'summarized' : 'unsummarized'}"
            style="--stsm-coverage-weight: ${getRangeSize(segment)}"
            type="button"
            data-coverage-segment="${index}"
            data-coverage-key="${getSegmentKey(segment)}"
            aria-label="${status} ${formatRange(segment)}"
            aria-pressed="false"
            title="${status} · ${formatRange(segment)}"
        ></button>
    `;
}

function renderSegmentListButton(segment, index) {
    const status = segment.summarized ? '요약됨' : '미요약';
    return `
        <button
            class="stsm-coverage-list-item stsm-coverage-${segment.summarized ? 'summarized' : 'unsummarized'} menu_button interactable"
            type="button"
            data-coverage-segment="${index}"
            data-coverage-key="${getSegmentKey(segment)}"
            aria-pressed="false"
        >
            <span>${status}</span>
            <strong>${formatRange(segment)}</strong>
        </button>
    `;
}

function getRangeSize(range) {
    return range.endId - range.startId + 1;
}

function getSegmentKey(segment) {
    return `${segment.startId}-${segment.endId}-${segment.summarized ? 'covered' : 'open'}`;
}

function formatRange(range) {
    return range.startId === range.endId
        ? `#${range.startId}`
        : `#${range.startId} ~ #${range.endId}`;
}
