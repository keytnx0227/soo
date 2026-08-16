import { setAtlasEntityLlmHidden } from './atlas-metadata.js';

export function getAtlasLlmVisibilityAction(entity) {
    return entity?.llmHidden
        ? { icon: 'fa-eye', title: 'LLM에 다시 보이기' }
        : { icon: 'fa-eye-slash', title: 'LLM에서 감추기' };
}

export function renderAtlasLlmVisibilityState(entity) {
    return entity?.llmHidden
        ? '<span class="stsm-llm-hidden-badge"><i class="fa-solid fa-eye-slash" aria-hidden="true"></i> LLM 비공개</span>'
        : '';
}

export async function toggleAtlasLlmVisibility(category, entity) {
    await setAtlasEntityLlmHidden(category, entity.id, !entity.llmHidden);
    toastr.success(entity.llmHidden ? '이 도감 항목을 LLM에 다시 표시합니다.' : '이 도감 항목을 LLM에서 감췄습니다.');
}
