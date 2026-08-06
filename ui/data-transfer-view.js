import { Popup } from '../../../../../scripts/popup.js';
import { beginOperation, endOperation, getExtensionState } from '../core/extension-state.js';
import {
    downloadGlobalSettingsBackup,
    importGlobalSettingsBackup,
    readGlobalSettingsBackup,
} from '../core/settings-transfer.js';
import { addExtensionErrorLog } from '../diagnostics/summary-error-state.js';
import {
    downloadCurrentChatBackup,
    importCurrentChatBackup,
    readChatBackup,
    resetCurrentChatData,
} from '../summary/chat-data-transfer.js';

export function bindDataTransfer(root, { onChatDataChanged, onGlobalSettingsChanged } = {}) {
    bindCurrentChatDataTransfer(root, onChatDataChanged);
    bindGlobalSettingsTransfer(root, onGlobalSettingsChanged);
}

function bindCurrentChatDataTransfer(root, onDataChanged) {
    const exportButton = root.querySelector('#stsm-export-chat-data');
    const importButton = root.querySelector('#stsm-import-chat-data');
    const resetButton = root.querySelector('#stsm-reset-chat-data');
    const fileInput = root.querySelector('#stsm-import-chat-data-file');

    exportButton.addEventListener('click', () => {
        try {
            assertAvailable();
            const backup = downloadCurrentChatBackup();
            toastr.success(`현재 채팅의 Sumi 요약 기록 ${backup.data.records.length}개를 내보냈습니다.`);
        } catch (error) {
            reportTransferError(error, '채팅 요약 데이터 내보내기 실패', error.message || '현재 채팅의 Sumi 요약 데이터를 내보내지 못했습니다.');
        }
    });

    importButton.addEventListener('click', () => openFilePicker(fileInput, '채팅 요약 데이터 가져오기 시작 실패'));
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        let operationToken = null;

        try {
            assertAvailable();
            const imported = await readChatBackup(file);
            const confirmed = await Popup.show.confirm(
                '현재 채팅방의 Sumi 요약 데이터를 선택한 백업으로 교체할까요?',
                `백업에 요약 기록 ${imported.recordCount}개가 있습니다. 기존 요약·도감·최근 수정 대화는 모두 교체됩니다.`,
                { okButton: '가져오기', cancelButton: '취소' },
            );
            if (!confirmed) return;

            operationToken = beginOperation('data-transfer', '채팅 요약 데이터 가져오는 중', { requiresEnabled: false });
            await importCurrentChatBackup(imported.data);
            if (await refreshAfterTransfer(onDataChanged, '채팅 요약 데이터 가져오기')) {
                toastr.success(`현재 채팅에 Sumi 요약 기록 ${imported.recordCount}개를 가져왔습니다.`);
            }
        } catch (error) {
            reportTransferError(error, '채팅 요약 데이터 가져오기 실패', error.message || '현재 채팅에 Sumi 요약 데이터를 가져오지 못했습니다.');
        } finally {
            if (operationToken) endOperation(operationToken);
            fileInput.value = '';
        }
    });

    resetButton.addEventListener('click', async () => {
        let operationToken = null;
        try {
            assertAvailable();
            const confirmed = await Popup.show.confirm(
                '현재 채팅방의 Sumi 요약 데이터를 모두 초기화할까요?',
                '요약 기록, 도감 수정·번역·삭제 상태, 최근 수정 대화가 삭제됩니다. 확장 전역 설정은 유지됩니다.',
                { okButton: '전체 초기화', cancelButton: '취소' },
            );
            if (!confirmed) return;

            operationToken = beginOperation('data-transfer', '현재 채팅 요약 데이터 초기화 중', { requiresEnabled: false });
            await resetCurrentChatData();
            if (await refreshAfterTransfer(onDataChanged, '채팅 요약 데이터 초기화')) {
                toastr.success('현재 채팅방의 Sumi 요약 데이터를 초기화했습니다.');
            }
        } catch (error) {
            reportTransferError(error, '채팅 요약 데이터 전체 초기화 실패', error.message || '현재 채팅의 Sumi 요약 데이터를 초기화하지 못했습니다.');
        } finally {
            if (operationToken) endOperation(operationToken);
        }
    });
}

function bindGlobalSettingsTransfer(root, onSettingsChanged) {
    const exportButton = root.querySelector('#stsm-export-global-settings');
    const importButton = root.querySelector('#stsm-import-global-settings');
    const fileInput = root.querySelector('#stsm-import-global-settings-file');

    exportButton.addEventListener('click', () => {
        try {
            assertAvailable();
            downloadGlobalSettingsBackup();
            toastr.success('Sumi 확장 전역 설정을 내보냈습니다.');
        } catch (error) {
            reportTransferError(error, '확장 전역 설정 내보내기 실패', error.message || '확장 전역 설정을 내보내지 못했습니다.');
        }
    });

    importButton.addEventListener('click', () => openFilePicker(fileInput, '확장 전역 설정 가져오기 시작 실패'));
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        let operationToken = null;

        try {
            assertAvailable();
            const imported = await readGlobalSettingsBackup(file);
            const confirmed = await Popup.show.confirm(
                'Sumi 확장 전역 설정을 선택한 백업으로 교체할까요?',
                '프롬프트·연결·요약·주입·번역 설정이 교체됩니다. 현재 확장 켜짐/꺼짐 상태와 채팅별 요약 데이터는 유지됩니다.',
                { okButton: '가져오기', cancelButton: '취소' },
            );
            if (!confirmed) return;

            operationToken = beginOperation('data-transfer', '확장 전역 설정 가져오는 중', { requiresEnabled: false });
            await importGlobalSettingsBackup(imported);
            if (await refreshAfterTransfer(onSettingsChanged, '확장 전역 설정 가져오기')) {
                toastr.success('Sumi 확장 전역 설정을 가져왔습니다.');
            }
        } catch (error) {
            reportTransferError(error, '확장 전역 설정 가져오기 실패', error.message || '확장 전역 설정을 가져오지 못했습니다.');
        } finally {
            if (operationToken) endOperation(operationToken);
            fileInput.value = '';
        }
    });
}

function openFilePicker(fileInput, errorTitle) {
    try {
        assertAvailable();
        fileInput.value = '';
        fileInput.click();
    } catch (error) {
        reportTransferError(error, errorTitle, error.message || '가져오기를 시작하지 못했습니다.');
    }
}

function assertAvailable() {
    const operation = getExtensionState().operation;
    if (!operation) return;
    const error = new Error(`${operation.label} 작업이 끝난 뒤 다시 시도해주세요.`);
    error.code = 'STSM_OPERATION_BLOCKED';
    throw error;
}

async function refreshAfterTransfer(callback, operationLabel) {
    try {
        await callback?.();
        return true;
    } catch (error) {
        console.error(`[Chat Summarizer] ${operationLabel} 후 화면 갱신 실패:`, error);
        addExtensionErrorLog(error, {
            operation: 'data-transfer-refresh',
            title: `${operationLabel} 후 화면 갱신 실패`,
            message: '데이터는 저장했지만 현재 화면을 갱신하지 못했습니다. 요약 관리 팝업을 다시 열어 확인해주세요.',
        });
        toastr.warning('데이터는 저장했지만 화면을 갱신하지 못했습니다. 팝업을 다시 열어 확인해주세요.');
        return false;
    }
}

function reportTransferError(error, title, message) {
    console.error(`[Chat Summarizer] ${title}:`, error);
    addExtensionErrorLog(error, {
        operation: 'data-transfer',
        title,
        message,
    });
    toastr.error(message);
}
